import { generateOpenAIToolSpecs, generateToolSpecs } from './tools.js';
import { addConversationMetadata } from './responseUtils.js';
import { setupStreamingHeaders, createOpenAIRequest, teeStreamWithPreview } from './streamUtils.js';
import { logUpstreamResponse } from './logging/upstreamLogger.js';
import { createProvider } from './providers/index.js';
import { addPromptCaching } from './promptCaching.js';
import { createAbortError } from './abortUtils.js';
import {
  buildConversationMessagesOptimized,
  executeToolCall,
  appendToPersistence,
  recordFinalToPersistence,
  emitConversationMetadata,
  streamDeltaEvent,
  streamDone,
} from './toolOrchestrationUtils.js';
import { logger } from '../logger.js';
import { getUserMaxToolIterations } from '../db/users.js';

/**
 * Configuration class for orchestration behavior
 */
class OrchestrationConfig {
  constructor(options = {}) {
    this.maxIterations = options.maxIterations || 10;
    this.streamingEnabled = options.streamingEnabled !== false;
    const providerStreamingOption = options.providerStreamingEnabled;
    this.providerStreamingEnabled = providerStreamingOption !== undefined
      ? providerStreamingOption !== false
      : this.streamingEnabled;
    this.model = options.model;
    this.defaultModel = options.defaultModel;
    this.tools = options.tools;
    this.fallbackToolSpecs = options.fallbackToolSpecs;
  }

  static fromRequest(body, config, fallbackToolSpecs, userId = null) {
    const uiStreamingEnabled = body.stream !== false;
    const providerStreamingEnabled = body.provider_stream !== undefined
      ? body.provider_stream !== false
      : uiStreamingEnabled;
    // Get user's max iterations setting (default 10)
    const maxIterations = userId ? getUserMaxToolIterations(userId) : 10;
    return new OrchestrationConfig({
      maxIterations,
      streamingEnabled: uiStreamingEnabled,
      providerStreamingEnabled,
      model: body.model || config.defaultModel,
      defaultModel: config.defaultModel,
      tools: (Array.isArray(body.tools) && body.tools.length > 0) ? body.tools : fallbackToolSpecs,
      fallbackToolSpecs
    });
  }
}
/**
 * Response handler factory
 */
class ResponseHandlerFactory {
  static create(config, res) {
    return config.streamingEnabled
      ? new StreamingResponseHandler(res, config.model)
      : new JsonResponseHandler(config.model);
  }
}

/**
 * Base response handler interface
 */
class ResponseHandler {
  constructor(model) {
    this.model = model;
    this.collectedEvents = [];
  }

  sendThinkingContent(_content, _persistence) {
    throw new Error('Must implement sendThinkingContent');
  }

  sendToolCalls(_toolCalls) {
    throw new Error('Must implement sendToolCalls');
  }

  sendToolOutputs(_outputs, _persistence) {
    throw new Error('Must implement sendToolOutputs');
  }

  sendFinalResponse(_response, _persistence) {
    throw new Error('Must implement sendFinalResponse');
  }

  sendError(_error, _persistence) {
    throw new Error('Must implement sendError');
  }
}

/**
 * Streaming response handler
 */
class StreamingResponseHandler extends ResponseHandler {
  constructor(res, model) {
    super(model);
    this.res = res;
  }

  _streamEvent(event, prefix = 'unified') {
    streamDeltaEvent({
      res: this.res,
      model: this.model,
      event,
      prefix,
    });
  }

  sendThinkingContent(content, persistence) {
    this._streamEvent({ content });
    appendToPersistence(persistence, content);
  }

  sendToolCalls(toolCalls) {
    for (const toolCall of toolCalls) {
      this._streamEvent({ tool_calls: [toolCall] });
    }
  }

  sendToolOutputs(outputs, persistence) {
    for (const output of outputs) {
      this._streamEvent({ tool_output: output });

      // Buffer tool outputs for persistence (don't append to message content!)
      if (persistence && persistence.persist && typeof persistence.addToolOutputs === 'function') {
        const toolContent = typeof output.output === 'string'
          ? output.output
          : JSON.stringify(output.output);
        persistence.addToolOutputs([{
          tool_call_id: output.tool_call_id,
          output: toolContent,
          status: output.status || 'success'
        }]);
      }
    }
  }

