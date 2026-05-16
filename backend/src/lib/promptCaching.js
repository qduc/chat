import { logger } from '../logger.js';

/**
 * Determines optimal cache breakpoints for conversation messages
 *
 * Strategy:
 * Add cache breakpoints at:
 * 1. The first system message
 * 2. The last user message
 * 3. The last tool message
 *
 * If a message content is a string, it is converted to content-block format
 * before adding cache_control.
 *
 * @param {Array} messages - Array of conversation messages
 * @returns {Array} Messages with cache_control annotations
 */
function addCacheBreakpoints(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return messages;
  }

  const annotatedMessages = [...messages];
  const breakpointIndexes = new Set();

  if (annotatedMessages[0]?.role === 'system') {
    breakpointIndexes.add(0);
  }

  for (let i = annotatedMessages.length - 1; i >= 0; i--) {
    if (annotatedMessages[i]?.role === 'user') {
      breakpointIndexes.add(i);
      break;
    }
  }

  for (let i = annotatedMessages.length - 1; i >= 0; i--) {
    if (annotatedMessages[i]?.role === 'tool') {
      breakpointIndexes.add(i);
      break;
    }
  }

  const addCacheControlToMessage = (message) => {
    if (typeof message.content === 'string') {
      return {
        ...message,
        content: [
          {
            type: 'text',
            text: message.content,
            cache_control: { type: 'ephemeral' }
          }
        ]
      };
    }

    if (Array.isArray(message.content)) {
      if (message.content.length === 0) {
        return {
          ...message,
          content: [
            {
              type: 'text',
              text: '',
              cache_control: { type: 'ephemeral' }
            }
          ]
        };
      }

      return {
        ...message,
        content: message.content.map((item, index) => {
          if (index === message.content.length - 1) {
            return {
              ...item,
              cache_control: { type: 'ephemeral' }
            };
          }

          return item;
        })
      };
    }

    return {
      ...message,
      cache_control: { type: 'ephemeral' }
    };
  };

  for (const index of breakpointIndexes) {
    annotatedMessages[index] = addCacheControlToMessage(annotatedMessages[index]);
  }

  logger.info('[promptCaching] Added cache points', {
    indexes: [...breakpointIndexes].sort((a, b) => a - b),
    roles: [...breakpointIndexes]
      .sort((a, b) => a - b)
      .map(index => annotatedMessages[index]?.role),
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
      cachePoints: messagesWithCache.filter(
        (message) =>
          message?.cache_control ||
          (Array.isArray(message?.content) &&
            message.content.some(item => item?.cache_control))
      ).length
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
