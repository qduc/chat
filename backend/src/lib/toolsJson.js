import { generateOpenAIToolSpecs, generateToolSpecs } from './tools.js';
import { addConversationMetadata } from './responseUtils.js';
import { setupStreamingHeaders, createOpenAIRequest } from './streamUtils.js';
import { createProvider } from './providers/index.js';
import {
  buildConversationMessagesAsync,
  executeToolCall,
  appendToPersistence,
  recordFinalToPersistence,
  emitConversationMetadata,
  streamDeltaEvent,
  streamDone,
} from './toolOrchestrationUtils.js';

/**
 * Configuration class for orchestration behavior
 */
class OrchestrationConfig {
  constructor(options = {}) {
    this.maxIterations = options.maxIterations || 10;
    this.streamingEnabled = options.streamingEnabled !== false;
    this.model = options.model;
    this.defaultModel = options.defaultModel;
    this.tools = options.tools;
    this.fallbackToolSpecs = options.fallbackToolSpecs;
  }

  static fromRequest(body, config, fallbackToolSpecs) {
    return new OrchestrationConfig({
      maxIterations: 10,
      streamingEnabled: body.stream !== false,
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
      const toolContent = typeof output.output === 'string'
        ? output.output
        : JSON.stringify(output.output);
      appendToPersistence(persistence, toolContent);
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
      const toolContent = typeof output.output === 'string'
        ? output.output
        : JSON.stringify(output.output);
      appendToPersistence(persistence, toolContent);
    }
  }

  sendFinalResponse(response, persistence) {
    const message = response?.choices?.[0]?.message;
    if (message?.content) {
      this.collectedEvents.push({
        type: 'text',
        value: message.content
      });
      appendToPersistence(persistence, message.content);
      recordFinalToPersistence(persistence, response?.choices?.[0]?.finish_reason || 'stop');
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
async function callLLM({ messages, config, bodyParams, providerId, providerHttp, provider }) {
  const requestBody = {
    model: bodyParams.model || config.defaultModel,
    messages,
    stream: bodyParams.stream || false,
    ...(bodyParams.tools && { tools: bodyParams.tools, tool_choice: bodyParams.tool_choice || 'auto' })
  };
  // Include reasoning controls only when the provider supports them
  if (provider?.supportsReasoningControls(requestBody.model)) {
    if (bodyParams.reasoning_effort) requestBody.reasoning_effort = bodyParams.reasoning_effort;
    if (bodyParams.verbosity) requestBody.verbosity = bodyParams.verbosity;
  }

  const response = await createOpenAIRequest(config, requestBody, { providerId, http: providerHttp });

  if (bodyParams.stream) {
    return response; // Return raw response for streaming
  }

  const result = await response.json();
  return result;
}

/**
 * Execute all tool calls using response handler
 */
async function executeAllTools(toolCalls, responseHandler, persistence) {
  const toolResults = [];
  const toolOutputs = [];

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

  // Send all tool outputs through response handler
  responseHandler.sendToolOutputs(toolOutputs, persistence);
  return toolResults;
}

/**
 * Stream a complete LLM response
 */
async function streamResponse(llmResponse, res, persistence, model) {
  if (!llmResponse.body) {
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

  return new Promise((resolve, reject) => {
    llmResponse.body.on('data', (chunk) => {
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
              resolve(lastFinishReason || 'stop');
              return;
            }

            try {
              const obj = JSON.parse(payload);
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
      } catch (e) {
        console.error('[unified stream] error', e);
      }
    });

    llmResponse.body.on('end', () => {
      resolve(lastFinishReason || 'stop');
    });

    llmResponse.body.on('error', (err) => {
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
  userId = null,
}) {
  const providerId = bodyIn?.provider_id || req.header('x-provider-id') || undefined;
  const providerInstance = provider || await createProvider(config, { providerId });
  const fallbackToolSpecs = providerInstance.getToolsetSpec({
    generateOpenAIToolSpecs,
    generateToolSpecs,
  }) || generateOpenAIToolSpecs();
  // Build initial messages ensuring the active system prompt is preserved
  const messages = await buildConversationMessagesAsync({ body, bodyIn, persistence, userId });
  const orchestrationConfig = OrchestrationConfig.fromRequest(body, config, fallbackToolSpecs);
  const responseHandler = ResponseHandlerFactory.create(orchestrationConfig, res);

  try {
    if (orchestrationConfig.streamingEnabled) {
      setupStreamingHeaders(res);
    }

    // Handle client abort
    req.on('close', () => {
      if (res.writableEnded) return;
      try {
        if (persistence && persistence.persist) {
          persistence.markError();
        }
      } catch {
        // Ignore errors
      }
    });

    let iteration = 0;

    // Main orchestration loop - continues until LLM stops requesting tools
    while (iteration < orchestrationConfig.maxIterations) {
      // Always get response non-streaming first to check for tool calls
      const response = await callLLM({
        messages,
        config,
        bodyParams: { ...body, tools: orchestrationConfig.tools, stream: false },
        providerId,
        providerHttp,
        provider: providerInstance,
      });
      const message = response?.choices?.[0]?.message;
      const toolCalls = message?.tool_calls || [];

      if (!toolCalls.length) {
        // No tools needed - this is the final response
        if (orchestrationConfig.streamingEnabled) {
          const finishReason = await responseHandler.sendFinalResponse(response, persistence);

          recordFinalToPersistence(persistence, finishReason);

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
      responseHandler.sendToolCalls(toolCalls);

      // Execute all tools
  const toolResults = await executeAllTools(toolCalls, responseHandler, persistence);

      // Add to conversation for next iteration
      messages.push(message, ...toolResults);
      iteration++;
    }

    // Max iterations reached - get final response
    const finalResponse = await callLLM({
      messages,
      config,
      bodyParams: { ...body, tools: orchestrationConfig.tools, stream: orchestrationConfig.streamingEnabled },
      providerId,
      providerHttp,
      provider: providerInstance,
    });

    // Handle max iterations reached
    const maxIterMsg = '\n\n[Maximum iterations reached]';

    if (orchestrationConfig.streamingEnabled) {
      const finishReason = await responseHandler.sendFinalResponse(finalResponse, persistence);
      responseHandler.sendThinkingContent(maxIterMsg, persistence);
      recordFinalToPersistence(persistence, finishReason);
      return res.end();
    } else {
      const responseWithEvents = responseHandler.sendFinalResponse(finalResponse, persistence);
      responseHandler.sendThinkingContent(maxIterMsg, persistence);
      return res.status(200).json(responseWithEvents);
    }

  } catch (error) {
    console.error('[unified orchestration] error:', error);

    if (orchestrationConfig.streamingEnabled) {
      return responseHandler.sendError(error, persistence);
    } else {
      const errorResponse = responseHandler.sendError(error, persistence);
      return res.status(500).json(errorResponse);
    }
  }
}
