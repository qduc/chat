import { upsertSession } from '../../db/sessions.js';
import { logger } from '../../logger.js';
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
import { computeMessageDiff, diffAssistantArtifacts, messagesEqual } from '../utils/messageDiff.js';
import { getDb } from '../../db/client.js';

/**
 * Handles core conversation persistence operations
 * Focused on database interactions without business logic or HTTP concerns
 */
export class ConversationManager {
  constructor() { }

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
      metadata: params.metadata || {},
      parentConversationId: params.parentConversationId || null,
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
    const normalized = Array.isArray(messages)
      ? messages.map(message => this._normalizeIncomingMessage(message))
      : [];

    const allExisting = getAllMessagesForSync({ conversationId });
    // Note: getAllMessagesForSync returns messages with id already transformed to client_message_id
    const existingByClientId = new Map();
    for (const message of allExisting) {
      if (message?.id != null) {
        existingByClientId.set(String(message.id), message);
      }
    }

  const matchedExisting = [];
  const incomingTail = [];
  const explicitUpdates = [];

    for (const incomingMessage of normalized) {
      const clientMessageId = incomingMessage?.id != null ? String(incomingMessage.id) : null;
      const existingMessage = clientMessageId ? existingByClientId.get(clientMessageId) : null;

      if (existingMessage) {
        matchedExisting.push(existingMessage);

        if (!messagesEqual(existingMessage, incomingMessage)) {
          explicitUpdates.push({
            ...incomingMessage,
            id: existingMessage.id,
            _dbId: existingMessage._dbId, // Preserve database integer ID for updates
            seq: existingMessage.seq
          });
        }
      } else {
        incomingTail.push(incomingMessage);
      }
    }

    const hasExistingMessages = allExisting.length > 0;
    const hasIncomingMessages = normalized.length > 0;
    if (hasExistingMessages && hasIncomingMessages && matchedExisting.length === 0) {
      const anchorCandidate = allExisting.length > 0
        ? (allExisting[allExisting.length - 1]?.seq || afterSeq || 0)
        : afterSeq;
      const isSingleNewMessage = incomingTail.length === normalized.length
        && incomingTail.length === 1
        && ['user', 'assistant', 'tool'].includes(incomingTail[0]?.role || '')
        && (incomingTail[0]?.id == null || !existingByClientId.has(String(incomingTail[0].id)));

      if (isSingleNewMessage) {
        logger.debug('[MessageSync] Appending single new message without id alignment', {
          conversationId,
          role: incomingTail[0]?.role,
          clientMessageId: incomingTail[0]?.id || null,
        });
        const diff = computeMessageDiff([], incomingTail);
        return this._applyMessageDiff(conversationId, userId, diff, anchorCandidate);
      }

      logger.debug('[MessageSync] No alignment on client IDs; falling back to clear-and-rewrite', {
        conversationId,
        incomingCount: normalized.length,
        existingCount: allExisting.length,
        afterSeq
      });
      return this._fallbackClearAndRewrite(conversationId, userId, normalized, afterSeq);
    }

    let anchorSeq = afterSeq || 0;
    if (matchedExisting.length > 0) {
      const highestMatchedSeq = matchedExisting.reduce((max, msg) => Math.max(max, msg.seq || 0), anchorSeq);
      anchorSeq = Math.max(anchorSeq, highestMatchedSeq);
    } else if (incomingTail.length > 0 && allExisting.length > 0) {
      anchorSeq = Math.max(anchorSeq, allExisting[allExisting.length - 1].seq || 0);
    }

    const existingTail = anchorSeq > 0
      ? allExisting.filter(msg => msg.seq > anchorSeq)
      : allExisting;

    const diff = computeMessageDiff(existingTail, incomingTail);
    if (explicitUpdates.length > 0) {
      diff.toUpdate.push(...explicitUpdates);
    }

    if (diff.fallback) {
      logger.warn(`[MessageSync] Fallback to clear-and-rewrite for conversation ${conversationId}: ${diff.reason}`);
      return this._fallbackClearAndRewrite(conversationId, userId, normalized, anchorSeq);
    }

    const stats = {
      existing: existingTail.length,
      incoming: incomingTail.length,
      inserted: diff.toInsert.length,
      updated: diff.toUpdate.length,
      deleted: diff.toDelete.length,
      unchanged: diff.unchanged.length,
      anchorSeq
    };
    logger.debug(`[MessageSync] Diff-based sync for conversation ${conversationId}:`, stats);

