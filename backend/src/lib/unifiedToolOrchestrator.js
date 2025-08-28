import fetch from 'node-fetch';
import { tools as toolRegistry } from './tools.js';
import { getMessagesPage } from '../db/index.js';
import { response } from 'express';
import { addConversationMetadata, getConversationMetadata } from './responseUtils.js';

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
 * Make a request to the AI model
 */
async function callLLM(messages, config, bodyParams) {
  const base = (config.openaiBaseUrl || '').replace(/\/v1\/?$/, '');
  const url = `${base}/v1/chat/completions`;
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${config.openaiApiKey}`,
  };

  const requestBody = {
    model: bodyParams.model || config.defaultModel,
    messages,
    stream: bodyParams.stream || false,
    ...(bodyParams.tools && { tools: bodyParams.tools, tool_choice: bodyParams.tool_choice || 'auto' })
  };
  // Include reasoning controls only for gpt-5* models
  const isGpt5 = typeof requestBody.model === 'string' && requestBody.model.startsWith('gpt-5');
  if (isGpt5) {
    if (bodyParams.reasoning_effort) requestBody.reasoning_effort = bodyParams.reasoning_effort;
    if (bodyParams.verbosity) requestBody.verbosity = bodyParams.verbosity;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(requestBody),
  });

  if (bodyParams.stream) {
    return response; // Return raw response for streaming
  }

  const result = await response.json();
  return result;
}

/**
 * Execute all tool calls and optionally stream results
 */
async function executeAllTools(toolCalls, streaming, res, model, collectedEvents = []) {
  const toolResults = [];

  for (const toolCall of toolCalls) {
    try {
      const { name, output } = await executeToolCall(toolCall);

      const toolOutput = {
        tool_call_id: toolCall.id,
        name,
        output
      };

      if (streaming) {
        streamEvent(res, { tool_output: toolOutput }, model);
      } else {
        // Collect tool output for non-streaming mode
        collectedEvents.push({
          type: 'tool_output',
          value: toolOutput
        });
      }

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

      if (streaming) {
        streamEvent(res, { tool_output: toolOutput }, model);
      } else {
        // Collect tool output for non-streaming mode
        collectedEvents.push({
          type: 'tool_output',
          value: toolOutput
        });
      }

      toolResults.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: errorMessage,
      });
    }
  }

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

/**
 * Setup streaming response headers
 */
function setupStreamingHeaders(res) {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders();
  }
}

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
}) {
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
  const requestedStreaming = body.stream !== false;
  const MAX_ITERATIONS = 10;

  // For non-streaming, collect all events to send at the end
  const collectedEvents = [];

  try {
    if (requestedStreaming) {
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
    while (iteration < MAX_ITERATIONS) {
      // Always get response non-streaming first to check for tool calls
      const response = await callLLM(messages, config, { ...body, stream: false });
      const message = response?.choices?.[0]?.message;
      const toolCalls = message?.tool_calls || [];

      if (!toolCalls.length) {
        // No tools needed - this is the final response
        if (requestedStreaming) {
          const finishReason = await streamResponse(response, res, persistence, body.model || config.defaultModel);

          if (persistence && persistence.persist) {
            persistence.recordAssistantFinal({ finishReason });
          }

          return res.end();
        } else {
          // Non-streaming response - add collected events to response
          if (persistence && persistence.persist && message?.content) {
            persistence.appendContent(message.content);
            persistence.recordAssistantFinal({ finishReason: response?.choices?.[0]?.finish_reason || 'stop' });
          }

          // Include collected events in the response
          const responseWithEvents = {
            ...response,
            tool_events: collectedEvents
          };

          // Include conversation metadata if auto-created
          addConversationMetadata(responseWithEvents, persistence);

          return res.status(200).json(responseWithEvents);
        }
      }

      // Handle tool execution
      if (requestedStreaming) {
        // Stream any thinking content
        if (message.content) {
          streamEvent(res, { content: message.content }, response.model || body.model || config.defaultModel);
          if (persistence && persistence.persist) {
            persistence.appendContent(message.content);
          }
        }

        // Stream tool calls
        for (const toolCall of toolCalls) {
          streamEvent(res, { tool_calls: [toolCall] }, response.model || body.model || config.defaultModel);
        }
      } else {
        // For non-streaming, collect thinking content as event
        if (message.content) {
          collectedEvents.push({
            type: 'text',
            value: message.content
          });
          if (persistence && persistence.persist) {
            persistence.appendContent(message.content);
          }
        }

        // Collect tool calls as events
        for (const toolCall of toolCalls) {
          collectedEvents.push({
            type: 'tool_call',
            value: toolCall
          });
        }
      }

      // Execute all tools - now collects events for non-streaming too
      const toolResults = await executeAllTools(toolCalls, requestedStreaming, res, response.model, collectedEvents);

      // Add to conversation for next iteration
      messages.push(message, ...toolResults);
      iteration++;
    }

    // Max iterations reached - get final response
    const finalResponse = await callLLM(messages, config, { ...body, stream: requestedStreaming });

    if (requestedStreaming) {
      const finishReason = await streamResponse(finalResponse, res, persistence, body.model || config.defaultModel);
      const maxIterMsg = '\n\n[Maximum iterations reached]';
      streamEvent(res, { content: maxIterMsg }, body.model || config.defaultModel);
      if (persistence && persistence.persist) {
        persistence.appendContent(maxIterMsg);
        persistence.recordAssistantFinal({ finishReason });
      }

      return res.end();
    } else {
      const message = finalResponse?.choices?.[0]?.message;
      const maxIterMsg = '\n\n[Maximum iterations reached]';

      // Add final content and max iterations message as events
      if (message?.content) {
        collectedEvents.push({
          type: 'text',
          value: message.content
        });
      }
      collectedEvents.push({
        type: 'text',
        value: maxIterMsg
      });

      if (persistence && persistence.persist && message?.content) {
        persistence.appendContent(message.content + maxIterMsg);
        persistence.recordAssistantFinal({ finishReason: finalResponse?.choices?.[0]?.finish_reason || 'stop' });
      }

      // Include collected events in the response
      const responseWithEvents = {
        ...finalResponse,
        tool_events: collectedEvents
      };

      // Include conversation metadata if auto-created
      addConversationMetadata(responseWithEvents, persistence);

      return res.status(200).json(responseWithEvents);
    }

  } catch (error) {
    console.error('[unified orchestration] error:', error);

    if (requestedStreaming) {
      const errorMsg = `[Error: ${error.message}]`;
      streamEvent(res, { content: errorMsg }, body?.model || config.defaultModel);

      if (persistence && persistence.persist) {
        persistence.appendContent(errorMsg);
        persistence.markError();
      }

      // Include conversation metadata if auto-created
      const conversationMeta = getConversationMetadata(persistence);
      if (conversationMeta) {
        res.write(`data: ${JSON.stringify(conversationMeta)}\n\n`);
      }
      res.write('data: [DONE]\n\n');
      return res.end();
    } else {
      if (persistence && persistence.persist) {
        persistence.markError();
      }

      const errorMsg = `[Error: ${error.message}]`;
      collectedEvents.push({
        type: 'text',
        value: errorMsg
      });

      return res.status(500).json({
        error: {
          message: error.message,
          type: 'tool_orchestration_error'
        },
        tool_events: collectedEvents
      });
    }
  }
}
