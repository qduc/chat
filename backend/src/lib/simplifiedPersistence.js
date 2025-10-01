import { getDb } from '../db/client.js';
import {
  ConversationManager,
  ConversationValidator,
  ConversationTitleService,
  PersistenceConfig,
  ToolCallPersistence,
} from './persistence/index.js';

/**
 * Simplified persistence manager that implements final-only writes
 * Uses composition pattern with specialized components for better maintainability
 */
export class SimplifiedPersistence {
  constructor(config) {
    this.persistenceConfig = new PersistenceConfig(config);
    this.conversationManager = new ConversationManager();
    this.validator = new ConversationValidator(config);
    this.titleService = new ConversationTitleService(config);

    // Runtime state
    this.persist = false;
    this.conversationId = null;
    this.assistantSeq = null;
    this.assistantBuffer = '';
    this.finalized = false;
    this.errored = false;
    this.conversationMeta = null;
    this.providerId = undefined;
    this.responseId = null; // Store response_id for OpenAI state management
    this.currentMessageId = null; // Track current assistant message ID for tool call persistence
    this.toolCalls = []; // Buffer tool calls during streaming
    this.toolOutputs = []; // Buffer tool outputs during streaming
  }

  /**
   * Initialize persistence for a request
   * @param {Object} params - Initialization parameters
   * @param {string|null} params.conversationId - Conversation ID
   * @param {string} params.sessionId - Session ID
   * @param {string|null} params.userId - User ID (if authenticated)
   * @param {Object} params.req - Express request object
   * @param {Object} params.bodyIn - Original request body
   * @returns {Promise<{error?: Object}>} Error object if validation fails
   */
  async initialize({ conversationId, sessionId, userId = null, req, bodyIn }) {
    // Store user context for later use
    this.userId = userId;

    // Check if persistence is enabled
    // Prioritize user-based persistence - require either userId OR sessionId
    if (!this.persistenceConfig.isPersistenceEnabled()) {
      this.persist = false;
      return {};
    }

    // For authenticated users, user ID is sufficient for persistence
    if (!userId) {
      this.persist = false;
      return {};
    }

    // Initialize database connection and session (only if we have sessionId)
    getDb();
    if (sessionId) {
      this.conversationManager.ensureSession(sessionId, {
        userAgent: req.header('user-agent') || null,
      });
    }

    // Extract provider ID
    this.providerId = this.persistenceConfig.extractProviderId(bodyIn, req);

    // Handle existing conversation or create new one
    const result = await this._handleConversation({ conversationId, sessionId, userId, bodyIn });
    if (result.error) {
      return result;
    }

    // Process message history and generate title if needed
    await this._processMessageHistory(sessionId, userId, bodyIn);

    // Setup for assistant message recording
    this._setupAssistantRecording();

    // Handle metadata updates for existing conversations
    await this._handleMetadataUpdates(sessionId, userId, bodyIn);

    return {};
  }

  /**
   * Handle conversation creation or validation
   * @private
   */
  async _handleConversation({ conversationId, sessionId, userId, bodyIn }) {
    let convo = null;
    let isNewConversation = false;

    // If conversation ID provided, try to get existing conversation
    if (conversationId) {
      convo = this.conversationManager.getConversation(conversationId, sessionId, userId);
      if (!convo) {
        // Invalid conversation ID - will auto-create new one
        conversationId = null;
        isNewConversation = true;
      }
    } else {
      isNewConversation = true;
    }

    // Validate request before proceeding
    const validationError = this.validator.validateRequest({
      conversationId,
      sessionId,
      existingConversation: convo,
      isNewConversation
    });

    if (validationError) {
      return { error: validationError };
    }

    // Create new conversation if needed
    if (isNewConversation) {
      const settings = await this.persistenceConfig.extractRequestSettingsAsync(bodyIn, userId);
      conversationId = this.conversationManager.createNewConversation({
        sessionId,
        userId, // Pass user context
        providerId: this.providerId,
        ...settings
      });
      convo = this.conversationManager.getConversation(conversationId, sessionId, userId);
    }

    this.conversationId = conversationId;
    this.conversationMeta = convo;
    return {};
  }

  /**
   * Process message history and generate title if needed
   * @private
   */
  async _processMessageHistory(sessionId, userId, bodyIn) {
    const messages = this.persistenceConfig.filterNonSystemMessages(bodyIn.messages || []);

    if (messages.length > 0) {
      // Sync message history
      this.conversationManager.syncMessageHistory(this.conversationId, sessionId, userId, messages);

      // Generate title if conversation doesn't have one
      if (!this.conversationMeta?.title) {
        try {
          const lastUser = ConversationTitleService.findLastUserMessage(messages);
          if (lastUser) {
            // Extract the model being used for the chat to use the same model for title generation
            const { model: chatModel } = this.persistenceConfig.extractRequestSettings(bodyIn);
            const generated = await this.titleService.generateTitle(lastUser.content, this.providerId, chatModel);
            if (generated) {
              this.conversationManager.updateTitle(this.conversationId, sessionId, userId, generated);
              this.conversationMeta = { ...this.conversationMeta, title: generated };
            }
          }
        } catch (err) {
          console.warn('[SimplifiedPersistence] Title generation failed:', err?.message || err);
        }
      }
    }
  }

