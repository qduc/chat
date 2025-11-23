
/**
 * Create a standardized chat completion chunk object
 * @param {string} id - Completion ID
 * @param {string} model - Model name
 * @param {Object} delta - Delta content object
 * @param {string|null} finishReason - Finish reason or null
 * @returns {Object} Chat completion chunk object
 */
export function createChatCompletionChunk(id, model, delta, finishReason = null) {
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
const TRANSLATED_JSON = Symbol('chatforgeTranslatedJson');

function wrapResponseJson(response, provider, context = {}) {
  if (!response || typeof response.json !== 'function') return response;
  if (response[TRANSLATED_JSON]) return response;

  const needsTranslation = typeof provider?.needsStreamingTranslation === 'function'
    ? provider.needsStreamingTranslation()
    : false;

  // Only translate successful JSON responses; let error payloads pass through unchanged.
  if (!needsTranslation || response.ok === false) {
    return response;
  }

  const originalJson = response.json.bind(response);
  let translatedPromise = null;

  response.json = async () => {
    if (!translatedPromise) {
      translatedPromise = (async () => {
        const raw = await originalJson();
        try {
          return await provider.translateResponse(raw, context);
        } catch {
          return raw;
        }
      })();
    }
    return translatedPromise;
  };

  response[TRANSLATED_JSON] = true;
  return response;
}

export async function createOpenAIRequest(config, requestBody, options = {}) {
  const { createProvider } = await import('./providers/index.js');
  const provider = await createProvider(config, options);
  const context = {
    providerId: options.providerId || provider.providerId,
    ...(options.context || {}),
  };
  const upstream = await provider.sendRawRequest(requestBody, context);
  return wrapResponseJson(upstream, provider, context);
}

// Optional alias with a more generic name for future call sites
/**
 * Write data to response and flush if possible
 * @param {Object} res - Express response object
 * @param {string|Buffer} data - Data to write
 */
export function writeAndFlush(res, data) {
  res.write(data);
  if (typeof res.flush === 'function') res.flush();
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

import { PassThrough } from 'node:stream';

/**
 * Tee a Node Readable stream so callers can consume the original stream
 * while also capturing a small preview of the data for logging or inspection.
 * Returns an object with a `body` (readable stream to use instead of original)
 * and a `previewPromise` that resolves to the captured preview string when
 * the source stream ends (or errors).
 *
 * @param {Object} response - The original fetch Response-like object (should expose .body Readable)
 * @param {Object} options - { maxPreviewBytes }
 */
export function teeStreamWithPreview(response, options = {}) {
  const maxPreviewBytes = Number(options.maxPreviewBytes || 2048);
  const original = response?.body;
  if (!original || typeof original.on !== 'function') {
    return { body: original, previewPromise: Promise.resolve(null) };
  }

  const out = new PassThrough();
  const capture = new PassThrough();

  // Pipe original stream into both PassThroughs by wiring data events.
  // We intentionally attach listeners to the original so we don't change
  // its flowing mode semantics for other potential consumers.
  original.on('data', (chunk) => {
    try {
      out.write(chunk);
      capture.write(chunk);
    } catch (e) {
      // best-effort capture; ignore
    }
  });

  original.on('end', () => {
    try {
      out.end();
      capture.end();
    } catch (e) {
      // ignore
    }
  });

  original.on('error', (err) => {
    try {
      out.destroy(err);
      capture.destroy(err);
    } catch (e) {
      // ignore
    }
  });

  // Accumulate preview up to maxPreviewBytes
  let captured = '';
  let capturedBytes = 0;
  const previewPromise = new Promise((resolve) => {
    capture.on('data', (chunk) => {
      if (capturedBytes >= maxPreviewBytes) return;
      try {
        const s = String(chunk);
        const remain = maxPreviewBytes - capturedBytes;
        const toTake = s.slice(0, remain);
        captured += toTake;
        capturedBytes += Buffer.byteLength(toTake);
      } catch {
        // ignore conversion errors
      }
    });
    capture.on('end', () => resolve(captured));
    capture.on('error', () => resolve(captured));
  });

  return { body: out, previewPromise };
}
