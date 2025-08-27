import { parseSSEStream } from './sseParser.js';
import {
  createChatCompletionChunk,
  writeAndFlush,
  setupStreamingHeaders,
} from './streamUtils.js';
import { config } from 'dotenv';

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
      // Include conversation metadata before finalizing if auto-created
      if (persistence && persistence.persist && persistence.conversationMeta) {
        const conversationEvent = {
          _conversation: {
            id: persistence.conversationId,
            title: persistence.conversationMeta.title,
            model: persistence.conversationMeta.model,
            created_at: persistence.conversationMeta.created_at,
          }
        };
        writeAndFlush(res, `data: ${JSON.stringify(conversationEvent)}\n\n`);
      }

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
