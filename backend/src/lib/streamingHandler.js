import { parseSSEStream } from './sseParser.js';
import {
  createChatCompletionChunk,
  writeAndFlush,
} from './streamUtils.js';

export { setupStreamingHeaders } from './streamUtils.js';

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
