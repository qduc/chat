import { generateOpenAIToolSpecs, generateToolSpecs } from './tools.js';
import { parseSSEStream } from './sseParser.js';
import { createOpenAIRequest, writeAndFlush, createChatCompletionChunk } from './streamUtils.js';
import { createProvider } from './providers/index.js';
import { setupStreamingHeaders } from './streamingHandler.js';
import {
  buildConversationMessagesAsync,
  buildConversationMessagesOptimized,
  executeToolCall,
  appendToPersistence,
  recordFinalToPersistence,
  emitConversationMetadata,
  streamDeltaEvent,
  streamDone,
} from './toolOrchestrationUtils.js';

/**
 * Iterative tool orchestration with thinking and dynamic tool execution
 * Supports AI reasoning between tool calls within a single conversation turn
 */

const MAX_ITERATIONS = 10; // Prevent infinite loops
/**
 * Handle iterative tool orchestration with thinking support
 */
export async function handleToolsStreaming({
  body,
  bodyIn,
  config,
  res,
  req,
  persistence,
  provider,
  userId = null,
}) {
  const providerId = bodyIn?.provider_id || req.header('x-provider-id') || undefined;
  const providerInstance = provider || await createProvider(config, { providerId });
  try {
    // Setup streaming headers
    setupStreamingHeaders(res);
    // Build conversation history including the active system prompt
    // Use optimized version to leverage previous_response_id when available
    const { messages: conversationHistory, previousResponseId } = await buildConversationMessagesOptimized({
      body,
      bodyIn,
      persistence,
      userId,
      provider: providerInstance
    });

    let iteration = 0;
    let isComplete = false;

    while (!isComplete && iteration < MAX_ITERATIONS) {
      iteration++;

      // Stream the model response for this iteration, buffering only tool calls
      // Prefer the frontend-provided tools (expanded by sanitizeIncomingBody) when present.
      // Otherwise fall back to the server-side registry.
      const fallbackToolSpecs = providerInstance.getToolsetSpec({
        generateOpenAIToolSpecs,
        generateToolSpecs,
      }) || generateOpenAIToolSpecs();
      const toolsToSend = (Array.isArray(body.tools) && body.tools.length) ? body.tools : fallbackToolSpecs;
      const requestBody = {
        model: body.model || config.defaultModel,
        messages: conversationHistory,
        stream: true,
        ...(toolsToSend && { tools: toolsToSend, tool_choice: body.tool_choice || 'auto' }),
        // Include previous_response_id for first iteration if available (Responses API optimization)
        ...(iteration === 1 && previousResponseId && { previous_response_id: previousResponseId }),
      };
      // Include reasoning controls only if supported by provider
      if (providerInstance.supportsReasoningControls(requestBody.model)) {
        if (body.reasoning_effort) requestBody.reasoning_effort = body.reasoning_effort;
        if (body.verbosity) requestBody.verbosity = body.verbosity;
      }

      const upstream = await createOpenAIRequest(config, requestBody, { providerId });

      // Check upstream response status
      if (!upstream.ok) {
        const errorBody = await upstream.text();
        throw new Error(`Upstream API error (${upstream.status}): ${errorBody}`);
      }

      let leftoverIter = '';
      const toolCallMap = new Map(); // index -> accumulated tool call
      let gotAnyNonToolDelta = false;
      let responseId = null; // Capture response_id for persistence

      await new Promise((resolve, reject) => {
        // Add timeout to prevent hanging
        const timeout = setTimeout(() => {
          reject(new Error('Stream timeout - no response from upstream API'));
        }, 30000); // 30 second timeout

        const cleanup = () => {
          clearTimeout(timeout);
        };

        upstream.body.on('data', (chunk) => {
          try {
            leftoverIter = parseSSEStream(
              chunk,
              leftoverIter,
              (obj) => {
                // Capture response_id from any chunk
                if (obj?.id && !responseId) {
                  responseId = obj.id;
                  if (persistence) persistence.setResponseId(responseId);
                }

                const choice = obj?.choices?.[0];
                const delta = choice?.delta || {};

                // Accumulate tool_calls, but do not stream their partial deltas
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
                } else {
                  // Stream any non-tool delta chunk directly to the client
                  writeAndFlush(res, `data: ${JSON.stringify(obj)}

`);
                  gotAnyNonToolDelta = true;
                }

                // Persist text content only
                appendToPersistence(persistence, delta.content);
              },
              () => {
                cleanup();
                resolve();
              },
              () => { /* ignore JSON parse errors for this stream */ }
            );
          } catch (e) {
            cleanup();
            reject(e);
          }
        });

        upstream.body.on('error', (err) => {
          cleanup();
          reject(err);
        });

        upstream.body.on('end', () => {
          // Fallback resolution if [DONE] event wasn't received
          cleanup();
          resolve();
        });
      });

      const toolCalls = Array.from(toolCallMap.values());

      if (toolCalls.length > 0) {
        // Normalize tool calls: ensure arguments is valid JSON (convert empty string to '{}')
        const normalizedToolCalls = toolCalls.map(tc => ({
          ...tc,
          function: {
            ...tc.function,
            arguments: tc.function.arguments || '{}'
          }
        }));

        // Emit a single consolidated tool_calls chunk (buffered deltas)
        const toolCallChunk = createChatCompletionChunk(
          bodyIn.id || 'chatcmpl-' + Date.now(),
          body.model || config.defaultModel,
          { tool_calls: normalizedToolCalls }
        );
        writeAndFlush(res, `data: ${JSON.stringify(toolCallChunk)}

`);

        // Add assistant message with tool calls for the next iteration
        conversationHistory.push({ role: 'assistant', tool_calls: normalizedToolCalls });

        // Buffer tool calls for persistence
        if (persistence && persistence.persist && typeof persistence.addToolCalls === 'function') {
          persistence.addToolCalls(normalizedToolCalls);
        }

        // Execute each tool call and stream tool_output events
        for (const toolCall of normalizedToolCalls) {
          try {
            const { name, output } = await executeToolCall(toolCall);
            streamDeltaEvent({
              res,
              model: body.model || config.defaultModel,
              event: {
                tool_output: {
                  tool_call_id: toolCall.id,
                  name,
                  output,
                },
              },
              prefix: 'iter',
            });

            const toolContent = typeof output === 'string' ? output : JSON.stringify(output);

            // Buffer tool output for persistence (don't append to message content!)
            if (persistence && persistence.persist && typeof persistence.addToolOutputs === 'function') {
              persistence.addToolOutputs([{
                tool_call_id: toolCall.id,
                output: toolContent,
                status: 'success'
              }]);
            }

            conversationHistory.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: toolContent,
            });
          } catch (error) {
            const errorMessage = `Tool ${toolCall.function?.name} failed: ${error.message}`;
            streamDeltaEvent({
              res,
              model: body.model || config.defaultModel,
              event: {
                tool_output: {
                  tool_call_id: toolCall.id,
                  name: toolCall.function?.name,
                  output: errorMessage,
                },
              },
              prefix: 'iter',
            });

            // Buffer error tool output for persistence (don't append to message content!)
            if (persistence && persistence.persist && typeof persistence.addToolOutputs === 'function') {
              persistence.addToolOutputs([{
                tool_call_id: toolCall.id,
                output: errorMessage,
                status: 'error'
              }]);
            }

            conversationHistory.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: errorMessage,
            });
          }
        }
        // Continue to next iteration; the model will use the tool results
      } else {
        // No tools requested in this iteration; if any content was streamed, consider complete
        if (gotAnyNonToolDelta) {
          isComplete = true;
        } else {
          // Safety: nothing streamed and no tool calls (unlikely), avoid infinite loop
          isComplete = true;
        }
      }

      // Safety check to prevent infinite loops
      if (iteration >= MAX_ITERATIONS) {
        const maxIterMsg = '\n\n[Maximum iterations reached]';
        streamDeltaEvent({
          res,
          model: body.model || config.defaultModel,
          event: { content: maxIterMsg },
          prefix: 'iter',
        });
        appendToPersistence(persistence, maxIterMsg);
        isComplete = true;
      }
    }

    // Send final completion chunk
    const finalChunk = {
      id: `iter_final_${Date.now()}`,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: config.model || config.defaultModel,
      choices: [{
        index: 0,
        delta: {},
        finish_reason: 'stop',
      }],
    };
    res.write(`data: ${JSON.stringify(finalChunk)}

`);

    // Include conversation metadata before [DONE] if auto-created
    emitConversationMetadata(res, persistence);
    streamDone(res);

    recordFinalToPersistence(persistence, 'stop');

    res.end();

  } catch (error) {
    console.error('[iterative orchestration] error:', error);

    // Stream error to client
    const errorMsg = `[Error: ${error.message}]`;
    streamDeltaEvent({
      res,
      model: body?.model || config.defaultModel,
      event: { content: errorMsg },
      prefix: 'iter',
    });

    appendToPersistence(persistence, errorMsg);
    if (persistence && persistence.persist) {
      persistence.markError();
    }

    emitConversationMetadata(res, persistence);
    streamDone(res);
    res.end();
  }
}
