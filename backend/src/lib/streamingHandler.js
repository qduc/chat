import fetch from 'node-fetch';
import { tools as toolRegistry, generateOpenAIToolSpecs } from './tools.js';

/**
 * Parse SSE stream chunks and extract data payloads
 * @param {Buffer|string} chunk - Raw chunk data from stream
 * @param {string} leftover - Incomplete data from previous chunk
 * @param {Function} onDataChunk - Callback for parsed JSON objects
 * @param {Function} onDone - Callback when [DONE] is received
 * @param {Function} onError - Optional callback for JSON parsing errors
 * @returns {string} New leftover data for next chunk
 */
function parseSSEStream(chunk, leftover, onDataChunk, onDone, onError) {
  const s = String(chunk);
  let data = leftover + s;
  const parts = data.split(/\n\n/);
  const newLeftover = parts.pop() || '';
  
  for (const part of parts) {
    const lines = part.split('\n');
    for (const line of lines) {
      const m = line.match(/^data:\s*(.*)$/);
      if (!m) continue;
      
      const payload = m[1];
      if (payload === '[DONE]') {
        onDone();
        break;
      }
      
      try {
        const obj = JSON.parse(payload);
        onDataChunk(obj);
      } catch (e) {
        if (onError) onError(e, payload);
      }
    }
  }
  
  return newLeftover;
}

/**
 * Set up common stream event handlers for upstream response and client request
 * @param {Object} params - Handler setup parameters
 * @param {Object} params.upstream - Upstream response object
 * @param {Object} params.req - Express request object
 * @param {Object} params.res - Express response object
 * @param {boolean} params.persist - Whether persistence is enabled
 * @param {string|null} params.assistantMessageId - Assistant message ID
 * @param {Function} params.doFlush - Flush function for persistence
 * @param {Function} params.finalizeAssistantMessage - Message finalization function
 * @param {Function} params.markAssistantError - Error marking function
 * @param {Object} params.lastFinishReason - Reference to finish reason variable
 */
function setupStreamEventHandlers({
  upstream,
  req,
  res,
  persist,
  assistantMessageId,
  doFlush,
  finalizeAssistantMessage,
  markAssistantError,
  lastFinishReason,
}) {
  upstream.body.on('end', () => {
    try {
      if (persist && assistantMessageId) {
        doFlush();
        finalizeAssistantMessage({
          messageId: assistantMessageId,
          finishReason: (typeof lastFinishReason === 'object' && lastFinishReason !== null ? lastFinishReason.value : lastFinishReason) || 'stop',
          status: 'final',
        });
      }
    } catch (e) {
      console.error('[persist] finalize error', e);
    }
    return res.end();
  });

  upstream.body.on('error', (err) => {
    console.error('Upstream stream error', err);
    try {
      if (persist && assistantMessageId) {
        doFlush();
        markAssistantError({ messageId: assistantMessageId });
      }
    } catch {
      // Ignore errors
    }
    return res.end();
  });

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
}

/**
 * Create a standardized chat completion chunk object
 * @param {string} id - Completion ID
 * @param {string} model - Model name
 * @param {Object} delta - Delta content object
 * @param {string|null} finishReason - Finish reason or null
 * @returns {Object} Chat completion chunk object
 */
function createChatCompletionChunk(id, model, delta, finishReason = null) {
  return {
    id,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{
      index: 0,
      delta,
      finish_reason: finishReason,
    }],
  };
}

/**
 * Create an OpenAI API request
 * @param {Object} config - Configuration object
 * @param {Object} requestBody - Request body to send
 * @returns {Promise<Response>} Fetch response promise
 */