  async sendFinalResponse(response, persistence) {
    return await streamResponse(response, this.res, persistence, this.model);
  }

  sendError(error, persistence) {
    const errorMsg = `[Error: ${error.message}]`;
    this._streamEvent({ content: errorMsg });

    appendToPersistence(persistence, errorMsg);
    if (persistence && persistence.persist) {
      persistence.markError();
    }

    emitConversationMetadata(this.res, persistence);
    streamDone(this.res);
    return this.res.end();
  }
}

function summarizeMessagesForLog(messages) {
  if (!Array.isArray(messages)) return [];
  return messages.map((msg, idx) => ({
    idx,
    role: msg?.role,
    hasToolCalls: Array.isArray(msg?.tool_calls) && msg.tool_calls.length > 0,
    toolCallCount: Array.isArray(msg?.tool_calls) ? msg.tool_calls.length : 0,
    toolOutputCount: Array.isArray(msg?.tool_outputs) ? msg.tool_outputs.length : 0,
    toolCallIds: Array.isArray(msg?.tool_calls) ? msg.tool_calls.map(tc => tc?.id) : undefined,
    toolOutputIds: Array.isArray(msg?.tool_outputs) ? msg.tool_outputs.map(out => out?.tool_call_id) : undefined,
    contentPreview: typeof msg?.content === 'string' ? msg.content.slice(0, 80) : '[non-string]',
  }));
}

/**
 * JSON response handler (collects events)
 */
class JsonResponseHandler extends ResponseHandler {
  sendThinkingContent(content, persistence) {
    this.collectedEvents.push({
      type: 'text',
      value: content
    });
    appendToPersistence(persistence, content);
  }

  sendToolCalls(toolCalls) {
    for (const toolCall of toolCalls) {
      this.collectedEvents.push({
        type: 'tool_call',
        value: toolCall
      });
    }
  }

  sendToolOutputs(outputs, persistence) {
    for (const output of outputs) {
      this.collectedEvents.push({
        type: 'tool_output',
        value: output
      });

      // Buffer tool outputs for persistence (don't append to message content!)
      if (persistence && persistence.persist && typeof persistence.addToolOutputs === 'function') {
        const toolContent = typeof output.output === 'string'
          ? output.output
          : JSON.stringify(output.output);
        persistence.addToolOutputs([{
          tool_call_id: output.tool_call_id,
          output: toolContent,
          status: output.status || 'success'
        }]);
      }
    }
  }

  sendFinalResponse(response, persistence) {
    const message = response?.choices?.[0]?.message;
    const finishReason = response?.choices?.[0]?.finish_reason || 'stop';
    const responseId = response?.id || null;

    if (responseId && persistence && typeof persistence.setResponseId === 'function') {
      persistence.setResponseId(responseId);
    }

    // Capture reasoning_details if present
    if (message?.reasoning_details && Array.isArray(message.reasoning_details)) {
      if (persistence && typeof persistence.setReasoningDetails === 'function') {
        persistence.setReasoningDetails(message.reasoning_details);
      }
    }

    // Capture reasoning_tokens if present (check both locations)
    const reasoningTokens = response?.usage?.reasoning_tokens
      ?? response?.usage?.completion_tokens_details?.reasoning_tokens
      ?? null;

    if (reasoningTokens != null) {
      if (persistence && typeof persistence.setReasoningTokens === 'function') {
        persistence.setReasoningTokens(reasoningTokens);
      }
    }

    if (message?.content) {
      this.collectedEvents.push({
        type: 'text',
        value: message.content
      });
      appendToPersistence(persistence, message.content);
    }

    // Only record final message if there's content or tool events
    if (message?.content || this.collectedEvents.length > 0) {
      recordFinalToPersistence(persistence, finishReason, responseId);
    }

    const responseWithEvents = {
      ...response,
      tool_events: this.collectedEvents
    };

    addConversationMetadata(responseWithEvents, persistence);
    return responseWithEvents;
  }

  sendError(error, persistence) {
    if (persistence && persistence.persist) {
      persistence.markError();
    }

    const errorMsg = `[Error: ${error.message}]`;
    this.collectedEvents.push({
      type: 'text',
      value: errorMsg
    });
    appendToPersistence(persistence, errorMsg);

    return {
      error: {
        message: error.message,
        type: 'tool_orchestration_error'
      },
      tool_events: this.collectedEvents
    };
  }
}

