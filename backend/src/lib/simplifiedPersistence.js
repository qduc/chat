import {
  getDb,
  upsertSession,
  getConversationById,
  countMessagesByConversation,
  getNextSeq,
  insertUserMessage,
  insertAssistantFinal,
  markAssistantErrorBySeq,
  createConversation,
  countConversationsBySession,
} from '../db/index.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * Simplified persistence manager that implements final-only writes
 * Consolidates the dual abstraction of persistenceHandler + PersistenceManager
 */
export class SimplifiedPersistence {
  constructor(config) {
    this.config = config;
    this.persist = false;
    this.conversationId = null;
    this.assistantSeq = null;
    this.assistantBuffer = '';
    this.finalized = false;
    this.errored = false;
    this.conversationMeta = null; // Store conversation metadata
  }

  /**
   * Initialize persistence for a request
   * @param {Object} params - Initialization parameters
   * @param {string|null} params.conversationId - Conversation ID
   * @param {string} params.sessionId - Session ID
   * @param {Object} params.req - Express request object
   * @param {Object} params.res - Express response object
   * @param {Object} params.bodyIn - Original request body
   * @returns {Promise<void>}
   */
  async initialize({ conversationId, sessionId, req, res, bodyIn }) {
    // Check if persistence is enabled
    const persistenceEnabled = this.config?.persistence?.enabled || false;

    if (!persistenceEnabled || !sessionId) {
      this.persist = false;
      return;
    }

    // Ensure DB session row
    getDb();
    upsertSession(sessionId, {
      userAgent: req.header('user-agent') || null,
    });

    let convo = null;

    // If conversation ID provided, validate it exists and belongs to session
    if (conversationId) {
      convo = getConversationById({ id: conversationId, sessionId });
      if (!convo) {
        // Invalid conversation ID - ignore and auto-create new one
        conversationId = null;
      }
    }

    // Auto-create conversation if none provided or invalid
    if (!conversationId) {
      // Check conversation limit before creating
      const conversationCount = countConversationsBySession(sessionId);
      const maxConversations = this.config?.persistence?.maxConversationsPerSession || 100;

      if (conversationCount >= maxConversations) {
        res.status(429).json({
          error: 'limit_exceeded',
          message: 'Max conversations per session reached',
        });
        throw new Error('Conversation limit exceeded');
      }

      // Create new conversation
      const newConversationId = uuidv4();
      const model = bodyIn.model || this.config.defaultModel || null;

      createConversation({
        id: newConversationId,
        sessionId,
        title: null, // Will be auto-generated from first message if needed
        model
      });

      conversationId = newConversationId;
      convo = getConversationById({ id: conversationId, sessionId });
    }

    // Enforce message limit
    const cnt = countMessagesByConversation(conversationId);
    const maxMessages = this.config?.persistence?.maxMessagesPerConversation || 1000;
    if (cnt >= maxMessages) {
      res.status(429).json({
        error: 'limit_exceeded',
        message: 'Max messages per conversation reached',
      });
      throw new Error('Message limit exceeded');
    }

    // Determine next seq for user and assistant
    const userSeq = getNextSeq(conversationId);

    // Persist user message if available
    const msgs = Array.isArray(bodyIn.messages) ? bodyIn.messages : [];
    const lastUser = [...msgs]
      .reverse()
      .find((m) => m && m.role === 'user' && typeof m.content === 'string');

    if (lastUser) {
      insertUserMessage({
        conversationId,
        content: lastUser.content,
        seq: userSeq,
      });
    }

    // Setup for assistant message - but don't create draft yet
    this.persist = true;
    this.conversationId = conversationId;
    this.assistantSeq = userSeq + 1;
    this.assistantBuffer = '';
    this.conversationMeta = convo; // Store conversation metadata for response
  }

  /**
   * Record user message (for cases where it's not in bodyIn.messages)
   * @param {Object} params - Message parameters
   * @param {string} params.content - Message content
   */
  recordUserMessage({ content }) {
    if (!this.persist || !this.conversationId) return;

    const userSeq = getNextSeq(this.conversationId);
    insertUserMessage({
      conversationId: this.conversationId,
      content,
      seq: userSeq,
    });

    // Update assistant seq
    this.assistantSeq = userSeq + 1;
  }

  /**
   * Buffer assistant content (no immediate DB write)
   * @param {string} delta - Content delta to add
   */
  appendContent(delta) {
    if (!this.persist) return;
    this.assistantBuffer += delta || '';
  }

  /**
   * Record final assistant message
   * @param {Object} params - Finalization parameters
   * @param {string|null} params.finishReason - Finish reason
   */
  recordAssistantFinal({ finishReason = 'stop' } = {}) {
    if (!this.persist || !this.conversationId || this.assistantSeq === null) return;
    if (this.finalized || this.errored) return;

    try {
      insertAssistantFinal({
        conversationId: this.conversationId,
        content: this.assistantBuffer,
        seq: this.assistantSeq,
        finishReason,
      });
      this.finalized = true;
    } catch (error) {
      console.error('[SimplifiedPersistence] Failed to record final assistant message:', error);
      throw error;
    }
  }

  /**
   * Mark assistant message as error
   */
  markError() {
    if (!this.persist || !this.conversationId || this.assistantSeq === null) return;
    if (this.finalized || this.errored) return;

    try {
      markAssistantErrorBySeq({
        conversationId: this.conversationId,
        seq: this.assistantSeq,
      });
      this.errored = true;
    } catch (error) {
      console.error('[SimplifiedPersistence] Failed to mark error:', error);
      // Don't re-throw as this is cleanup
    }
  }

  /**
   * Cleanup resources (no-op in final-only approach)
   */
  cleanup() {
    // No timers or resources to clean up in final-only approach
  }

  /**
   * Get current state for legacy compatibility
   */
  getState() {
    return {
      persist: this.persist,
      conversationId: this.conversationId,
      assistantSeq: this.assistantSeq,
      bufferLength: this.assistantBuffer.length,
      conversationMeta: this.conversationMeta,
    };
  }
}