async function createOpenAIRequest(config, requestBody) {
  const url = `${config.openaiBaseUrl}/chat/completions`;
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${config.openaiApiKey}`,
  };
  
  return fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(requestBody),
  });
}

/**
 * Write data to response and flush if possible
 * @param {Object} res - Express response object
 * @param {string|Buffer} data - Data to write
 */
function writeAndFlush(res, data) {
  res.write(data);
  if (typeof res.flush === 'function') res.flush();
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
  } catch (e) {
    throw new Error('invalid_arguments_json');
  }
  
  const validated = tool.validate ? tool.validate(args) : args;
  const output = await tool.handler(validated);
  return { name, output };
}

/**
 * Set up streaming response headers
 * @param {Object} res - Express response object
 */
export function setupStreamingHeaders(res) {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  
  // Ensure headers are sent immediately so the client can start processing
  // the event stream as soon as chunks arrive. Some proxies/browsers may
  // buffer the response if headers are not flushed explicitly.
  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders();
  }
}

/**
 * Create a flush function for persistence
 * @param {Object} params - Flush parameters
 * @param {boolean} params.persist - Whether persistence is enabled
 * @param {string|null} params.assistantMessageId - Assistant message ID
 * @param {string} params.buffer - Content buffer (passed by reference)
 * @param {Function} params.appendAssistantContent - Persistence function
 * @returns {Function} Flush function
 */
export function createFlushFunction({
  persist,
  assistantMessageId,
  buffer,
  appendAssistantContent,
  flushedOnce,
}) {
  return () => {
    if (!persist || !assistantMessageId) return;
    if (buffer.value.length === 0) return;
    
    appendAssistantContent({
      messageId: assistantMessageId,
      delta: buffer.value,
    });
    buffer.value = '';
    flushedOnce.value = true;
  };
}

/**
 * Handle streaming with tool orchestration
 * Executes a 2-turn flow: first turn gets tool calls, second turn streams the response
 * @param {Object} params - Streaming parameters
 */
export async function handleStreamingWithTools({
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
  const doFlush = createFlushFunction({
    persist,
    assistantMessageId,
    buffer,
    appendAssistantContent,
    flushedOnce,
  });

  let leftover = '';
  let finished = false;
  let lastFinishReason = null;

  try {
    // First streaming call to collect tool calls (dispatch tools early)
    const body1 = { 
      ...body, 
      stream: true,
      tools: generateOpenAIToolSpecs() // Use backend registry as source of truth
    };
    const r1 = await createOpenAIRequest(config, body1);
    
    // Stream upstream chunks directly and collect tool calls
    let leftover1 = '';
    const toolCallMap = new Map(); // index -> { id, type, function: { name, arguments } }

    await new Promise((resolve, reject) => {
      r1.body.on('data', (chunk) => {
        try {
          leftover1 = parseSSEStream(
            chunk,
            leftover1,
            (obj) => {
              // Forward upstream chunk to client
              writeAndFlush(res, `data: ${JSON.stringify(obj)}\n\n`);

              const choice = obj?.choices?.[0];
              const delta = choice?.delta || {};

              // Accumulate tool call deltas
              if (Array.isArray(delta.tool_calls) && delta.tool_calls.length > 0) {
                for (const tcDelta of delta.tool_calls) {
                  const idx = tcDelta.index ?? 0;
                  const existing = toolCallMap.get(idx) || {
                    id: tcDelta.id,
                    type: 'function',
                    function: { name: '', arguments: '' },
                  };
                  if (tcDelta.id && !existing.id) existing.id = tcDelta.id;
                  if (tcDelta.function?.name) existing.function.name = tcDelta.function.name;
                  if (tcDelta.function?.arguments) existing.function.arguments += tcDelta.function.arguments;
                  toolCallMap.set(idx, existing);
                }
              }

              // Persistence for content
              if (persist && typeof delta.content === 'string' && delta.content.length > 0) {
                buffer.value += delta.content;
                if (buffer.value.length >= sizeThreshold) doFlush();
              }
            },
            () => resolve(),
            () => { /* ignore parse errors */ }
          );
        } catch (e) {
          reject(e);
        }
      });

      r1.body.on('error', reject);
    });

    // End of first turn parsing

    const toolCalls = Array.from(toolCallMap.values());
    const msg1 = { role: 'assistant', tool_calls: toolCalls };

    if (!toolCalls.length) {
      // No tools declared: upstream first turn already streamed, just close SSE
      writeAndFlush(res, 'data: [DONE]\n\n');
      if (persist && assistantMessageId) {
        doFlush();
        finalizeAssistantMessage({ messageId: assistantMessageId, finishReason: 'stop', status: 'final' });
      }
      return res.end();
    }

    // Tool calls already streamed above; do not re-emit

    // Wait for tools with timeout (gating policy)
    const TOOL_TIMEOUT = 10000; // 10 seconds
    const toolResults = [];
    const toolPromises = toolCalls.map(tc => (
      executeToolCall(tc).then(({ output }) => {
        const toolOutputChunk = createChatCompletionChunk('temp', body.model, {
          tool_output: {
            tool_call_id: tc.id,
            name: tc.function?.name,
            output: output,
          },
        });
        writeAndFlush(res, `data: ${JSON.stringify(toolOutputChunk)}\n\n`);
        return {
          role: 'tool',
          tool_call_id: tc.id,
          content: typeof output === 'string' ? output : JSON.stringify(output),
        };
      })
    ));
    
    try {
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Tool timeout')), TOOL_TIMEOUT)
      );
      
      const toolOutputs = await Promise.race([
        Promise.allSettled(toolPromises),
        timeoutPromise
      ]);
      
      // Collect successful tool results
      for (const result of toolOutputs) {
        if (result.status === 'fulfilled') {
          toolResults.push(result.value);
        }
      }
    } catch (error) {
      console.warn('[tools] Timeout or error, proceeding with available results:', error.message);
      // Continue with whatever tool results we have so far
      for (const promise of toolPromises) {
        try {
          const result = await Promise.race([promise, Promise.resolve(null)]);
          if (result) toolResults.push(result);
        } catch {
          // Skip failed tools
        }
      }
    }

    // Second streaming turn
    const messagesFollowUp = [...(bodyIn.messages || []), msg1, ...toolResults];
    const body2 = {
      model: body.model,
      messages: messagesFollowUp,
      stream: true,
      tools: generateOpenAIToolSpecs(), // Use backend registry as source of truth
      tool_choice: body.tool_choice,
    };
    const r2 = await createOpenAIRequest(config, body2);

    r2.body.on('data', (chunk) => {
      try {
        writeAndFlush(res, chunk);
        
        if (!persist) return;
        
        leftover = parseSSEStream(
          chunk,
          leftover,
          (obj) => {
            const delta = obj?.choices?.[0]?.delta?.content;
            if (delta) {
              buffer.value += delta;
              if (buffer.value.length >= sizeThreshold) doFlush();
            }
            const fr = obj?.choices?.[0]?.finish_reason;
            if (fr) lastFinishReason = fr;
          },
          () => {
            finished = true;
          },
          (e, payload) => {
            // Ignore JSON parsing errors for now
          }
        );
      } catch (e) {
        console.error('[orchestrate stream data] error', e);
      }
    });

    setupStreamEventHandlers({
      upstream: r2,
      req,
      res,
      persist,
      assistantMessageId,
      doFlush,
      finalizeAssistantMessage,
      markAssistantError,
      lastFinishReason,
    });

  } catch (e) {
    console.error('[orchestrate] error', e);
    res.write('data: [DONE]\n\n');
    return res.end();
  }
}

/**
 * Handle regular streaming (non-tool orchestration)
 * @param {Object} params - Streaming parameters
 */
export async function handleRegularStreaming({
  upstream,
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
  useResponsesAPI,
}) {
  const doFlush = createFlushFunction({
    persist,
    assistantMessageId,
    buffer,
    appendAssistantContent,
    flushedOnce,
  });

  let leftover = '';
  let finished = false;
  let lastFinishReason = null;

  upstream.body.on('data', (chunk) => {
    try {
      const s = String(chunk);

      // Handle stream format conversion if needed
      if (useResponsesAPI && req.path === '/v1/chat/completions') {
        // Convert Responses API streaming to Chat Completions format
        let data = leftover + s;
        const parts = data.split(/\n\n/);
        leftover = parts.pop() || '';

        for (const part of parts) {
          const lines = part.split('\n');
          for (const line of lines) {
            const dataMatch = line.match(/^data:\s*(.*)$/);

            if (dataMatch) {
              const payload = dataMatch[1];
              if (payload === '[DONE]') {
                writeAndFlush(res, 'data: [DONE]\n\n');
                finished = true;
                break;
              }

              try {
                const obj = JSON.parse(payload);

                // Convert Responses API events to Chat Completions format
                if (obj.type === 'response.output_text.delta' && obj.delta) {
                  const chatCompletionChunk = createChatCompletionChunk(
                    obj.item_id,
                    'gpt-3.5-turbo',
                    { content: obj.delta }
                  );
                  writeAndFlush(
                    res,
                    `data: ${JSON.stringify(chatCompletionChunk)}\n\n`
                  );

                  // Handle persistence
                  if (persist && obj.delta) {
                    buffer.value += obj.delta;
                    if (buffer.value.length >= sizeThreshold) doFlush();
                  }
                } else if (obj.type === 'response.completed') {
                  const chatCompletionChunk = createChatCompletionChunk(
                    obj.response.id,
                    obj.response.model,
                    {},
                    'stop'
                  );
                  writeAndFlush(
                    res,
                    `data: ${JSON.stringify(chatCompletionChunk)}\n\n`
                  );
                  lastFinishReason = 'stop';
                }
              } catch (e) {
                // not JSON; ignore
              }
            }
          }
        }
      } else {
        // Direct passthrough for native format or Chat Completions API
        writeAndFlush(res, chunk);

        if (!persist) return;

        leftover = parseSSEStream(
          chunk,
          leftover,
          (obj) => {
            // Handle persistence for different formats
            let deltaContent = null;
            let finishReason = null;

            if (
              useResponsesAPI &&
              obj.type === 'response.output_text.delta'
            ) {
              deltaContent = obj.delta;
            } else if (obj?.choices?.[0]?.delta?.content) {
              deltaContent = obj.choices[0].delta.content;
              finishReason = obj.choices[0].finish_reason;
            }

            if (deltaContent) {
              buffer.value += deltaContent;
              if (buffer.value.length >= sizeThreshold) doFlush();
            }
            if (finishReason) {
              lastFinishReason = finishReason;
            }
          },
          () => {
            finished = true;
          },
          (e, payload) => {
            // not JSON; ignore
          }
        );
      }
    } catch (e) {
      console.error('[stream data] error', e);
    }
  });

  setupStreamEventHandlers({
    upstream,
    req,
    res,
    persist,
    assistantMessageId,
    doFlush,
    finalizeAssistantMessage,
    markAssistantError,
    lastFinishReason,
  });
}
