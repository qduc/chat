import { parseSSEStream } from './sseParser.js';
import {
  createChatCompletionChunk,
  writeAndFlush,
  setupStreamingHeaders,
} from './streamUtils.js';
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
 */
function setupStreamEventHandlers({
  upstream,
  req,
  res,
  persistence,
  lastFinishReason,
}) {
  // One-shot guard to prevent double finalize/error on error+end sequences
  let completed = false;

  upstream.body.on('end', () => {
    if (completed) return;
    completed = true;
    try {
      if (persistence && persistence.persist) {
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
  let finished = false;
  let lastFinishReason = { value: null };
  let responseId = null; // Track response_id from chunks

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
          let deltaContent = null;
          let finishReason = null;

          // Capture response_id from any chunk
          if (obj?.id && !responseId) {
            responseId = obj.id;
            console.log('[previous_response_id] Response ID received from stream:', responseId);
            if (persistence) persistence.setResponseId(responseId);
          }

          if (obj?.choices?.[0]?.delta?.content) {
            deltaContent = obj.choices[0].delta.content;
            finishReason = obj.choices[0].finish_reason;
          }

          if (deltaContent) persistence.appendContent(deltaContent);
          if (finishReason) lastFinishReason.value = finishReason;
        },
        () => {
          finished = true;
        },
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
  });
}