  /**
   * Setup assistant message recording state
   * @private
   */
  _setupAssistantRecording() {
    this.persist = true;
    this.assistantSeq = this.conversationManager.getNextSequence(this.conversationId);
    this.assistantBuffer = '';
  }

  /**
   * Handle metadata updates for existing conversations
   * @private
   */
  async _handleMetadataUpdates(sessionId, userId, bodyIn) {
    if (!this.conversationMeta) return;

    const incomingSystemPrompt = ConversationTitleService.extractSystemPrompt(bodyIn);
    const { activeTools: incomingActiveTools = [], model: incomingModel } = this.persistenceConfig.extractRequestSettings(bodyIn);
    const updates = this.persistenceConfig.checkMetadataUpdates(
      this.conversationMeta,
      incomingSystemPrompt,
      this.providerId,
      incomingActiveTools,
      incomingModel
    );

    try {
      if (updates.needsSystemUpdate) {
        this.conversationManager.updateMetadata(this.conversationId, sessionId, userId, {
          system_prompt: updates.systemPrompt
        });
        this.conversationMeta.metadata = {
          ...(this.conversationMeta.metadata || {}),
          system_prompt: updates.systemPrompt,
        };
      }

      if (updates.needsProviderUpdate) {
        this.conversationManager.updateProviderId(this.conversationId, sessionId, userId, updates.providerId);
        this.conversationMeta.providerId = updates.providerId;
      }

      if (updates.needsModelUpdate) {
        this.conversationManager.updateModel(this.conversationId, sessionId, userId, updates.model);
        this.conversationMeta.model = updates.model;
      }

      if (updates.needsActiveToolsUpdate) {
        this.conversationManager.updateMetadata(this.conversationId, sessionId, userId, {
          active_tools: updates.activeTools
        });
        this.conversationMeta.metadata = {
          ...(this.conversationMeta.metadata || {}),
          active_tools: updates.activeTools,
        };
        this.conversationMeta.active_tools = updates.activeTools;
      }
    } catch (error) {
      // Non-fatal: log and continue
      console.warn('[SimplifiedPersistence] Metadata update failed:', error?.message || error);
    }
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
   * @param {string|null} params.responseId - OpenAI response ID for state management
   */
  recordAssistantFinal({ finishReason = 'stop', responseId = null } = {}) {
    if (!this.persist || !this.conversationId || this.assistantSeq === null) return;
    if (this.finalized || this.errored) return;

    try {
      const result = this.conversationManager.recordAssistantMessage({
        conversationId: this.conversationId,
        content: this.assistantBuffer,
        seq: this.assistantSeq,
        finishReason,
        responseId: responseId || this.responseId, // Use provided or stored responseId
      });

      // Store message ID for tool call persistence
      if (result && result.id) {
        this.currentMessageId = result.id;
      }

      // Persist any buffered tool calls and outputs
      this.persistToolCallsAndOutputs();

      this.finalized = true;
    } catch (error) {
      console.error('[SimplifiedPersistence] Failed to record final assistant message:', error);
      throw error;
    }
  }

  /**
   * Add tool calls to buffer
   * @param {Array} toolCalls - Array of tool calls in OpenAI format
   */
  addToolCalls(toolCalls) {
    if (!this.persist || !Array.isArray(toolCalls)) return;
    this.toolCalls.push(...toolCalls);
  }

  /**
   * Add tool outputs to buffer
   * @param {Array} toolOutputs - Array of tool outputs
   */
  addToolOutputs(toolOutputs) {
    if (!this.persist || !Array.isArray(toolOutputs)) return;
    this.toolOutputs.push(...toolOutputs);
  }

  /**
   * Persist buffered tool calls and outputs to database
   * Called automatically during recordAssistantFinal
   */
  persistToolCallsAndOutputs() {
    if (!this.persist || !this.conversationId || !this.currentMessageId) return;

    try {
      if (this.toolCalls.length > 0) {
        ToolCallPersistence.saveToolCalls({
          messageId: this.currentMessageId,
          conversationId: this.conversationId,
          toolCalls: this.toolCalls
        });
      }

      if (this.toolOutputs.length > 0) {
        ToolCallPersistence.saveToolOutputs({
          messageId: this.currentMessageId,
          conversationId: this.conversationId,
          toolOutputs: this.toolOutputs
        });
      }

      // Clear buffers after persisting
      this.toolCalls = [];
      this.toolOutputs = [];
    } catch (error) {
      console.error('[SimplifiedPersistence] Failed to persist tool calls/outputs:', error);
      // Don't throw - this is non-fatal for the main flow
    }
  }

  /**
   * Set the response ID for the current response
   * @param {string} responseId - OpenAI response ID
   */
  setResponseId(responseId) {
    if (responseId && typeof responseId === 'string') {
      this.responseId = responseId;
    }
  }

  /**
   * Mark assistant message as error
   */
  markError() {
    if (!this.persist || !this.conversationId || this.assistantSeq === null) return;
    if (this.finalized || this.errored) return;

    try {
      this.conversationManager.markAssistantError(this.conversationId, this.assistantSeq);
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
}
