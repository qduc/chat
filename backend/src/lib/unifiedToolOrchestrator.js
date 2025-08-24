import fetch from 'node-fetch';
import { tools as toolRegistry } from './tools.js';

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
function streamEvent(res, event, model = 'gpt-3.5-turbo') {
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
  const url = `${config.openaiBaseUrl}/chat/completions`;
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${config.openaiApiKey}`,
  };
  
  const requestBody = {
    model: bodyParams.model || config.defaultModel || 'gpt-3.5-turbo',
    messages,
    stream: bodyParams.stream || false,
    ...(bodyParams.tools && { tools: bodyParams.tools, tool_choice: bodyParams.tool_choice || 'auto' })
  };
  
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
async function streamResponse(llmResponse, res, buffer, doFlush, sizeThreshold) {
  if (!llmResponse.body) {
    // Non-streaming response, convert to streaming format
    const message = llmResponse?.choices?.[0]?.message;
    if (message?.content) {
      streamEvent(res, { content: message.content });
      if (buffer && doFlush) {
        buffer.value += message.content;
        if (buffer.value.length >= sizeThreshold) doFlush();
      }
    }
    
    // Send completion event
    const finalChunk = {
      id: llmResponse.id || `unified_${Date.now()}`,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: llmResponse.model || 'gpt-3.5-turbo',
      choices: [{
        index: 0,
        delta: {},
        finish_reason: llmResponse?.choices?.[0]?.finish_reason || 'stop',
      }],
    };
    res.write(`data: ${JSON.stringify(finalChunk)}\n\n`);
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
        
        if (!buffer || !doFlush) return;
        
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
                buffer.value += delta;
                if (buffer.value.length >= sizeThreshold) doFlush();
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
  persist,
  assistantMessageId,
  appendAssistantContent,
  finalizeAssistantMessage,
  markAssistantError,
  buffer,
  flushedOnce,
  sizeThreshold,
}) {
  const doFlush = () => {
    if (!persist || !assistantMessageId) return;
    if (buffer.value.length === 0) return;
    
    appendAssistantContent({
      messageId: assistantMessageId,
      delta: buffer.value,
    });
    buffer.value = '';
    flushedOnce.value = true;
  };

  const messages = [...(bodyIn.messages || [])];
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
        if (persist && assistantMessageId) {
          doFlush();
          markAssistantError({ messageId: assistantMessageId });
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
          const finishReason = await streamResponse(response, res, buffer, doFlush, sizeThreshold);
          
          if (persist && assistantMessageId) {
            doFlush();
            finalizeAssistantMessage({
              messageId: assistantMessageId,
              finishReason,
              status: 'final',
            });
          }
          
          return res.end();
        } else {
          // Non-streaming response - add collected events to response
          if (persist && assistantMessageId && message?.content) {
            buffer.value += message.content;
            doFlush();
            finalizeAssistantMessage({
              messageId: assistantMessageId,
              finishReason: response?.choices?.[0]?.finish_reason || 'stop',
              status: 'final',
            });
          }
          
          // Include collected events in the response
          const responseWithEvents = {
            ...response,
            tool_events: collectedEvents
          };
          
          return res.status(200).json(responseWithEvents);
        }
      }
      
      // Handle tool execution
      if (requestedStreaming) {
        // Stream any thinking content
        if (message.content) {
          streamEvent(res, { content: message.content }, response.model);
          if (persist) {
            buffer.value += message.content;
            if (buffer.value.length >= sizeThreshold) doFlush();
          }
        }
        
        // Stream tool calls
        for (const toolCall of toolCalls) {
          streamEvent(res, { tool_calls: [toolCall] }, response.model);
        }
      } else {
        // For non-streaming, collect thinking content as event
        if (message.content) {
          collectedEvents.push({
            type: 'text',
            value: message.content
          });
          if (persist) {
            buffer.value += message.content;
            if (buffer.value.length >= sizeThreshold) doFlush();
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
      const finishReason = await streamResponse(finalResponse, res, buffer, doFlush, sizeThreshold);
      const maxIterMsg = '\n\n[Maximum iterations reached]';
      streamEvent(res, { content: maxIterMsg });
      if (persist) buffer.value += maxIterMsg;
      
      if (persist && assistantMessageId) {
        doFlush();
        finalizeAssistantMessage({
          messageId: assistantMessageId,
          finishReason,
          status: 'final',
        });
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
      
      if (persist && assistantMessageId && message?.content) {
        buffer.value += message.content + maxIterMsg;
        doFlush();
        finalizeAssistantMessage({
          messageId: assistantMessageId,
          finishReason: finalResponse?.choices?.[0]?.finish_reason || 'stop',
          status: 'final',
        });
      }
      
      // Include collected events in the response
      const responseWithEvents = {
        ...finalResponse,
        tool_events: collectedEvents
      };
      
      return res.status(200).json(responseWithEvents);
    }
    
  } catch (error) {
    console.error('[unified orchestration] error:', error);
    
    if (requestedStreaming) {
      const errorMsg = `[Error: ${error.message}]`;
      streamEvent(res, { content: errorMsg });
      
      if (persist && assistantMessageId) {
        buffer.value += errorMsg;
        doFlush();
        markAssistantError({ messageId: assistantMessageId });
      }
      
      res.write('data: [DONE]\n\n');
      return res.end();
    } else {
      if (persist && assistantMessageId) {
        markAssistantError({ messageId: assistantMessageId });
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