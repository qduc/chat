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
  updateConversationTitle,
} from '../db/index.js';
import { v4 as uuidv4 } from 'uuid';
import { createOpenAIRequest } from './streamUtils.js';
import { providerIsConfigured } from './providers/index.js';

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
    this.providerId = undefined; // Track frontend-selected provider for consistency
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

    // Capture provider id from request for later use (e.g., title generation)
    this.providerId = bodyIn?.provider_id || req.header('x-provider-id') || undefined;

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

      // Derive persisted settings from request body. Support both explicit
      // persistence flags and OpenAI-compatible fields used by the client.
      const persistedStreamingEnabled =
        bodyIn.streamingEnabled !== undefined
          ? !!bodyIn.streamingEnabled
          : !!bodyIn.stream; // map `stream` => persisted flag

      const persistedToolsEnabled =
        bodyIn.toolsEnabled !== undefined
          ? !!bodyIn.toolsEnabled
          : (Array.isArray(bodyIn.tools) && bodyIn.tools.length > 0); // map tools array presence

      createConversation({
        id: newConversationId,
        sessionId,
        title: null, // Will be auto-generated from first message if needed
        model,
        streamingEnabled: persistedStreamingEnabled,
        toolsEnabled: persistedToolsEnabled,
        qualityLevel: bodyIn.qualityLevel || null,
        reasoningEffort: bodyIn.reasoningEffort || null,
        verbosity: bodyIn.verbosity || null
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

      // Attempt to auto-generate a title if conversation has none
      try {
        if (!convo?.title) {
          const generated = await this.generateConversationTitle(lastUser.content);
          if (generated) {
            updateConversationTitle({ id: conversationId, sessionId, title: generated });
            // Refresh conversation meta locally
            this.conversationMeta = { ...(convo || {}), id: conversationId, title: generated };
          }
        }
      } catch (err) {
        // Non-fatal: log and continue
        console.warn('[SimplifiedPersistence] Title generation failed:', err?.message || err);
      }
    }

    // Setup for assistant message - but don't create draft yet
    this.persist = true;
    this.conversationId = conversationId;
    this.assistantSeq = userSeq + 1;
    this.assistantBuffer = '';
    this.conversationMeta = this.conversationMeta || convo; // Store conversation metadata for response
  }

  /**
   * Generate a concise conversation title from the user's first message using OpenAI
   * @param {string} content - User message content
   * @returns {Promise<string|null>} - Generated title or null
   */
  async generateConversationTitle(content) {
    try {
      const text = String(content || '').trim();
      if (!text) return null;

      // Fallback if provider isn't configured
      if (!providerIsConfigured(this.config)) {
        return this.fallbackTitle(text);
      }

      const promptUser = text.length > 500 ? text.slice(0, 500) + '…' : text;
      const requestBody = {
        model: this.config.titleModel || this.config.defaultModel || 'gpt-4.1-mini',
        temperature: 0.2,
        max_tokens: 20,
        messages: [
          {
            role: 'system',
            content:
              'You create a very short, descriptive chat title (max 6 words). Output only the title, no quotes, no punctuation at the end.'
          },
          { role: 'user', content: `Create a short title for: ${promptUser}` },
        ],
      };

      const resp = await createOpenAIRequest(this.config, requestBody, { providerId: this.providerId });
      if (!resp.ok) {
        // Fall back gracefully
        return this.fallbackTitle(text);
      }
      const body = await resp.json();
      const raw = body?.choices?.[0]?.message?.content || '';
      let title = String(raw).replace(/^["'\s]+|["'\s]+$/g, '').replace(/[\r\n]+/g, ' ').trim();
      if (!title) return this.fallbackTitle(text);
      if (title.length > 80) title = title.slice(0, 77) + '…';
      return title;
    } catch (e) {
      return this.fallbackTitle(String(content || ''));
    }
  }

  /**
   * Fallback title generator based on user content
   */
  fallbackTitle(text) {
    const cleaned = String(text || '').trim().replace(/[\r\n]+/g, ' ');
    if (!cleaned) return null;
    const words = cleaned.split(/\s+/).slice(0, 6).join(' ');
    return words.length > 80 ? words.slice(0, 77) + '…' : words;
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
