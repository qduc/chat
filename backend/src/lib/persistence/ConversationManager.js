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
  insertUserMessage,
  insertAssistantFinal,
  markAssistantErrorBySeq,
  getNextSeq,
  getAllMessagesForSync,
  updateMessageContent,
  deleteMessagesAfterSeq,
  insertToolMessage,
} from '../../db/messages.js';
import {
  insertToolCalls,
  insertToolOutputs,
  updateToolCall,
  updateToolOutput,
  replaceAssistantArtifacts,
  getToolCallsByMessageId,
  getToolOutputsByMessageId,
  deleteToolCallsAndOutputsByMessageId,
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
   * Sync message history using diff-based approach
   * Falls back to clear-and-rewrite if alignment is unsafe
   * @param {string} conversationId - Conversation ID
   * @param {string} userId - User ID
   * @param {Array} messages - Array of messages to insert
   * @param {number} afterSeq - Only sync messages after this sequence number (0 = all messages)
   */
  syncMessageHistoryDiff(conversationId, userId, messages, afterSeq = 0) {
    // 1. Load existing messages after the specified sequence number
    const allExisting = getAllMessagesForSync({ conversationId });
    const existing = afterSeq > 0
      ? allExisting.filter(msg => msg.seq > afterSeq)
      : allExisting;

    // 2. Compute diff (may signal fallback)
    const diff = computeMessageDiff(existing, messages);

    // 3. Fall back to clear-and-rewrite if alignment failed or safety checks require it
    if (diff.fallback) {
      console.warn(`[MessageSync] Fallback to clear-and-rewrite for conversation ${conversationId}: ${diff.reason}`);
      this._fallbackClearAndRewrite(conversationId, userId, messages, afterSeq);
      return;
    }

    // 4. Log alignment metrics for monitoring
    const stats = {
      existing: existing.length,
      incoming: messages.length,
      inserted: diff.toInsert.length,
      updated: diff.toUpdate.length,
      deleted: diff.toDelete.length,
      unchanged: diff.unchanged.length,
      anchorOffset: diff.anchorOffset
    };
    console.log(`[MessageSync] Diff-based sync for conversation ${conversationId}:`, stats);

    // 5. Apply changes transactionally with existing seq anchors
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
        if (msg.role === 'tool') {
          updateMessageContent({
            messageId: msg.id,
            conversationId,
            userId,
            content: msg.content,
            status: msg.status || 'success'
          });
          this._replaceToolOutputs({ messageId: msg.id, conversationId, message: msg });
        } else {
          // Update message content
          updateMessageContent({
            messageId: msg.id,
            conversationId,
            userId,
            content: msg.content,
            reasoningDetails: msg.reasoning_details,
            reasoningTokens: msg.reasoning_tokens,
          });

          // Handle tool metadata updates for assistant messages
          if (msg.role === 'assistant') {
            this._syncAssistantArtifacts(msg.id, conversationId, msg);
          }
        }
      }

      // DELETE from tail only (perform before insertions to avoid removing new rows)
      if (diff.toDelete.length > 0) {
        const firstDeleteSeq = diff.toDelete[0].seq;
        deleteMessagesAfterSeq({
          conversationId,
          userId,
          afterSeq: Math.max(0, firstDeleteSeq - 1)
        });
      }

      // INSERT new messages
      let nextSeq = getNextSeq(conversationId);
      for (const msg of diff.toInsert) {
        const hasUserContent = typeof msg.content === 'string' || Array.isArray(msg.content);
        const hasAssistantContent = msg.content !== undefined && msg.content !== null;

        if (msg.role === 'user' && hasUserContent) {
          insertUserMessage({
            conversationId,
            content: msg.content,
            seq: nextSeq++,
          });
        } else if (msg.role === 'assistant' && hasAssistantContent) {
          const result = insertAssistantFinal({
            conversationId,
            content: msg.content,
            seq: nextSeq++,
            finishReason: 'stop',
            reasoningDetails: msg.reasoning_details,
            reasoningTokens: msg.reasoning_tokens,
          });

          // Insert tool metadata if present
          if (result?.id) {
            this._insertAssistantArtifacts(result.id, conversationId, msg);
          }
        } else if (msg.role === 'tool') {
          const toolContent = this._stringifyToolOutput(msg.content);
          const toolStatus = msg.status || 'success';
          const result = insertToolMessage({
            conversationId,
            content: toolContent,
            seq: nextSeq++,
            status: toolStatus,
          });

          if (result?.id) {
            this._persistToolOutputs(result.id, conversationId, msg, toolContent, toolStatus);
          }
        }
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
    const hasIncomingToolCalls = Array.isArray(message.tool_calls);
    const hasIncomingToolOutputs = Array.isArray(message.tool_outputs);

    if (!hasIncomingToolCalls && !hasIncomingToolOutputs) {
      console.log('[ConversationManager] Skipping tool artifact sync (no incoming metadata)', {
        conversationId,
        messageId
      });
      return; // No tool metadata supplied, preserve existing records
    }

    const existingToolCalls = getToolCallsByMessageId(messageId);
    const existingToolOutputs = getToolOutputsByMessageId(messageId);

    const nextToolCalls = hasIncomingToolCalls ? message.tool_calls : existingToolCalls;
    const nextToolOutputs = hasIncomingToolOutputs ? message.tool_outputs : existingToolOutputs;

    console.log('[ConversationManager] Syncing tool artifacts', {
      conversationId,
      messageId,
      incoming: {
        toolCalls: Array.isArray(message.tool_calls) ? message.tool_calls.length : 'preserve',
        toolOutputs: Array.isArray(message.tool_outputs) ? message.tool_outputs.length : 'preserve'
      },
      existing: {
        toolCalls: existingToolCalls.length,
        toolOutputs: existingToolOutputs.length
      }
    });

    // Try granular diff first
    const artifactDiff = diffAssistantArtifacts({
      existingToolCalls,
      existingToolOutputs,
      nextToolCalls,
      nextToolOutputs
    });

    if (artifactDiff.fallback) {
      // Fall back to replace strategy
      console.log('[ConversationManager] Tool artifact diff fallback triggered', {
        conversationId,
        messageId,
        reason: artifactDiff.reason || 'unknown'
      });
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
      console.log('[ConversationManager] Updating tool call', {
        id: tc.id,
        conversationId,
        messageId
      });
      updateToolCall({
        id: tc.id,
        toolName: tc.function?.name || tc.tool_name,
        arguments: tc.function?.arguments || tc.arguments
      });
    }

    for (const to of artifactDiff.toolOutputsToUpdate) {
      console.log('[ConversationManager] Updating tool output', {
        id: to.id,
        conversationId,
        messageId
      });
      updateToolOutput({
        id: to.id,
        output: to.output,
        status: to.status
      });
    }

    // Insert new tool calls/outputs
    if (artifactDiff.toolCallsToInsert.length > 0) {
      console.log('[ConversationManager] Inserting tool calls', {
        conversationId,
        messageId,
        count: artifactDiff.toolCallsToInsert.length
      });
      insertToolCalls({
        messageId,
        conversationId,
        toolCalls: artifactDiff.toolCallsToInsert
      });
    }

    if (artifactDiff.toolOutputsToInsert.length > 0) {
      console.log('[ConversationManager] Inserting tool outputs', {
        conversationId,
        messageId,
        count: artifactDiff.toolOutputsToInsert.length
      });
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

  _persistToolOutputs(messageId, conversationId, message, fallbackContent, fallbackStatus) {
    const outputs = this._normalizeToolOutputs(message, fallbackContent, fallbackStatus);
    if (outputs.length === 0) return;

    insertToolOutputs({
      messageId,
      conversationId,
      toolOutputs: outputs,
    });
  }

  _replaceToolOutputs({ messageId, conversationId, message }) {
    deleteToolCallsAndOutputsByMessageId(messageId);
    const fallbackContent = this._stringifyToolOutput(message.content);
    const fallbackStatus = message.status || 'success';
    this._persistToolOutputs(messageId, conversationId, message, fallbackContent, fallbackStatus);
  }

  _normalizeToolOutputs(message, fallbackContent, fallbackStatus) {
    if (Array.isArray(message.tool_outputs) && message.tool_outputs.length > 0) {
      return message.tool_outputs.map(output => ({
        tool_call_id: output.tool_call_id || message.tool_call_id,
        output: this._stringifyToolOutput(output.output ?? fallbackContent),
        status: output.status || fallbackStatus || 'success'
      })).filter(output => !!output.tool_call_id);
    }

    if (message.tool_call_id) {
      return [{
        tool_call_id: message.tool_call_id,
        output: fallbackContent,
        status: fallbackStatus || 'success'
      }];
    }

    return [];
  }

  _stringifyToolOutput(content) {
    if (typeof content === 'string') {
      return content;
    }
    if (content === undefined || content === null) {
      return '';
    }
    try {
      return JSON.stringify(content);
    } catch {
      return String(content);
    }
  }

  /**
   * Fallback to clear-and-rewrite when diff-based sync cannot proceed safely
   * This is a simplified version that doesn't preserve tool metadata from existing messages
   * since the frontend should be sending the complete message history including tools
   * @param {string} conversationId - Conversation ID
   * @param {string} userId - User ID
   * @param {Array} messages - Array of messages to insert
   * @param {number} afterSeq - Only delete and rewrite messages after this sequence number
   * @private
   */
  _fallbackClearAndRewrite(conversationId, userId, messages, afterSeq = 0) {
    const db = getDb();
    const transaction = db.transaction(() => {
      // Delete messages after the specified sequence (cascades to tool_calls and tool_outputs)
      deleteMessagesAfterSeq({ conversationId, userId, afterSeq });

      // Insert all messages fresh starting from afterSeq + 1
      let seq = afterSeq + 1;
      for (const message of messages) {
        const hasUserContent = typeof message.content === 'string' || Array.isArray(message.content);
        const hasAssistantContent = message.content !== undefined && message.content !== null;

        if (message.role === 'user' && hasUserContent) {
          insertUserMessage({
            conversationId,
            content: message.content,
            seq: seq++,
          });
        } else if (message.role === 'assistant' && hasAssistantContent) {
          const result = insertAssistantFinal({
            conversationId,
            content: message.content,
            seq: seq++,
            finishReason: 'stop',
            reasoningDetails: message.reasoning_details,
            reasoningTokens: message.reasoning_tokens,
          });

          // Insert tool metadata if present in the incoming message
          if (result?.id) {
            this._insertAssistantArtifacts(result.id, conversationId, message);
          }
        } else if (message.role === 'tool') {
          const toolContent = this._stringifyToolOutput(message.content);
          const toolStatus = message.status || 'success';
          const result = insertToolMessage({
            conversationId,
            content: toolContent,
            seq: seq++,
            status: toolStatus,
          });

          if (result?.id) {
            this._persistToolOutputs(result.id, conversationId, message, toolContent, toolStatus);
          }
        }
      }
    });

    transaction();
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
      reasoningDetails: params.reasoningDetails,
      reasoningTokens: params.reasoningTokens,
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
