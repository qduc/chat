import { parseSSEStream } from './sseParser.js';
import { writeAndFlush } from './streamUtils.js';
import { getConversationMetadata } from './responseUtils.js';

export { setupStreamingHeaders } from './streamUtils.js';

/**
 * Set up common stream event handlers for upstream response and client request
 * @param {Object} params - Handler setup parameters
 * @param {Object} params.upstream - Upstream response object
 * @param {Object} params.req - Express request object
 * @param {Object} params.res - Express response object
 * @param {Object} params.persistence - Simplified persistence manager
 * @param {Object} params.lastFinishReason - Reference to finish reason variable
 * @param {Map} params.toolCallMap - Accumulated tool calls during streaming
 */
function setupStreamEventHandlers({
  upstream,
  req,
  res,
  persistence,
  lastFinishReason,
  toolCallMap,
}) {
  // One-shot guard to prevent double finalize/error on error+end sequences
  let completed = false;

  upstream.body.on('end', () => {
    if (completed) return;
    completed = true;
    try {
      if (persistence && persistence.persist) {
        // Add accumulated tool calls to persistence before finalizing
        if (toolCallMap && toolCallMap.size > 0) {
          const toolCalls = Array.from(toolCallMap.values());
          console.log('[streamingHandler] Adding tool calls to persistence', {
            count: toolCalls.length,
            callIds: toolCalls.map(tc => tc?.id)
          });
          persistence.addToolCalls(toolCalls);
        }

        const finishReason = (typeof lastFinishReason === 'object' && lastFinishReason !== null ? lastFinishReason.value : lastFinishReason) || 'stop';
        persistence.recordAssistantFinal({ finishReason });
      }
    } catch (e) {
      console.error('[persist] finalize error', e);
    }
    return res.end();
  });

  upstream.body.on('error', (err) => {
    console.error('Upstream stream error', err);
    if (completed) return res.end();
    completed = true;
    try {
      if (persistence && persistence.persist) {
        persistence.markError();
      }
    } catch {
      // Ignore errors
    }
    return res.end();
  });

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
}

/**
 * Handle regular streaming (non-tool orchestration)
 * @param {Object} params - Streaming parameters
 */
export async function handleRegularStreaming({
  upstream,
  res,
  req,
  persistence,
}) {
  let leftover = '';
  let lastFinishReason = { value: null };
  let responseId = null; // Track response_id from chunks
  let toolCallMap = new Map(); // Accumulate streamed tool calls

  // Emit conversation metadata upfront if available so clients receive
  // the conversation id before any model chunks or [DONE]
  try {
    const conversationMeta = getConversationMetadata(persistence);
    if (conversationMeta) {
      writeAndFlush(res, `data: ${JSON.stringify(conversationMeta)}\n\n`);
    }
  } catch (e) {
    // Non-fatal: continue streaming even if metadata cannot be serialized
    console.warn('[stream] failed to write conversation metadata early', e?.message || e);
  }

  upstream.body.on('data', (chunk) => {
    try {
      // Direct passthrough for Chat Completions API
      writeAndFlush(res, chunk);

      // Update persistence buffer if enabled
      if (!persistence || !persistence.persist) return;

      leftover = parseSSEStream(
        chunk,
        leftover,
        (obj) => {
          let finishReason = null;

          // Capture response_id from any chunk
          if (obj?.id && !responseId) {
            responseId = obj.id;
            if (persistence) persistence.setResponseId(responseId);
          }

          const choice = obj?.choices?.[0];
          const delta = choice?.delta;

          if (delta) {
            const deltaContent = delta.content;
            if (deltaContent !== undefined) {
              persistence.appendContent(deltaContent);
            }

            const reasoningText = delta.reasoning_content ?? delta.reasoning;
            if (reasoningText) {
              persistence.appendReasoningText(reasoningText);
            }

            if (Array.isArray(delta.reasoning_details) && delta.reasoning_details.length > 0) {
              persistence.setReasoningDetails(delta.reasoning_details);
            }

            // Capture tool_calls from delta (streaming tool calls)
            if (Array.isArray(delta.tool_calls) && delta.tool_calls.length > 0) {
              for (const tcDelta of delta.tool_calls) {
                const idx = tcDelta.index ?? 0;
                const existing = toolCallMap.get(idx) || {
                  id: tcDelta.id,
                  type: 'function',
                  index: idx,
                  function: { name: '', arguments: '' }
                };

                if (tcDelta.id) existing.id = tcDelta.id;
                if (tcDelta.type) existing.type = tcDelta.type;
                if (tcDelta.function?.name) {
                  existing.function.name = tcDelta.function.name;
                }
                if (tcDelta.function?.arguments) {
                  existing.function.arguments += tcDelta.function.arguments;
                }

                toolCallMap.set(idx, existing);
              }
            }

            finishReason = choice?.finish_reason ?? finishReason;
          }

          if (obj?.usage?.reasoning_tokens != null) {
            persistence.setReasoningTokens(obj.usage.reasoning_tokens);
          }

          const message = choice?.message;
          if (message?.reasoning_details) {
            persistence.setReasoningDetails(message.reasoning_details);
          }

          // Capture complete tool_calls from message (non-streaming or final)
          if (Array.isArray(message?.tool_calls) && message.tool_calls.length > 0) {
            for (const toolCall of message.tool_calls) {
              const idx = toolCall.index ?? toolCallMap.size;
              toolCallMap.set(idx, toolCall);
            }
          }

          if (finishReason) {
            lastFinishReason.value = finishReason;
          }
        },
        () => {},
        () => {}
      );
    } catch (e) {
      console.error('[stream data] error', e);
    }
  });

  setupStreamEventHandlers({
    upstream,
    req,
    res,
    persistence,
    lastFinishReason,
    toolCallMap,
  });
}
