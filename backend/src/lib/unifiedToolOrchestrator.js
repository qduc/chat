import { tools as toolRegistry, generateOpenAIToolSpecs, generateToolSpecs } from './tools.js';
import { getMessagesPage } from '../db/index.js';
import { addConversationMetadata, getConversationMetadata } from './responseUtils.js';
import { setupStreamingHeaders, createOpenAIRequest } from './streamUtils.js';
import { createProvider } from './providers/index.js';

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
 * Execute a single tool call from the local registry
 * @param {Object} call - Tool call object with function name and arguments
 * @returns {Promise<{name: string, output: any}>} Tool execution result
 */
async function executeToolCall(call) {
  const name = call?.function?.name;
  const argsStr = call?.function?.arguments || '{}';
  const tool = toolRegistry[name];

  if (!tool) {
    throw new Error(`unknown_tool: ${name}`);
  }

  let args;
  try {
    args = JSON.parse(argsStr || '{}');
  } catch {
    throw new Error('invalid_arguments_json');
  }

  const validated = tool.validate ? tool.validate(args) : args;
  const output = await tool.handler(validated);
  return { name, output };
}

/**
 * Stream an event to the client
 */
function streamEvent(res, event, model) {
  const chunk = {
    id: `unified_${Date.now()}`,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{
      index: 0,
      delta: event,
      finish_reason: null,
    }],
  };
  res.write(`data: ${JSON.stringify(chunk)}\n\n`);
  if (typeof res.flush === 'function') res.flush();
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

  sendThinkingContent(content, persistence) {
    throw new Error('Must implement sendThinkingContent');
  }

  sendToolCalls(toolCalls) {
    throw new Error('Must implement sendToolCalls');
  }

  sendToolOutputs(outputs) {
    throw new Error('Must implement sendToolOutputs');
  }

  sendFinalResponse(response, persistence) {
    throw new Error('Must implement sendFinalResponse');
  }

  sendError(error, persistence) {
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

  _streamEvent(event) {
    streamEvent(this.res, event, this.model);
  }

  sendThinkingContent(content, persistence) {
    this._streamEvent({ content });
    if (persistence && persistence.persist) {
      persistence.appendContent(content);
    }
  }

  sendToolCalls(toolCalls) {
    for (const toolCall of toolCalls) {
      this._streamEvent({ tool_calls: [toolCall] });
    }
  }

  sendToolOutputs(outputs) {
    for (const output of outputs) {
      this._streamEvent({ tool_output: output });
    }
  }

  async sendFinalResponse(response, persistence) {
    return await streamResponse(response, this.res, persistence, this.model);
  }

  sendError(error, persistence) {
    const errorMsg = `[Error: ${error.message}]`;
    this._streamEvent({ content: errorMsg });

    if (persistence && persistence.persist) {
      persistence.appendContent(errorMsg);
      persistence.markError();
    }

    const conversationMeta = getConversationMetadata(persistence);
    if (conversationMeta) {
      this.res.write(`data: ${JSON.stringify(conversationMeta)}\n\n`);
    }
    this.res.write('data: [DONE]\n\n');
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
    if (persistence && persistence.persist) {
      persistence.appendContent(content);
    }
  }

  sendToolCalls(toolCalls) {
    for (const toolCall of toolCalls) {
      this.collectedEvents.push({
        type: 'tool_call',
        value: toolCall
      });
    }
  }

  sendToolOutputs(outputs) {
    for (const output of outputs) {
      this.collectedEvents.push({
        type: 'tool_output',
        value: output
      });
    }
  }

  sendFinalResponse(response, persistence) {
    const message = response?.choices?.[0]?.message;
    if (message?.content) {
      this.collectedEvents.push({
        type: 'text',
        value: message.content
      });
      if (persistence && persistence.persist) {
        persistence.appendContent(message.content);
        persistence.recordAssistantFinal({
          finishReason: response?.choices?.[0]?.finish_reason || 'stop'
        });
      }
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
async function executeAllTools(toolCalls, responseHandler) {
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
  responseHandler.sendToolOutputs(toolOutputs);
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
      streamEvent(res, { content: message.content }, llmResponse.model || model);
      if (persistence && persistence.persist) {
        persistence.appendContent(message.content);
      }
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
    if (persistence && persistence.persist && persistence.conversationMeta) {
      const conversationEvent = {
        _conversation: {
          id: persistence.conversationId,
          title: persistence.conversationMeta.title,
          model: persistence.conversationMeta.model,
          created_at: persistence.conversationMeta.created_at,
        }
      };
      res.write(`data: ${JSON.stringify(conversationEvent)}\n\n`);
    }
    res.write('data: [DONE]\n\n');
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
                if (persistence && persistence.persist) {
                  persistence.appendContent(delta);
                }
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
export async function handleUnifiedToolOrchestration({
  body,
  bodyIn,
  config,
  res,
  req,
  persistence,
  providerHttp,
  provider,
}) {
  const providerId = bodyIn?.provider_id || req.header('x-provider-id') || undefined;
  const providerInstance = provider || await createProvider(config, { providerId });
  const fallbackToolSpecs = providerInstance.getToolsetSpec({
    generateOpenAIToolSpecs,
    generateToolSpecs,
  }) || generateOpenAIToolSpecs();
  // Build initial messages from persisted history when available
  let messages = [];
  if (persistence && persistence.persist && persistence.conversationId) {
    try {
      const page = getMessagesPage({ conversationId: persistence.conversationId, afterSeq: 0, limit: 200 });
      messages = (page?.messages || [])
        .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
        .map(m => ({ role: m.role, content: m.content }));
    } catch (_) {
      messages = [...(bodyIn.messages || [])];
    }
  } else {
    messages = [...(bodyIn.messages || [])];
  }
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

          if (persistence && persistence.persist) {
            persistence.recordAssistantFinal({ finishReason });
          }

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
      const toolResults = await executeAllTools(toolCalls, responseHandler);

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
      if (persistence && persistence.persist) {
        persistence.recordAssistantFinal({ finishReason });
      }
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
