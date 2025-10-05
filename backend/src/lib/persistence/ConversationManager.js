import { upsertSession } from '../../db/sessions.js';
import {
  getConversationById,
  createConversation,
  updateConversationTitle,
  updateConversationMetadata,
  updateConversationProviderId,
  updateConversationModel,
  updateConversationSettings,
} from '../../db/conversations.js';
import {
  clearAllMessages,
  insertUserMessage,
  insertAssistantFinal,
  markAssistantErrorBySeq,
  getNextSeq,
  getMessagesPage,
} from '../../db/messages.js';
import { insertToolCalls, insertToolOutputs } from '../../db/toolCalls.js';
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
   * @param {string} userId - User ID
   * @param {Object} sessionData - Additional session data
   */
  ensureSession(sessionId, userId, sessionData = {}) {
    if (!sessionId || !userId) return;
    upsertSession(sessionId, { userId, ...sessionData });
  }

  /**
   * Get conversation by ID and validate ownership
   * @param {string} conversationId - Conversation ID
   * @param {string} userId - User ID
   * @returns {Object|null} Conversation object or null if not found
   */
  getConversation(conversationId, userId) {
    return getConversationById({ id: conversationId, userId });
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
   * @param {string} userId - User ID
   * @param {Array} messages - Array of messages to insert
   */
  syncMessageHistory(conversationId, userId, messages) {
    const preservedAssistants = this._loadExistingAssistantToolData(conversationId);

    // Clear existing messages
    clearAllMessages({ conversationId, userId });

    // Insert new messages in sequence, preserving tool data for assistant messages
    let seq = 1;
    let assistantIndex = 0;
    for (const message of messages) {
      // Support both string content and array (mixed content with images)
      const hasContent = typeof message.content === 'string' || Array.isArray(message.content);

      if (message.role === 'user' && hasContent) {
        insertUserMessage({
          conversationId,
          content: message.content,
          seq: seq++,
        });
      } else if (message.role === 'assistant' && typeof message.content === 'string') {
        const result = insertAssistantFinal({
          conversationId,
          content: message.content,
          seq: seq++,
          finishReason: 'stop',
        });

        const preserved = preservedAssistants[assistantIndex++] || null;
        if (preserved && result?.id) {
          if (Array.isArray(preserved.tool_calls) && preserved.tool_calls.length > 0) {
            insertToolCalls({
              messageId: result.id,
              conversationId,
              toolCalls: preserved.tool_calls,
            });
          }

          if (Array.isArray(preserved.tool_outputs) && preserved.tool_outputs.length > 0) {
            insertToolOutputs({
              messageId: result.id,
              conversationId,
              toolOutputs: preserved.tool_outputs,
            });
          }
        }
      }
    }
  }

  _loadExistingAssistantToolData(conversationId) {
    if (!conversationId) return [];

    const assistantData = [];
    let afterSeq = 0;

    while (true) {
      const page = getMessagesPage({ conversationId, afterSeq, limit: 200 });
      const pageMessages = page?.messages || [];

      for (const message of pageMessages) {
        if (message.role === 'assistant') {
          assistantData.push({
            tool_calls: Array.isArray(message.tool_calls) ? message.tool_calls : [],
            tool_outputs: Array.isArray(message.tool_outputs) ? message.tool_outputs : [],
          });
        }
      }

      if (!page?.next_after_seq) break;
      afterSeq = page.next_after_seq;
    }

    return assistantData;
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
   * @returns {Object} Result with message ID and sequence
   */
  recordAssistantMessage(params) {
    return insertAssistantFinal({
      conversationId: params.conversationId,
      content: params.content,
      seq: params.seq,
      finishReason: params.finishReason || 'stop',
      responseId: params.responseId || null,
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
   * @param {string} userId - User ID
   * @param {string} title - New title
   */
  updateTitle(conversationId, userId, title) {
    updateConversationTitle({ id: conversationId, userId, title });
  }

  /**
   * Update conversation metadata
   * @param {string} conversationId - Conversation ID
   * @param {string} userId - User ID
   * @param {Object} metadataPatch - Metadata updates
   */
  updateMetadata(conversationId, userId, metadataPatch) {
    updateConversationMetadata({ id: conversationId, userId, patch: metadataPatch });
  }

  /**
   * Update conversation provider ID
   * @param {string} conversationId - Conversation ID
   * @param {string} userId - User ID
   * @param {string} providerId - New provider ID
   */
  updateProviderId(conversationId, userId, providerId) {
    updateConversationProviderId({ id: conversationId, userId, providerId });
  }

  /**
   * Update conversation model
   * @param {string} conversationId - Conversation ID
   * @param {string} userId - User ID
   * @param {string} model - New model
   */
  updateModel(conversationId, userId, model) {
    updateConversationModel({ id: conversationId, userId, model });
  }

  /**
   * Update conversation settings (streaming, tools, quality, reasoning, verbosity)
   * @param {string} conversationId - Conversation ID
   * @param {string} userId - User ID
   * @param {Object} settings - Settings to update
   * @param {boolean} [settings.streamingEnabled] - Enable streaming
   * @param {boolean} [settings.toolsEnabled] - Enable tools
   * @param {string} [settings.qualityLevel] - Quality level
   * @param {string} [settings.reasoningEffort] - Reasoning effort
   * @param {string} [settings.verbosity] - Verbosity level
   */
  updateSettings(conversationId, userId, settings) {
    updateConversationSettings({ id: conversationId, userId, ...settings });
  }
}
