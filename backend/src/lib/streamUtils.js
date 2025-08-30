import fetch from 'node-fetch';

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
export async function createOpenAIRequest(config, requestBody, options = {}) {
  // Backward-compat shim: delegate to provider registry
  const { providerChatCompletions } = await import('./providers/index.js');
  return providerChatCompletions(config, requestBody, options);
}

// Optional alias with a more generic name for future call sites
export const createProviderRequest = createOpenAIRequest;

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
