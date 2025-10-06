import { getDb } from '../db/client.js';
import {
  ConversationManager,
  ConversationValidator,
  ConversationTitleService,
  PersistenceConfig,
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
    this.assistantContentJson = null; // Preserve structured assistant content when available
    this.reasoningDetails = null; // Structured reasoning blocks captured from providers
    this.reasoningTextBuffer = ''; // Accumulate reasoning text during streaming when structured data absent
    this.reasoningTokens = null; // Reasoning token usage metadata
    this.userMessageId = null; // Persisted user message ID from latest sync
    this.assistantMessageId = null; // Persisted assistant message ID for the current turn
    this._latestSyncMappings = [];
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
  this.userMessageId = null;
  this.assistantMessageId = null;
  this._latestSyncMappings = [];

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
      this.conversationManager.ensureSession(sessionId, userId, {
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
    const isNewConversation = result.isNewConversation;

    // Process message history and generate title if needed
    await this._processMessageHistory(sessionId, userId, bodyIn, isNewConversation);

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
      convo = this.conversationManager.getConversation(conversationId, userId);
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
        userId,
        providerId: this.providerId,
        ...settings
      });
      convo = this.conversationManager.getConversation(conversationId, userId);
    }

    this.conversationId = conversationId;
    this.conversationMeta = convo;
    return { isNewConversation };
  }

  /**
   * Process message history and generate title if needed
   * @private
   */
  async _processMessageHistory(sessionId, userId, bodyIn, isNewConversation) {
    const messages = this.persistenceConfig.filterNonSystemMessages(bodyIn.messages || []);
    const maxSeq = messages
      .map(msg => msg.seq)
      .filter(seq => typeof seq === 'number' && seq > 0)
      .reduce((max, current) => Math.max(max, current), 0);
    const seq = Math.max(0, maxSeq - 1);

    if (messages.length > 0) {
      // Sync message history using diff-based approach with automatic fallback
  const syncResult = this.conversationManager.syncMessageHistoryDiff(this.conversationId, userId, messages, seq);
      this._latestSyncMappings = Array.isArray(syncResult?.idMappings) ? syncResult.idMappings : [];

      // Track the most recent persisted user message ID for response metadata
      const latestUserMapping = [...this._latestSyncMappings].reverse().find(mapping => mapping.role === 'user');
  this.userMessageId = latestUserMapping?.persistedId != null ? String(latestUserMapping.persistedId) : null;

      // Generate title only if this is the first message in a new conversation
      if (isNewConversation) {
        try {
          const lastUser = ConversationTitleService.findLastUserMessage(messages);
          if (lastUser) {
            // Extract the model being used for the chat to use the same model for title generation
            const { model: chatModel } = this.persistenceConfig.extractRequestSettings(bodyIn);
            const generated = await this.titleService.generateTitle(lastUser.content, this.providerId, chatModel);
            if (generated) {
              this.conversationManager.updateTitle(this.conversationId, userId, generated);
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
    this.assistantContentJson = null;
    this.reasoningDetails = null;
    this.reasoningTextBuffer = '';
    this.reasoningTokens = null;
    this.assistantMessageId = null;
  }

  /**
   * Handle metadata updates for existing conversations
   * @private
   */
  async _handleMetadataUpdates(sessionId, userId, bodyIn) {
    if (!this.conversationMeta) return;

    const incomingSystemPrompt = ConversationTitleService.extractSystemPrompt(bodyIn);
    const settings = this.persistenceConfig.extractRequestSettings(bodyIn);
    const { activeTools: incomingActiveTools = [], model: incomingModel } = settings;
    const updates = this.persistenceConfig.checkMetadataUpdates(
      this.conversationMeta,
      incomingSystemPrompt,
      this.providerId,
      incomingActiveTools,
      incomingModel
    );

    try {
      if (updates.needsSystemUpdate) {
        this.conversationManager.updateMetadata(this.conversationId, userId, {
          system_prompt: updates.systemPrompt
        });
        this.conversationMeta.metadata = {
          ...(this.conversationMeta.metadata || {}),
          system_prompt: updates.systemPrompt,
        };
      }

      if (updates.needsProviderUpdate) {
        this.conversationManager.updateProviderId(this.conversationId, userId, updates.providerId);
        this.conversationMeta.providerId = updates.providerId;
      }

      if (updates.needsModelUpdate) {
        this.conversationManager.updateModel(this.conversationId, userId, updates.model);
        this.conversationMeta.model = updates.model;
      }

      if (updates.needsActiveToolsUpdate) {
        this.conversationManager.updateMetadata(this.conversationId, userId, {
          active_tools: updates.activeTools
        });
        this.conversationMeta.metadata = {
          ...(this.conversationMeta.metadata || {}),
          active_tools: updates.activeTools,
        };
        this.conversationMeta.active_tools = updates.activeTools;
      }

      // Update conversation settings (streaming, tools, quality, reasoning, verbosity)
      const settingsToUpdate = {};
      if (settings.streamingEnabled !== undefined && settings.streamingEnabled !== this.conversationMeta.streaming_enabled) {
        settingsToUpdate.streamingEnabled = settings.streamingEnabled;
        this.conversationMeta.streaming_enabled = settings.streamingEnabled;
      }
      if (settings.toolsEnabled !== undefined && settings.toolsEnabled !== this.conversationMeta.tools_enabled) {
        settingsToUpdate.toolsEnabled = settings.toolsEnabled;
        this.conversationMeta.tools_enabled = settings.toolsEnabled;
      }
      if (settings.qualityLevel !== undefined && settings.qualityLevel !== this.conversationMeta.quality_level) {
        settingsToUpdate.qualityLevel = settings.qualityLevel;
        this.conversationMeta.quality_level = settings.qualityLevel;
      }
      if (settings.reasoningEffort !== undefined && settings.reasoningEffort !== this.conversationMeta.reasoning_effort) {
        settingsToUpdate.reasoningEffort = settings.reasoningEffort;
        this.conversationMeta.reasoning_effort = settings.reasoningEffort;
      }
      if (settings.verbosity !== undefined && settings.verbosity !== this.conversationMeta.verbosity) {
        settingsToUpdate.verbosity = settings.verbosity;
        this.conversationMeta.verbosity = settings.verbosity;
      }

      if (Object.keys(settingsToUpdate).length > 0) {
        this.conversationManager.updateSettings(this.conversationId, userId, settingsToUpdate);
      }
    } catch (error) {
      // Non-fatal: log and continue
      console.warn('[SimplifiedPersistence] Metadata update failed:', error?.message || error);
    }
  }

  _clone(value) {
    if (value === undefined || value === null) return value;
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return value;
    }
  }

  _extractTextFromMixedContent(content) {
    if (!Array.isArray(content)) return '';
    const segments = [];
    for (const part of content) {
      if (!part) continue;
      if (typeof part === 'string') {
        segments.push(part);
        continue;
      }
      if (typeof part === 'object') {
        if (typeof part.text === 'string') {
          segments.push(part.text);
          continue;
        }
        if (typeof part.value === 'string') {
          segments.push(part.value);
          continue;
        }
        if (typeof part.content === 'string') {
          segments.push(part.content);
        }
      }
    }
    return segments.join('');
  }

  setAssistantContent(content) {
    if (!this.persist || content === undefined) return;

    if (Array.isArray(content)) {
      this.assistantContentJson = this._clone(content);
      this.assistantBuffer = this._extractTextFromMixedContent(content);
      return;
    }

    if (typeof content === 'string') {
      this.assistantContentJson = null;
      this.assistantBuffer = content;
      return;
    }

    if (content === null) {
      this.assistantContentJson = null;
      this.assistantBuffer = '';
      return;
    }

    if (typeof content === 'object') {
      this.assistantContentJson = this._clone(content);
      if (Array.isArray(content.content)) {
        this.assistantBuffer = this._extractTextFromMixedContent(content.content);
      } else if (typeof content.text === 'string') {
        this.assistantBuffer = content.text;
      } else if (typeof content.value === 'string') {
        this.assistantBuffer = content.value;
      } else if (typeof content.output_text === 'string') {
        this.assistantBuffer = content.output_text;
      } else {
        this.assistantBuffer = '';
      }
    }
  }

  appendReasoningText(delta) {
    if (!this.persist || !delta) return;
    this.reasoningTextBuffer += delta;
  }

  setReasoningDetails(details) {
    if (!this.persist || details === undefined) return;

    if (details === null) {
      this.reasoningDetails = null;
      return;
    }

    if (Array.isArray(details)) {
      this.reasoningDetails = this._clone(details);
      return;
    }

    if (typeof details === 'object') {
      const cloned = this._clone(details);
      if (!Array.isArray(this.reasoningDetails)) {
        this.reasoningDetails = [];
      }
      this.reasoningDetails.push(cloned);
    }
  }

  setReasoningTokens(value) {
    if (!this.persist || value === undefined) return;
    if (value === null) {
      this.reasoningTokens = null;
      return;
    }

    const asNumber = Number(value);
    if (!Number.isFinite(asNumber)) return;
    this.reasoningTokens = Math.max(0, Math.trunc(asNumber));
  }

  _finalizeReasoningDetails() {
    if (Array.isArray(this.reasoningDetails)) {
      return this._clone(this.reasoningDetails);
    }

    if (this.reasoningDetails && typeof this.reasoningDetails === 'object') {
      return [this._clone(this.reasoningDetails)];
    }

    if (typeof this.reasoningTextBuffer === 'string' && this.reasoningTextBuffer.trim()) {
      return [{ type: 'text', text: this.reasoningTextBuffer }];
    }

    return null;
  }
  /**
   * Buffer assistant content (no immediate DB write)
   * @param {string} delta - Content delta to add
   */
  appendContent(delta) {
    if (!this.persist || delta == null) return;

    if (Array.isArray(delta)) {
      const cloned = this._clone(delta) || [];

      if (Array.isArray(this.assistantContentJson)) {
        this.assistantContentJson.push(...cloned);
      } else if (this.assistantContentJson && typeof this.assistantContentJson === 'object') {
        // Existing structured content that's not an array; convert to array to preserve data
        this.assistantContentJson = [this._clone(this.assistantContentJson), ...cloned];
      } else {
        this.assistantContentJson = cloned;
      }

      const text = this._extractTextFromMixedContent(cloned);
      if (text) {
        this.assistantBuffer += text;
      }
      return;
    }

    if (typeof delta === 'string') {
      this.assistantBuffer += delta;
      return;
    }

    if (typeof delta === 'object') {
      if (typeof delta.text === 'string') {
        this.assistantBuffer += delta.text;
      } else if (typeof delta.value === 'string') {
        this.assistantBuffer += delta.value;
      } else if (typeof delta.content === 'string') {
        this.assistantBuffer += delta.content;
      }
    }
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
        content: this.assistantContentJson ?? this.assistantBuffer,
        seq: this.assistantSeq,
        finishReason,
        responseId: responseId || this.responseId, // Use provided or stored responseId
        reasoningDetails: this._finalizeReasoningDetails(),
        reasoningTokens: this.reasoningTokens,
      });

      // Store message ID for tool call persistence
      if (result && result.id) {
        this.currentMessageId = result.id;
        this.assistantMessageId = String(result.id);
        console.log('[SimplifiedPersistence] Assistant message recorded', {
          conversationId: this.conversationId,
          messageId: this.currentMessageId,
          seq: this.assistantSeq
        });
      }

      // Persist any buffered tool calls and outputs
      this.persistToolCallsAndOutputs();

      // Prepare for future iterations
      this.assistantSeq = this.conversationManager.getNextSequence(this.conversationId);
      this.assistantBuffer = '';
      this.assistantContentJson = null;
      this.reasoningDetails = null;
      this.reasoningTextBuffer = '';
      this.reasoningTokens = null;
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
    if (!this.persist || !Array.isArray(toolCalls) || toolCalls.length === 0) return;
    console.log('[SimplifiedPersistence] Buffering tool calls', {
      conversationId: this.conversationId,
      messageSeq: this.assistantSeq,
      callIds: toolCalls.map(tc => tc?.id),
      count: toolCalls.length
    });
    this.toolCalls.push(...toolCalls);
  }

  /**
   * Add tool outputs to buffer
   * @param {Array} toolOutputs - Array of tool outputs
   */
  addToolOutputs(toolOutputs) {
    if (!this.persist || !Array.isArray(toolOutputs) || toolOutputs.length === 0) return;
    console.log('[SimplifiedPersistence] Buffering tool outputs', {
      conversationId: this.conversationId,
      messageSeq: this.assistantSeq,
      entries: toolOutputs.map(out => ({
        tool_call_id: out?.tool_call_id,
        status: out?.status || 'success'
      })),
      count: toolOutputs.length
    });
    this.toolOutputs.push(...toolOutputs);
  }

  /**
   * Persist buffered tool calls and outputs to database
   * Called automatically during recordAssistantFinal
   */
  persistToolCallsAndOutputs() {
    if (!this.persist) return;
    // Tool data will be synced from the client-provided history on the next request.
    this.toolCalls = [];
    this.toolOutputs = [];
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
