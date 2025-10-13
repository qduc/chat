import { logger } from '../logger.js';

/**
 * Determines optimal cache breakpoints for conversation messages
 *
 * Strategy:
 * Cache everything up to and including the last user/tool message.
 * This allows the entire conversation history (including tool outputs) to be
 * cached while we generate the assistant's response.
 *
 * @param {Array} messages - Array of conversation messages
 * @returns {Array} Messages with cache_control annotations
 */
function addCacheBreakpoints(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return messages;
  }

  const annotatedMessages = [...messages];

  // Annotate the last message with cache control
  const lastIdx = annotatedMessages.length - 1;
  const lastMessage = annotatedMessages[lastIdx];

  if (lastMessage.role === 'user') {
    // Transform content to object format for user messages
    if (typeof lastMessage.content === 'string') {
      annotatedMessages[lastIdx] = {
        ...lastMessage,
        content: [{
          type: 'text',
          text: lastMessage.content,
          cache_control: { type: 'ephemeral' }
        }]
      };
    } else {
      // If content is already an object/array, add cache_control to the message
      annotatedMessages[lastIdx] = {
        ...lastMessage,
        cache_control: { type: 'ephemeral' }
      };
    }
  } else {
    // For non-user messages, add cache_control to the message
    annotatedMessages[lastIdx] = {
      ...lastMessage,
      cache_control: { type: 'ephemeral' }
    };
  }

  logger.info('[promptCaching] Added cache point at last message', {
    index: lastIdx,
    role: annotatedMessages[lastIdx].role,
    totalMessages: annotatedMessages.length
  });

  return annotatedMessages;
}

/**
 * Adds prompt caching breakpoints to request body
 *
 * @param {Object} body - Request body with messages
 * @param {Object} options - Caching options
 * @param {string} options.conversationId - Conversation identifier
 * @param {string} options.userId - User identifier
 * @param {Object} options.provider - Provider instance
 * @param {boolean} options.hasTools - Whether tools are enabled
 * @returns {Object} Modified request body with cache_control annotations
 */
export async function addPromptCaching(body, options = {}) {
  const { conversationId, userId, provider, hasTools } = options;

  try {
    // Check if provider supports prompt caching (pass model for provider-specific logic)
    if (!provider?.supportsPromptCaching?.(body.model)) {
      logger.debug('[promptCaching] Provider does not support prompt caching', {
        providerId: provider?.providerId,
        model: body.model,
        conversationId
      });
      return body;
    }

    // Validate messages array
    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      logger.debug('[promptCaching] No messages to cache', { conversationId });
      return body;
    }

    // Add cache breakpoints
    const messagesWithCache = addCacheBreakpoints(body.messages);

    logger.info('[promptCaching] Applied prompt caching', {
      conversationId,
      userId,
      hasTools,
      messageCount: body.messages.length,
      cachePoints: messagesWithCache.filter(m => m?.cache_control).length
    });

    return {
      ...body,
      messages: messagesWithCache
    };
  } catch (error) {
    // Never fail the request due to caching errors
    logger.error('[promptCaching] Error applying prompt caching', {
      error: error.message,
      stack: error.stack,
      conversationId,
      userId
    });

    return body;
  }
}

/**
 * Estimates potential cache savings based on message content
 * Useful for analytics and debugging
 *
 * @param {Array} messages - Messages with cache_control annotations
 * @returns {Object} Estimated token savings and cache statistics
 */
export function estimateCacheSavings(messages) {
  if (!Array.isArray(messages)) {
    return { cacheable: 0, total: 0, percentage: 0, cachePoints: 0 };
  }

  let cacheableTokens = 0;
  let totalTokens = 0;
  let cachePoints = 0;
  let inCacheableRegion = false;

  // Rough estimation: 1 token ≈ 4 characters for English text
  const estimateTokens = (content) => {
    if (!content) return 0;
    if (typeof content === 'string') {
      return Math.ceil(content.length / 4);
    }
    // Handle content arrays (multi-modal)
    if (Array.isArray(content)) {
      return content.reduce((sum, item) => {
        if (item.type === 'text') {
          return sum + Math.ceil((item.text?.length || 0) / 4);
        }
        // Image or other types: rough estimate
        return sum + 100;
      }, 0);
    }
    return 0;
  };

  for (const message of messages) {
    const tokens = estimateTokens(message.content);
    totalTokens += tokens;

    if (message.cache_control) {
      inCacheableRegion = true;
      cachePoints++;
    }

    if (inCacheableRegion) {
      cacheableTokens += tokens;
    }
  }

  const percentage = totalTokens > 0 ? (cacheableTokens / totalTokens * 100) : 0;

  return {
    cacheable: cacheableTokens,
    total: totalTokens,
    percentage: Math.round(percentage * 10) / 10,
    cachePoints
  };
}