/**
 * Make a request to the AI model
 */
async function callLLM({ messages, config, bodyParams, providerId, providerHttp, provider, previousResponseId = null, userId = null, conversationId = null, abortSignal = null }) {
  const providerStreamFlag = bodyParams?.provider_stream ?? bodyParams?.providerStream;
  const upstreamStreamEnabled = (providerStreamFlag !== undefined
    ? providerStreamFlag
    : bodyParams?.stream) !== false;

  let requestBody = {
    model: bodyParams.model || config.defaultModel,
    messages,
    stream: upstreamStreamEnabled,
    ...(bodyParams.tools && { tools: bodyParams.tools, tool_choice: bodyParams.tool_choice || 'auto' }),
    // Include previous_response_id if available (already validated in buildConversationMessagesOptimized)
    ...(previousResponseId && { previous_response_id: previousResponseId }),
  };
  // Include reasoning controls only when the provider supports them
  if (provider?.supportsReasoningControls(requestBody.model)) {
    if (bodyParams.reasoning_effort) requestBody.reasoning_effort = bodyParams.reasoning_effort;
    if (bodyParams.verbosity) requestBody.verbosity = bodyParams.verbosity;
  }

  // Apply prompt caching
  requestBody = await addPromptCaching(requestBody, {
    conversationId,
    userId,
    provider,
    hasTools: Boolean(bodyParams.tools)
  });

  let response = await createOpenAIRequest(config, requestBody, { providerId, http: providerHttp, signal: abortSignal });

  // If request with previous_response_id failed due to invalid ID format, retry with full history
  if (!response.ok && requestBody.previous_response_id) {
    let upstreamBody;
    try {
      upstreamBody = await response.json();
    } catch {
      try {
        const text = await response.text();
        upstreamBody = { error: 'upstream_error', message: text };
      } catch {
        upstreamBody = { error: 'upstream_error', message: 'Unknown error' };
      }
    }

    const isInvalidResponseIdError = response.status === 400
      && upstreamBody?.error?.param === 'previous_response_id'
      && upstreamBody?.error?.code === 'invalid_value';

    if (isInvalidResponseIdError) {
      logger.warn({
        msg: 'invalid_previous_response_id',
        previous_response_id: requestBody.previous_response_id,
        error: upstreamBody?.error?.message,
        retrying: 'with full history'
      });

      // Retry without previous_response_id (will use full history)
      // Need to rebuild messages with full history from persistence
      const retryBody = { ...requestBody };
      delete retryBody.previous_response_id;

      // Note: messages should already be full history since this is in tool orchestration
      // which builds full history at the start, but we'll keep the retry logic consistent

      // Reapply prompt caching
      const retryBodyWithCaching = await addPromptCaching(retryBody, {
        conversationId,
        userId,
        provider,
        hasTools: Boolean(bodyParams.tools)
      });

      response = await createOpenAIRequest(config, retryBodyWithCaching, { providerId, http: providerHttp, signal: abortSignal });
    }
  }

  if (upstreamStreamEnabled) {
    return response; // Return raw response for streaming
  }

  const result = await response.json();
  return result;
}

/**
 * Execute all tool calls using response handler
 */
async function executeAllTools(toolCalls, responseHandler, persistence, options = {}) {
  const { parallelEnabled = false, concurrency = 3, userId = null } = options || {};
  const toolResults = [];
  const toolOutputs = [];

  if (parallelEnabled && Array.isArray(toolCalls) && toolCalls.length > 1) {
    // Execute in parallel with bounded concurrency
    const { executeToolCallsParallel } = await import('./toolOrchestrationUtils.js');
    const results = await executeToolCallsParallel(toolCalls, userId, { concurrency });

    for (const res of results) {
      const isError = res.status === 'error';
      const outputValue = res.output;
      toolOutputs.push({
        tool_call_id: res.tool_call_id,
        name: res.name,
        output: outputValue,
        status: isError ? 'error' : 'success',
      });

      toolResults.push({
        role: 'tool',
        tool_call_id: res.tool_call_id,
        content: typeof outputValue === 'string' ? outputValue : JSON.stringify(outputValue),
      });
    }
  } else {
    // Sequential execution (original behavior)
    for (const toolCall of toolCalls) {
      try {
        const { name, output } = await executeToolCall(toolCall);

        const toolOutput = {
          tool_call_id: toolCall.id,
          name,
          output
        };

        toolOutputs.push(toolOutput);
        toolResults.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: typeof output === 'string' ? output : JSON.stringify(output),
        });

      } catch (error) {
        const errorMessage = `Tool ${toolCall.function?.name} failed: ${error.message}`;
        const toolOutput = {
          tool_call_id: toolCall.id,
          name: toolCall.function?.name,
          output: errorMessage
        };

        toolOutputs.push(toolOutput);
        toolResults.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: errorMessage,
        });
      }
    }
  }

  // Send all tool outputs through response handler (preserve original order)
  logger.debug('[toolsJson] Sending tool outputs to response handler', {
    count: toolOutputs.length,
    outputs: toolOutputs.map(({ tool_call_id, name, output }) => ({
      tool_call_id,
      name,
      outputPreview: typeof output === 'string' ? output.slice(0, 120) : '[non-string]',
    })),
  });
  responseHandler.sendToolOutputs(toolOutputs, persistence);
  return toolResults;
}

