import { countConversationsBySession } from '../../db/conversations.js';
import { countMessagesByConversation } from '../../db/messages.js';

/**
 * Error types for validation failures
 */
export const ValidationErrors = {
  CONVERSATION_LIMIT_EXCEEDED: 'conversation_limit_exceeded',
  MESSAGE_LIMIT_EXCEEDED: 'message_limit_exceeded',
  CONVERSATION_NOT_FOUND: 'conversation_not_found',
  INVALID_CONVERSATION_ACCESS: 'invalid_conversation_access',
};

/**
 * Handles validation and limits for conversations and messages
 * Returns structured error objects instead of throwing HTTP responses
 */
export class ConversationValidator {
  constructor(config) {
    this.config = config;
  }

  /**
   * Validate conversation limit for a session
   * @param {string} sessionId - Session ID
   * @returns {Object|null} Error object if limit exceeded, null if valid
   */
  validateConversationLimit(sessionId) {
    const conversationCount = countConversationsBySession(sessionId);
    const maxConversations = this.config?.persistence?.maxConversationsPerSession || 100;

    if (conversationCount >= maxConversations) {
      return {
        type: ValidationErrors.CONVERSATION_LIMIT_EXCEEDED,
        message: 'Max conversations per session reached',
        statusCode: 429,
        details: {
          current: conversationCount,
          max: maxConversations,
        },
      };
    }

    return null;
  }

  /**
   * Validate message limit for a conversation
   * @param {string} conversationId - Conversation ID
   * @returns {Object|null} Error object if limit exceeded, null if valid
   */
  validateMessageLimit(conversationId) {
    const messageCount = countMessagesByConversation(conversationId);
    const maxMessages = this.config?.persistence?.maxMessagesPerConversation || 1000;

    if (messageCount >= maxMessages) {
      return {
        type: ValidationErrors.MESSAGE_LIMIT_EXCEEDED,
        message: 'Max messages per conversation reached',
        statusCode: 429,
        details: {
          current: messageCount,
          max: maxMessages,
        },
      };
    }

    return null;
  }

  /**
   * Validate conversation exists and belongs to session
   * @param {Object|null} conversation - Conversation object from database
   * @param {string} conversationId - Requested conversation ID
   * @param {string} sessionId - Session ID
   * @returns {Object|null} Error object if invalid, null if valid
   */
  validateConversationAccess(conversation, conversationId, sessionId) {
    if (!conversation) {
      return {
        type: ValidationErrors.CONVERSATION_NOT_FOUND,
        message: 'Conversation not found or access denied',
        statusCode: 404,
        details: {
          conversationId,
          sessionId,
        },
      };
    }

    return null;
  }

  /**
   * Validate all limits and access for a conversation request
   * @param {Object} params - Validation parameters
   * @param {string} params.conversationId - Conversation ID (optional for new conversations)
   * @param {string} params.sessionId - Session ID
   * @param {Object|null} params.existingConversation - Existing conversation object
   * @param {boolean} params.isNewConversation - Whether this is a new conversation
   * @returns {Object|null} Error object if validation fails, null if valid
   */
  validateRequest({ conversationId, sessionId, existingConversation, isNewConversation }) {
    // For existing conversations, validate access
    if (conversationId && !isNewConversation) {
      const accessError = this.validateConversationAccess(existingConversation, conversationId, sessionId);
      if (accessError) return accessError;

      // Validate message limit
      const messageLimitError = this.validateMessageLimit(conversationId);
      if (messageLimitError) return messageLimitError;
    }

    // For new conversations, validate conversation limit
    if (isNewConversation) {
      const conversationLimitError = this.validateConversationLimit(sessionId);
      if (conversationLimitError) return conversationLimitError;
    }

    return null;
  }
}
