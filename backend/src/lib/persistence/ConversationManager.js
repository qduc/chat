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
  getAllMessagesForSync,
  updateMessageContent,
  deleteMessagesAfterSeq,
} from '../../db/messages.js';
import {
  insertToolCalls,
  insertToolOutputs,
  updateToolCall,
  updateToolOutput,
  replaceAssistantArtifacts,
  getToolCallsByMessageId,
  getToolOutputsByMessageId,
} from '../../db/toolCalls.js';
import { v4 as uuidv4 } from 'uuid';
import { computeMessageDiff, diffAssistantArtifacts } from '../utils/messageDiff.js';
import { getDb } from '../../db/client.js';

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
   * @deprecated Use syncMessageHistoryDiff instead. Will be removed in v2.0
   * @param {string} conversationId - Conversation ID
   * @param {string} userId - User ID
   * @param {Array} messages - Array of messages to insert
   */
  syncMessageHistory(conversationId, userId, messages) {
    console.warn('syncMessageHistory is deprecated. Consider using syncMessageHistoryDiff for better performance.');
    return this._legacySyncMessageHistory(conversationId, userId, messages);
  }

  /**
   * Sync message history using diff-based approach
   * Falls back to legacy clear-and-rewrite if alignment is unsafe
   * @param {string} conversationId - Conversation ID
   * @param {string} userId - User ID
   * @param {Array} messages - Array of messages to insert
   */
  syncMessageHistoryDiff(conversationId, userId, messages) {
    // 1. Load existing messages once
    const existing = getAllMessagesForSync({ conversationId });

    // 2. Compute diff (may signal fallback)
    const diff = computeMessageDiff(existing, messages);

    // 3. Fall back if alignment failed or safety checks require it
    if (diff.fallback) {
      console.warn(`Message sync falling back to legacy mode: ${diff.reason}`);
      return this._legacySyncMessageHistory(conversationId, userId, messages);
    }

    // 4. Apply changes transactionally with existing seq anchors
    this._applyMessageDiff(conversationId, userId, diff);
  }

  /**
   * Apply message diff transactionally
   * @param {string} conversationId - Conversation ID
   * @param {string} userId - User ID
   * @param {Object} diff - Diff result from computeMessageDiff
   * @private
   */
  _applyMessageDiff(conversationId, userId, diff) {
    const db = getDb();
    const transaction = db.transaction(() => {
      // Messages before diff.anchorOffset are already identical and skipped

      // UPDATE modified messages
      for (const msg of diff.toUpdate) {
        // Update message content
        updateMessageContent({
          messageId: msg.id,
          conversationId,
          userId,
          content: msg.content
        });

        // Handle tool metadata updates for assistant messages
        if (msg.role === 'assistant') {
          this._syncAssistantArtifacts(msg.id, conversationId, msg);
        }
      }

      // INSERT new messages
      let nextSeq = getNextSeq(conversationId);
      for (const msg of diff.toInsert) {
        const hasContent = typeof msg.content === 'string' || Array.isArray(msg.content);

        if (msg.role === 'user' && hasContent) {
          insertUserMessage({
            conversationId,
            content: msg.content,
            seq: nextSeq++,
          });
        } else if (msg.role === 'assistant' && typeof msg.content === 'string') {
          const result = insertAssistantFinal({
            conversationId,
            content: msg.content,
            seq: nextSeq++,
            finishReason: 'stop',
          });

          // Insert tool metadata if present
          if (result?.id) {
            this._insertAssistantArtifacts(result.id, conversationId, msg);
          }
        }
      }

      // DELETE from tail only
      if (diff.toDelete.length > 0) {
        const firstDeleteSeq = diff.toDelete[0].seq;
        deleteMessagesAfterSeq({
          conversationId,
          userId,
          afterSeq: firstDeleteSeq - 1
        });
      }
    });

    transaction();
  }

  /**
   * Sync assistant message artifacts (tool calls/outputs)
   * @param {number} messageId - Message ID
   * @param {string} conversationId - Conversation ID
   * @param {Object} message - Message with tool metadata
   * @private
   */
  _syncAssistantArtifacts(messageId, conversationId, message) {
    const existingToolCalls = getToolCallsByMessageId(messageId);
    const existingToolOutputs = getToolOutputsByMessageId(messageId);

    const nextToolCalls = message.tool_calls || [];
    const nextToolOutputs = message.tool_outputs || [];

    // Try granular diff first
    const artifactDiff = diffAssistantArtifacts({
      existingToolCalls,
      existingToolOutputs,
      nextToolCalls,
      nextToolOutputs
    });

    if (artifactDiff.fallback) {
      // Fall back to replace strategy
      replaceAssistantArtifacts({
        messageId,
        conversationId,
        toolCalls: nextToolCalls,
        toolOutputs: nextToolOutputs
      });
      return;
    }

    // Apply granular updates
    for (const tc of artifactDiff.toolCallsToUpdate) {
      updateToolCall({
        id: tc.id,
        toolName: tc.function?.name || tc.tool_name,
        arguments: tc.function?.arguments || tc.arguments
      });
    }

    for (const to of artifactDiff.toolOutputsToUpdate) {
      updateToolOutput({
        id: to.id,
        output: to.output,
        status: to.status
      });
    }

    // Insert new tool calls/outputs
    if (artifactDiff.toolCallsToInsert.length > 0) {
      insertToolCalls({
        messageId,
        conversationId,
        toolCalls: artifactDiff.toolCallsToInsert
      });
    }

    if (artifactDiff.toolOutputsToInsert.length > 0) {
      insertToolOutputs({
        messageId,
        conversationId,
        toolOutputs: artifactDiff.toolOutputsToInsert
      });
    }
  }

  /**
   * Insert assistant message artifacts (tool calls/outputs)
   * @param {number} messageId - Message ID
   * @param {string} conversationId - Conversation ID
   * @param {Object} message - Message with tool metadata
   * @private
   */
  _insertAssistantArtifacts(messageId, conversationId, message) {
    if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
      insertToolCalls({
        messageId,
        conversationId,
        toolCalls: message.tool_calls,
      });
    }

    if (Array.isArray(message.tool_outputs) && message.tool_outputs.length > 0) {
      insertToolOutputs({
        messageId,
        conversationId,
        toolOutputs: message.tool_outputs,
      });
    }
  }

  /**
   * Legacy sync implementation (clear-and-rewrite)
   * @param {string} conversationId - Conversation ID
   * @param {string} userId - User ID
   * @param {Array} messages - Array of messages to insert
   * @private
   */
  _legacySyncMessageHistory(conversationId, userId, messages) {
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