/**
 * Stream a complete LLM response
 */
async function streamResponse(llmResponse, res, persistence, model) {
  if (!llmResponse.body) {
    if (llmResponse?.id && persistence && typeof persistence.setResponseId === 'function') {
      persistence.setResponseId(llmResponse.id);
    }

    // Non-streaming response, convert to streaming format
    const message = llmResponse?.choices?.[0]?.message;
    if (message?.content) {
      streamDeltaEvent({
        res,
        model: llmResponse.model || model,
        event: { content: message.content },
        prefix: 'unified',
      });
      appendToPersistence(persistence, message.content);
    }

    // Send completion event
    const finalChunk = {
      id: llmResponse.id || `unified_${Date.now()}`,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: llmResponse.model || model,
      choices: [{
        index: 0,
        delta: {},
        finish_reason: llmResponse?.choices?.[0]?.finish_reason || 'stop',
      }],
    };
    res.write(`data: ${JSON.stringify(finalChunk)}\n\n`);
    // Include conversation metadata if auto-created
    emitConversationMetadata(res, persistence);
    streamDone(res);
    return llmResponse?.choices?.[0]?.finish_reason || 'stop';
  }

  // Handle streaming response
  let leftover = '';
  let lastFinishReason = null;
  // Tee the stream so we can capture a small preview for logging without
  // interfering with existing consumers. Replace llmResponse.body with the
  // tee'd body that we will pipe through to the client.
  const { body: teeBody, previewPromise } = teeStreamWithPreview(llmResponse, { maxPreviewBytes: 4096 });

  // If teeStreamWithPreview returned a different body, use it; otherwise fall back
  // to the original stream.
  const source = teeBody || llmResponse.body;

  return new Promise((resolve, reject) => {
    source.on('data', (chunk) => {
      try {
        res.write(chunk);
        if (typeof res.flush === 'function') res.flush();

        const s = String(chunk);
        let data = leftover + s;
        const parts = data.split(/\n\n/);
        leftover = parts.pop() || '';

        for (const part of parts) {
          const lines = part.split('\n');
          for (const line of lines) {
            const m = line.match(/^data:\s*(.*)$/);
            if (!m) continue;

            const payload = m[1];
            if (payload === '[DONE]') {
              // Before resolving, attempt to log the captured preview for debugging
              previewPromise.then((preview) => {
                try {
                  logUpstreamResponse({
                    url: llmResponse.url || '[upstream]',
                    status: llmResponse.status || 200,
                    headers: llmResponse.headers || {},
                    body: preview || null,
                  });
                } catch {
                  // best-effort logging
                }
                resolve(lastFinishReason || 'stop');
              }).catch(() => resolve(lastFinishReason || 'stop'));
              return;
            }

            try {
              const obj = JSON.parse(payload);
              if (obj?.id && persistence && typeof persistence.setResponseId === 'function') {
                persistence.setResponseId(obj.id);
              }
              const delta = obj?.choices?.[0]?.delta?.content;
              if (delta) {
                appendToPersistence(persistence, delta);
              }
              const fr = obj?.choices?.[0]?.finish_reason;
              if (fr) lastFinishReason = fr;
            } catch {
              // Ignore JSON parsing errors
            }
          }
        }
      } catch {
        logger.error('[unified stream] error');
      }
    });

    source.on('end', () => {
      // Log preview on normal end as well
      previewPromise.then((preview) => {
        try {
          logUpstreamResponse({
            url: llmResponse.url || '[upstream]',
            status: llmResponse.status || 200,
            headers: llmResponse.headers || {},
            body: preview || null,
          });
        } catch {
          // ignore
        }
        resolve(lastFinishReason || 'stop');
      }).catch(() => resolve(lastFinishReason || 'stop'));
    });

    source.on('error', (err) => {
      reject(err);
    });
  });
}