    return this._applyMessageDiff(conversationId, userId, diff, anchorSeq);
  }

  /**
   * Apply message diff transactionally
   * @param {string} conversationId - Conversation ID
   * @param {string} userId - User ID
   * @param {Object} diff - Diff result from computeMessageDiff
   * @private
   */
  _applyMessageDiff(conversationId, userId, diff, anchorSeq = 0) {
    const db = getDb();
    const idMappings = [];
    const insertedMessages = [];
    const updatedMessages = [];
    const deletedMessages = [];

    const transaction = db.transaction(() => {
      for (const msg of diff.toUpdate) {
        updatedMessages.push({ role: msg.role, id: msg.id, seq: msg.seq });

        // Use _dbId (integer) for database operations, fallback to id if _dbId not present
        const dbId = msg._dbId ?? msg.id;

        if (msg.role === 'tool') {
          updateMessageContent({
            messageId: dbId,
            conversationId,
            userId,
            content: msg.content,
            status: msg.status || 'success'
          });
          this._replaceToolOutputs({ messageId: dbId, conversationId, message: msg });
        } else {
          updateMessageContent({
            messageId: dbId,
            conversationId,
            userId,
            content: msg.content,
            reasoningDetails: msg.reasoning_details,
            reasoningTokens: msg.reasoning_tokens,
          });

          if (msg.role === 'assistant') {
            this._syncAssistantArtifacts(dbId, conversationId, msg);
          }
        }
      }

      if (diff.toDelete.length > 0) {
        const firstDeleteSeq = diff.toDelete[0].seq;
        deleteMessagesAfterSeq({
          conversationId,
          userId,
          afterSeq: Math.max(0, firstDeleteSeq - 1)
        });

        for (const msg of diff.toDelete) {
          deletedMessages.push({ role: msg.role, id: msg.id, seq: msg.seq });
        }
      }

      let nextSeq = getNextSeq(conversationId);
      for (const msg of diff.toInsert) {
        const hasUserContent = typeof msg.content === 'string' || Array.isArray(msg.content);
        const hasAssistantContent = msg.content !== undefined && msg.content !== null;
        const clientMessageId = msg.id != null ? String(msg.id) : null;

        if (msg.role === 'user' && hasUserContent) {
          const result = insertUserMessage({
            conversationId,
            content: msg.content,
            seq: nextSeq++,
            clientMessageId,
          });
          if (result?.id) {
            insertedMessages.push({ role: 'user', id: result.id, seq: result.seq });
            const mapping = {
              role: 'user',
              clientMessageId,
              persistedId: result.id,
              seq: result.seq
            };
            if (clientMessageId != null) {
              mapping.tempId = clientMessageId;
            }
            idMappings.push(mapping);
          }
        } else if (msg.role === 'assistant' && hasAssistantContent) {
          const result = insertAssistantFinal({
            conversationId,
            content: msg.content,
            seq: nextSeq++,
            finishReason: 'stop',
            reasoningDetails: msg.reasoning_details,
            reasoningTokens: msg.reasoning_tokens,
            clientMessageId,
          });

          if (result?.id) {
            this._insertAssistantArtifacts(result.id, conversationId, msg);
            insertedMessages.push({ role: 'assistant', id: result.id, seq: result.seq });
            const mapping = {
              role: 'assistant',
              clientMessageId,
              persistedId: result.id,
              seq: result.seq
            };
            if (clientMessageId != null) {
              mapping.tempId = clientMessageId;
            }
            idMappings.push(mapping);
          }
        } else if (msg.role === 'tool') {
          const toolContent = this._stringifyToolOutput(msg.content);
          const toolStatus = msg.status || 'success';
          const result = insertToolMessage({
            conversationId,
            content: toolContent,
            seq: nextSeq++,
            status: toolStatus,
            clientMessageId,
          });

          if (result?.id) {
            this._persistToolOutputs(result.id, conversationId, msg, toolContent, toolStatus);
            insertedMessages.push({ role: 'tool', id: result.id, seq: result.seq });
            const mapping = {
              role: 'tool',
              clientMessageId,
              persistedId: result.id,
              seq: result.seq
            };
            if (clientMessageId != null) {
              mapping.tempId = clientMessageId;
            }
            idMappings.push(mapping);
          }
        }
      }
    });

    transaction();

    return { idMappings, insertedMessages, updatedMessages, deletedMessages, anchorSeq };
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
      logger.debug('[ConversationManager] Skipping tool artifact sync (no incoming metadata)', {
        conversationId,
        messageId
      });
      return; // No tool metadata supplied, preserve existing records
    }

    const existingToolCalls = getToolCallsByMessageId(messageId);
    const existingToolOutputs = getToolOutputsByMessageId(messageId);

    const nextToolCalls = hasIncomingToolCalls ? message.tool_calls : existingToolCalls;
    const nextToolOutputs = hasIncomingToolOutputs ? message.tool_outputs : existingToolOutputs;

    logger.debug('[ConversationManager] Syncing tool artifacts', {
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
      logger.debug('[ConversationManager] Tool artifact diff fallback triggered', {
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
      logger.debug('[ConversationManager] Updating tool call', {
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
      logger.debug('[ConversationManager] Updating tool output', {
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
      logger.debug('[ConversationManager] Inserting tool calls', {
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
      logger.debug('[ConversationManager] Inserting tool outputs', {
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
    const idMappings = [];
    const insertedMessages = [];
    const deletedMessages = [];

    const existingToDelete = afterSeq > 0
      ? getAllMessagesForSync({ conversationId }).filter(msg => msg.seq > afterSeq)
      : getAllMessagesForSync({ conversationId });

    for (const msg of existingToDelete) {
      deletedMessages.push({ role: msg.role, id: msg.id, seq: msg.seq });
    }

    const transaction = db.transaction(() => {
      deleteMessagesAfterSeq({ conversationId, userId, afterSeq });

      let seq = afterSeq + 1;
      for (const message of messages) {
        const hasUserContent = typeof message.content === 'string' || Array.isArray(message.content);
        const hasAssistantContent = message.content !== undefined && message.content !== null;
        const clientMessageId = message.id != null ? String(message.id) : null;

        if (message.role === 'user' && hasUserContent) {
          const result = insertUserMessage({
            conversationId,
            content: message.content,
            seq: seq++,
            clientMessageId,
          });
          if (result?.id) {
            insertedMessages.push({ role: 'user', id: result.id, seq: result.seq });
            const mapping = {
              role: 'user',
              clientMessageId,
              persistedId: result.id,
              seq: result.seq
            };
            if (clientMessageId != null) {
              mapping.tempId = clientMessageId;
            }
            idMappings.push(mapping);
          }
        } else if (message.role === 'assistant' && hasAssistantContent) {
          const result = insertAssistantFinal({
            conversationId,
            content: message.content,
            seq: seq++,
            finishReason: 'stop',
            reasoningDetails: message.reasoning_details,
            reasoningTokens: message.reasoning_tokens,
            clientMessageId,
          });

          if (result?.id) {
            this._insertAssistantArtifacts(result.id, conversationId, message);
            insertedMessages.push({ role: 'assistant', id: result.id, seq: result.seq });
            const mapping = {
              role: 'assistant',
              clientMessageId,
              persistedId: result.id,
              seq: result.seq
            };
            if (clientMessageId != null) {
              mapping.tempId = clientMessageId;
            }
            idMappings.push(mapping);
          }
        } else if (message.role === 'tool') {
          const toolContent = this._stringifyToolOutput(message.content);
          const toolStatus = message.status || 'success';
          const result = insertToolMessage({
            conversationId,
            content: toolContent,
            seq: seq++,
            status: toolStatus,
            clientMessageId,
          });

          if (result?.id) {
            this._persistToolOutputs(result.id, conversationId, message, toolContent, toolStatus);
            insertedMessages.push({ role: 'tool', id: result.id, seq: result.seq });
            const mapping = {
              role: 'tool',
              clientMessageId,
              persistedId: result.id,
              seq: result.seq
            };
            if (clientMessageId != null) {
              mapping.tempId = clientMessageId;
            }
            idMappings.push(mapping);
          }
        }
      }
    });

    transaction();
    return { idMappings, insertedMessages, deletedMessages, updatedMessages: [], anchorSeq: afterSeq };
  }

  _normalizeIncomingMessage(message) {
    if (!message || typeof message !== 'object') {
      return message;
    }

    const normalized = { ...message };
    if (normalized.id != null && typeof normalized.id !== 'string') {
      normalized.id = String(normalized.id);
    }
    return normalized;
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
