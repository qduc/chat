import { upsertSession } from '../../db/sessions.js';
import {
  getConversationById,
  createConversation,
  updateConversationTitle,
  updateConversationMetadata,
  updateConversationProviderId,
} from '../../db/conversations.js';
import {
  clearAllMessages,
  insertUserMessage,
  insertAssistantFinal,
  markAssistantErrorBySeq,
  getNextSeq,
} from '../../db/messages.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * Handles core conversation persistence operations
 * Focused on database interactions without business logic or HTTP concerns
 */
export class ConversationManager {
  constructor() {}

  /**
   * Ensure session exists in database
   * @param {string} sessionId - Session ID
   * @param {Object} sessionData - Additional session data
   */
  ensureSession(sessionId, sessionData = {}) {
    upsertSession(sessionId, sessionData);
  }

  /**
   * Get conversation by ID and validate ownership
   * @param {string} conversationId - Conversation ID
   * @param {string} sessionId - Session ID
   * @param {string|null} userId - User ID (if authenticated)
   * @returns {Object|null} Conversation object or null if not found
   */
  getConversation(conversationId, sessionId, userId = null) {
    return getConversationById({ id: conversationId, sessionId, userId });
  }

  /**
   * Create a new conversation
   * @param {Object} params - Conversation parameters
   * @returns {string} New conversation ID
   */
  createNewConversation(params) {
    const conversationId = uuidv4();

    createConversation({
      id: conversationId,
      sessionId: params.sessionId,
      userId: params.userId || null, // Pass user context
      title: null, // Will be auto-generated if needed
      model: params.model,
      provider_id: params.providerId,
      streamingEnabled: params.streamingEnabled,
      toolsEnabled: params.toolsEnabled,
      qualityLevel: params.qualityLevel || null,
      reasoningEffort: params.reasoningEffort || null,
      verbosity: params.verbosity || null,
      metadata: params.metadata || {}
    });

    return conversationId;
  }

  /**
   * Clear all messages for a conversation and insert new ones
   * @param {string} conversationId - Conversation ID
   * @param {string} sessionId - Session ID
   * @param {Array} messages - Array of messages to insert
   */
  syncMessageHistory(conversationId, sessionId, messages) {
    // Clear existing messages
    clearAllMessages({ conversationId, sessionId });

    // Insert new messages in sequence
    let seq = 1;
    for (const message of messages) {
      if (message.role === 'user' && typeof message.content === 'string') {
        insertUserMessage({
          conversationId,
          content: message.content,
          seq: seq++,
        });
      } else if (message.role === 'assistant' && typeof message.content === 'string') {
        insertAssistantFinal({
          conversationId,
          content: message.content,
          seq: seq++,
          finishReason: 'stop',
        });
      }
    }
  }

  /**
   * Get the next sequence number for a conversation
   * @param {string} conversationId - Conversation ID
   * @returns {number} Next sequence number
   */
  getNextSequence(conversationId) {
    return getNextSeq(conversationId);
  }

  /**
   * Record final assistant message
   * @param {Object} params - Message parameters
   */
  recordAssistantMessage(params) {
    insertAssistantFinal({
      conversationId: params.conversationId,
      content: params.content,
      seq: params.seq,
      finishReason: params.finishReason || 'stop',
    });
  }

  /**
   * Mark assistant message as error
   * @param {string} conversationId - Conversation ID
   * @param {number} seq - Message sequence number
   */
  markAssistantError(conversationId, seq) {
    markAssistantErrorBySeq({
      conversationId,
      seq,
    });
  }

  /**
   * Update conversation title
   * @param {string} conversationId - Conversation ID
   * @param {string} sessionId - Session ID
   * @param {string} title - New title
   */
  updateTitle(conversationId, sessionId, title) {
    updateConversationTitle({ id: conversationId, sessionId, title });
  }

  /**
   * Update conversation metadata
   * @param {string} conversationId - Conversation ID
   * @param {string} sessionId - Session ID
   * @param {Object} metadataPatch - Metadata updates
   */
  updateMetadata(conversationId, sessionId, metadataPatch) {
    updateConversationMetadata({ id: conversationId, sessionId, patch: metadataPatch });
  }

  /**
   * Update conversation provider ID
   * @param {string} conversationId - Conversation ID
   * @param {string} sessionId - Session ID
   * @param {string} providerId - New provider ID
   */
  updateProviderId(conversationId, sessionId, providerId) {
    updateConversationProviderId({ id: conversationId, sessionId, providerId });
  }
}