// Use shared streaming header setup from streamUtils

/**
 * Unified tool orchestration handler - automatically adapts to request needs
 * Replaces all 3 previous modes with a single self-adapting implementation
 */
export async function handleToolsJson({
  body,
  bodyIn,
  config,
  res,
  req,
  persistence,
  providerHttp,
  provider,
  abortContext,
  _userId = null,
}) {
  const abortSignal = abortContext?.signal || null;
  const cancelState = abortContext?.cancelState || null;
  const providerId = bodyIn?.provider_id || req.header('x-provider-id') || undefined;
  const providerInstance = provider || await createProvider(config, { providerId });
  const fallbackToolSpecs = providerInstance.getToolsetSpec({
    generateOpenAIToolSpecs,
    generateToolSpecs,
  }) || generateOpenAIToolSpecs();
  // Build initial messages ensuring the active system prompt is preserved
  // Use optimized version to leverage previous_response_id when available
  const { messages, previousResponseId } = await buildConversationMessagesOptimized({
    body,
    bodyIn,
    persistence,
      userId: persistence?.userId ?? null,
    provider: providerInstance
  });
  logger.debug('[toolsJson] Prepared messages for upstream call', {
    conversationId: persistence?.conversationId || null,
    previousResponseId,
    messageSummaries: summarizeMessagesForLog(messages)
  });
  const orchestrationConfig = OrchestrationConfig.fromRequest(body, config, fallbackToolSpecs, persistence?.userId ?? null);
  const responseHandler = ResponseHandlerFactory.create(orchestrationConfig, res);

  try {
    if (orchestrationConfig.streamingEnabled) {
      setupStreamingHeaders(res);
    }

    // Handle client abort
    req.on('close', () => {
      if (res.writableEnded) return;
      try {
        if (cancelState?.cancelled) return;
        if (persistence && persistence.persist) {
          persistence.markError();
        }
      } catch {
        // Ignore errors
      }
    });

    let iteration = 0;
    let currentPreviousResponseId = previousResponseId; // Track response_id across iterations

    // Main orchestration loop - continues until LLM stops requesting tools
    while (iteration < orchestrationConfig.maxIterations) {
      if (abortSignal?.aborted) {
        throw createAbortError();
      }
      // Always get response non-streaming first to check for tool calls
      const response = await callLLM({
        messages,
        config,
        bodyParams: { ...body, tools: orchestrationConfig.tools, stream: false },
        providerId,
        providerHttp,
        provider: providerInstance,
        previousResponseId: currentPreviousResponseId,
        userId: persistence?.userId ?? null,
        conversationId: persistence?.conversationId,
        abortSignal,
      });
      const message = response?.choices?.[0]?.message;
      const toolCalls = message?.tool_calls || [];

      // Update previous_response_id for next iteration
      if (response?.id) {
        currentPreviousResponseId = response.id;
      }

      if (!toolCalls.length) {
        // No tools needed - this is the final response
        if (orchestrationConfig.streamingEnabled) {
          const responseId = response?.id || null;
          if (responseId && persistence && typeof persistence.setResponseId === 'function') {
            persistence.setResponseId(responseId);
          }

          const finishReason = await responseHandler.sendFinalResponse(response, persistence);

          recordFinalToPersistence(persistence, finishReason, responseId || (persistence?.responseId ?? null));

          return res.end();
        } else {
          const responseWithEvents = responseHandler.sendFinalResponse(response, persistence);
          return res.status(200).json(responseWithEvents);
        }
      }

      // Handle tool execution
      // Send any thinking content
      if (message.content) {
        responseHandler.sendThinkingContent(message.content, persistence);
      }

      // Send tool calls
      if (toolCalls.length > 0) {
        logger.debug('[toolsJson] Tool calls detected from model', {
          conversationId: persistence?.conversationId || null,
          iteration,
          toolCalls: toolCalls.map((tc) => ({
            id: tc.id,
            name: tc.function?.name,
            argPreview: typeof tc.function?.arguments === 'string'
              ? tc.function.arguments.slice(0, 120)
              : '[non-string]'
          })),
        });
      }
      responseHandler.sendToolCalls(toolCalls);

      // Buffer tool calls for persistence
      if (persistence && persistence.persist && typeof persistence.addToolCalls === 'function') {
        // For non-streaming responses, set textOffset to current content length
        // Tools appear after any content that was generated
        const contentLength = persistence.getContentLength();
        const toolCallsWithOffset = toolCalls.map((tc, idx) => ({
          ...tc,
          index: tc.index ?? idx,
          textOffset: contentLength
        }));
        persistence.addToolCalls(toolCallsWithOffset);
        if (typeof persistence.addMessageEvent === 'function') {
          for (const tc of toolCallsWithOffset) {
            persistence.addMessageEvent('tool_call', {
              tool_call_id: tc.id ?? null,
              tool_call_index: tc.index ?? null,
            });
          }
        }
      }

      // Execute all tools (support optional parallel execution)
      const parallelEnabled =
        (bodyIn && bodyIn.enable_parallel_tool_calls === true) ||
        Boolean(config.parallelTools && config.parallelTools.enabled);

      const parallelConcurrency = Math.min(
        Number(bodyIn?.parallel_tool_concurrency ?? config.parallelTools?.concurrency ?? 3),
        Number(config.parallelTools?.maxConcurrency ?? 5)
      );

      const toolResults = await executeAllTools(toolCalls, responseHandler, persistence, {
        parallelEnabled,
        concurrency: parallelConcurrency,
        userId: persistence?.userId ?? null,
      });
      if (toolResults.length > 0) {
        logger.debug('[toolsJson] Tool results produced', {
          conversationId: persistence?.conversationId || null,
          iteration,
          resultsSummary: toolResults.map((result) => ({
            tool_call_id: result.tool_call_id,
            contentPreview: typeof result.content === 'string' ? result.content.slice(0, 120) : '[non-string]',
          })),
        });
      }

      // Add to conversation for next iteration
      messages.push(message, ...toolResults);
      logger.debug('[toolsJson] Messages extended after tool execution', {
        conversationId: persistence?.conversationId || null,
        iteration,
        totalMessages: messages.length,
        messageSummaries: summarizeMessagesForLog(messages.slice(-Math.min(messages.length, 6))),
      });
      iteration++;
    }

    // Max iterations reached - get final response
    const finalResponse = await callLLM({
      messages,
      config,
      bodyParams: {
        ...body,
        tools: orchestrationConfig.tools,
        provider_stream: orchestrationConfig.providerStreamingEnabled
      },
      providerId,
      providerHttp,
      provider: providerInstance,
      userId: persistence?.userId ?? null,
      conversationId: persistence?.conversationId,
      abortSignal,
    });

    // Handle max iterations reached
    const maxIterMsg = '\n\n[Maximum iterations reached]';

    if (orchestrationConfig.streamingEnabled) {
      const responseId = finalResponse?.id || null;
      if (responseId && persistence && typeof persistence.setResponseId === 'function') {
        persistence.setResponseId(responseId);
      }

      const finishReason = await responseHandler.sendFinalResponse(finalResponse, persistence);
      responseHandler.sendThinkingContent(maxIterMsg, persistence);
      recordFinalToPersistence(persistence, finishReason, responseId || (persistence?.responseId ?? null));
      return res.end();
    } else {
      const responseWithEvents = responseHandler.sendFinalResponse(finalResponse, persistence);
      responseHandler.sendThinkingContent(maxIterMsg, persistence);
      return res.status(200).json(responseWithEvents);
    }

  } catch (error) {
    if (cancelState?.cancelled || abortSignal?.aborted) {
      if (persistence && persistence.persist) {
        recordFinalToPersistence(persistence, 'cancelled', persistence?.responseId ?? null);
      }
      if (!res.writableEnded) res.end();
      return;
    }

    logger.error({ msg: '[unified orchestration] error', err: error });

    if (orchestrationConfig.streamingEnabled) {
      return responseHandler.sendError(error, persistence);
    } else {
      const errorResponse = responseHandler.sendError(error, persistence);
      return res.status(500).json(errorResponse);
    }
  }
}
