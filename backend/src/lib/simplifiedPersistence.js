import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db/client.js';
import {
  ConversationManager,
  ConversationValidator,
  ConversationTitleService,
  PersistenceConfig,
} from './persistence/index.js';
import {
  insertToolCalls,
  insertToolOutputs,
} from '../db/toolCalls.js';
import { insertMessageEvents } from '../db/messageEvents.js';
import {
  insertToolMessage,
  getNextSeq,
  updateMessageContent,
} from '../db/messages.js';
import { getAllUserSettings } from '../db/getAllUserSettings.js';
import { logger } from '../logger.js';
import { normalizeUsage } from './utils/usage.js';

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
    this.generatedImages = []; // Buffer generated images during streaming
    this.assistantContentJson = null; // Preserve structured assistant content when available
    this.reasoningDetails = null; // Structured reasoning blocks captured from providers
    this.reasoningTextBuffer = ''; // Accumulate reasoning text during streaming when structured data absent
    this.reasoningTokens = null; // Reasoning token usage metadata
    this.tokensIn = null; // Prompt/input token usage metadata
    this.tokensOut = null; // Completion/output token usage metadata
    this.totalTokens = null; // Total token usage metadata
    this.promptMs = null; // Prompt timing metadata
    this.completionMs = null; // Completion timing metadata
    this.userMessageId = null; // Persisted user message ID from latest sync
    this.assistantMessageId = null; // Persisted assistant message ID for the current turn
    this.messageEventsEnabled = this.persistenceConfig?.isMessageEventsEnabled?.() ?? true;
    this.messageEvents = []; // Ordered assistant events for rendering
    this.nextEventSeq = 0;
    this._latestSyncMappings = [];
    // Checkpoint state
    this.lastCheckpoint = 0; // timestamp
    this.lastCheckpointLength = 0; // content length at last checkpoint
    this.checkpointConfig = {
      intervalMs: config?.persistence?.checkpoint?.intervalMs ?? 3000,
      minCharacters: config?.persistence?.checkpoint?.minCharacters ?? 500,
      enabled: config?.persistence?.checkpoint?.enabled ?? true,
    };
    this.upstreamProvider = null;
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
  async initialize({ conversationId, sessionId, userId = null, req, bodyIn, onTitleGenerated }) {
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
    await this._processMessageHistory(sessionId, userId, bodyIn, isNewConversation, onTitleGenerated);

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
      // Support linked comparison conversations via parent_conversation_id
      const parentConversationId = bodyIn.parent_conversation_id || null;
      conversationId = this.conversationManager.createNewConversation({
        sessionId,
        userId,
        providerId: this.providerId,
        parentConversationId,
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
  async _processMessageHistory(sessionId, userId, bodyIn, isNewConversation, onTitleGenerated) {
    let messages = this.persistenceConfig.filterNonSystemMessages(bodyIn.messages || []);
    const emptyAssistantMessages = messages.filter(
      (msg) =>
        msg?.role === 'assistant' &&
        (msg.content === '' || (Array.isArray(msg.content) && msg.content.length === 0)) &&
        (!Array.isArray(msg.tool_calls) || msg.tool_calls.length === 0) &&
        (!Array.isArray(msg.tool_outputs) || msg.tool_outputs.length === 0)
    );
    if (emptyAssistantMessages.length > 0) {
      logger.debug('[SimplifiedPersistence] Dropping empty assistant messages from client history', {
        conversationId: this.conversationId,
        parentConversationId: bodyIn?.parent_conversation_id ?? null,
        count: emptyAssistantMessages.length,
        ids: emptyAssistantMessages.map((msg) => msg?.id).filter(Boolean),
      });
      messages = messages.filter((msg) => !emptyAssistantMessages.includes(msg));
    }
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

      // Generate title when the conversation is new or still lacks a title.
      // Fire-and-forget to avoid blocking the response.
      const needsTitle = isNewConversation || !this.conversationMeta?.title;
      if (needsTitle) {
        const lastUser = ConversationTitleService.findLastUserMessage(messages);
        if (lastUser) {
          // Extract the model being used for the chat to use the same model for title generation
          const { model: chatModel } = this.persistenceConfig.extractRequestSettings(bodyIn);

          // Run title generation in background without blocking
          // Store conversationId and userId in closure to avoid stale references
          const convId = this.conversationId;
          const uId = userId;

          // Fetch user settings to check for chore_model preference
          const userSettings = getAllUserSettings(uId);
          const titleModel = userSettings.chore_model || chatModel;

          this.titleService.generateTitle(lastUser.content, this.providerId, titleModel)
            .then(generated => {
              if (generated) {
                this.conversationManager.updateTitle(convId, uId, generated);
                // Update the in-memory conversationMeta so it's available for subsequent messages
                // in the same request cycle (though typically this completes after response is sent)
                if (this.conversationMeta && this.conversationId === convId) {
                  this.conversationMeta.title = generated;
                }
                logger.info(`[SimplifiedPersistence] Title generated: "${generated}"`);
                if (onTitleGenerated) onTitleGenerated(generated);
              }
            })
            .catch(err => {
              logger.warn('[SimplifiedPersistence] Title generation failed:', err?.message || err);
            });
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
    this.generatedImages = [];
    this.reasoningDetails = null;
    this.reasoningTextBuffer = '';
    this.reasoningTokens = null;
    this.tokensIn = null;
    this.tokensOut = null;
    this.totalTokens = null;
    this.promptMs = null;
    this.completionMs = null;
    this.assistantMessageId = uuidv4();
    this.messageEventsEnabled = this.persistenceConfig?.isMessageEventsEnabled?.() ?? true;
    this.messageEvents = [];
    this.nextEventSeq = 0;
    // Create a draft row immediately so we can checkpoint during streaming
    try {
      this.createDraftMessage();
    } catch (err) {
      // Non-fatal: if draft creation fails we fall back to final-only writes
      logger.warn('[SimplifiedPersistence] Failed to create draft message:', err?.message || err);
      this.currentMessageId = null;
    }
  }

  /**
   * Handle metadata updates for existing conversations
   * @private
   */
  async _handleMetadataUpdates(sessionId, userId, bodyIn) {
    if (!this.conversationMeta) return;

    const incomingSystemPrompt = ConversationTitleService.extractSystemPrompt(bodyIn);
    const settings = this.persistenceConfig.extractRequestSettings(bodyIn);
    const {
      activeTools: incomingActiveTools = [],
      model: incomingModel,
      customRequestParamsId: incomingCustomRequestParamsId,
    } = settings;
    const updates = this.persistenceConfig.checkMetadataUpdates(
      this.conversationMeta,
      incomingSystemPrompt,
      this.providerId,
      incomingActiveTools,
      incomingModel,
      incomingCustomRequestParamsId
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

      if (updates.needsCustomRequestParamsUpdate) {
        this.conversationManager.updateMetadata(this.conversationId, userId, {
          custom_request_params_id: updates.customRequestParamsId ?? null,
        });
        this.conversationMeta.metadata = {
          ...(this.conversationMeta.metadata || {}),
          custom_request_params_id: updates.customRequestParamsId ?? null,
        };
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
      logger.warn('[SimplifiedPersistence] Metadata update failed:', error?.message || error);
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
    this.addMessageEvent('reasoning', { text: String(delta) });
  }

  setReasoningDetails(details) {
    if (!this.persist || details === undefined) return;

    if (details === null) {
      this.reasoningDetails = null;
      return;
    }

    if (Array.isArray(details)) {
      // Merge incoming array with existing reasoning_details
      // Each item in the array has an index, accumulate text for items with the same index
      if (!Array.isArray(this.reasoningDetails)) {
        this.reasoningDetails = [];
      }

      for (const item of details) {
        if (!item || typeof item !== 'object') continue;

        const incomingIndex = item.index ?? 0;
        const existingItem = this.reasoningDetails.find(r => (r.index ?? 0) === incomingIndex);

        if (existingItem && item.text) {
          // Accumulate text for existing item with same index
          if (typeof existingItem.text === 'string') {
            existingItem.text += item.text;
          } else {
            existingItem.text = item.text;
          }
          // Update other fields if present
          if (item.type) existingItem.type = item.type;
          if (item.format) existingItem.format = item.format;
        } else {
          // New item, add to array
          this.reasoningDetails.push(this._clone(item));
        }
      }
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

  setUsage(usage) {
    if (!this.persist || usage === undefined) return;
    if (usage === null) {
      this.tokensIn = null;
      this.tokensOut = null;
      this.totalTokens = null;
      return;
    }

    const normalized = normalizeUsage(usage);
    if (!normalized) return;

    if (normalized.prompt_tokens != null) {
      this.tokensIn = Math.max(0, Math.trunc(Number(normalized.prompt_tokens)));
    }
    if (normalized.completion_tokens != null) {
      this.tokensOut = Math.max(0, Math.trunc(Number(normalized.completion_tokens)));
    }
    if (normalized.total_tokens != null) {
      this.totalTokens = Math.max(0, Math.trunc(Number(normalized.total_tokens)));
    }
    if (normalized.reasoning_tokens != null) {
      this.setReasoningTokens(normalized.reasoning_tokens);
    }
    if (normalized.prompt_ms != null) {
      this.promptMs = Number(normalized.prompt_ms);
    }
    if (normalized.completion_ms != null) {
      this.completionMs = Number(normalized.completion_ms);
    }
  }

  setProvider(provider) {
    if (!this.persist || !provider) return;
    this.upstreamProvider = String(provider);
  }

  /**
   * Set generated images from model response
   * @param {Array} images - Array of generated image objects
   */
  setGeneratedImages(images) {
    if (!this.persist || !Array.isArray(images)) return;
    this.generatedImages = images;
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
   * Finalize content with generated images
   * Merges text content and generated images into an array format
   * @returns {string|Array} The final content with images
   */
  _finalizeContentWithImages() {
    const baseContent = this.assistantContentJson ?? this.assistantBuffer;

    // If no generated images, return content as-is
    if (!Array.isArray(this.generatedImages) || this.generatedImages.length === 0) {
      return baseContent;
    }

    // Convert content to array format if needed and append images
    let contentArray = [];

    if (typeof baseContent === 'string' && baseContent) {
      contentArray.push({ type: 'text', text: baseContent });
    } else if (Array.isArray(baseContent)) {
      contentArray = [...baseContent];
    } else if (baseContent && typeof baseContent === 'object') {
      // Handle pre-structured content objects (e.g., JSON content from assistantContentJson)
      contentArray.push(this._clone(baseContent));
    }

    // Append generated images
    for (const img of this.generatedImages) {
      if (img?.image_url?.url) {
        contentArray.push({
          type: 'image_url',
          image_url: { url: img.image_url.url },
        });
      }
    }

    return contentArray.length > 0 ? contentArray : '';
  }

  /**
   * Get current content length for textOffset tracking
   * @returns {number} Current length of assistant content
   */
  getContentLength() {
    return this.assistantBuffer.length;
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
        this.addMessageEvent('content', { text });
      }
      try {
        if (this.shouldCheckpoint()) this.performCheckpoint();
      } catch (err) {
        logger.warn('[SimplifiedPersistence] Checkpoint failed (non-fatal):', err?.message || err);
      }
      return;
    }

    if (typeof delta === 'string') {
      this.assistantBuffer += delta;
      this.addMessageEvent('content', { text: delta });
      try {
        if (this.shouldCheckpoint()) this.performCheckpoint();
      } catch (err) {
        logger.warn('[SimplifiedPersistence] Checkpoint failed (non-fatal):', err?.message || err);
      }
      return;
    }

    if (typeof delta === 'object') {
      if (typeof delta.text === 'string') {
        this.assistantBuffer += delta.text;
        this.addMessageEvent('content', { text: delta.text });
      } else if (typeof delta.value === 'string') {
        this.assistantBuffer += delta.value;
        this.addMessageEvent('content', { text: delta.value });
      } else if (typeof delta.content === 'string') {
        this.assistantBuffer += delta.content;
        this.addMessageEvent('content', { text: delta.content });
      }
    }
    // After updating in-memory buffer, consider checkpointing to DB
    try {
      if (this.shouldCheckpoint()) {
        this.performCheckpoint();
      }
    } catch (err) {
      logger.warn('[SimplifiedPersistence] Checkpoint failed (non-fatal):', err?.message || err);
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
    const finalContent = this._finalizeContentWithImages();
      if (this.currentMessageId) {
        // Update existing draft to final
        updateMessageContent({
          messageId: this.currentMessageId,
          conversationId: this.conversationId,
          userId: this.userId,
          content: finalContent,
          status: 'final',
          finishReason,
          responseId: responseId || this.responseId,
          reasoningDetails: this._finalizeReasoningDetails(),
          reasoningTokens: this.reasoningTokens,
          tokensIn: this.tokensIn,
          tokensOut: this.tokensOut,
          totalTokens: this.totalTokens,
          promptMs: this.promptMs,
          completionMs: this.completionMs,
          provider: this.upstreamProvider,
        });

        // Maintain assistantMessageId as the UUID generated during setup
        logger.debug('[SimplifiedPersistence] Updated draft to final', {
          conversationId: this.conversationId,
          messageId: this.currentMessageId,
          seq: this.assistantSeq,
          finishReason,
        });
      } else {
        // No messageId cached — try to locate an existing assistant message for this seq
        const db = getDb();
        const found = db.prepare("SELECT id FROM messages WHERE conversation_id=@conversationId AND seq=@seq AND role = 'assistant'").get({ conversationId: this.conversationId, seq: this.assistantSeq });
        if (found && found.id) {
          // Update the found row directly (bypass user join checks)
          try {
            updateMessageContent({
              messageId: found.id,
              conversationId: this.conversationId,
              userId: this.userId,
              content: finalContent,
              status: 'final',
              finishReason,
              responseId: responseId || this.responseId,
              reasoningDetails: this._finalizeReasoningDetails(),
              reasoningTokens: this.reasoningTokens,
              tokensIn: this.tokensIn,
              tokensOut: this.tokensOut,
              totalTokens: this.totalTokens,
              promptMs: this.promptMs,
              completionMs: this.completionMs,
              provider: this.upstreamProvider,
            });
            this.currentMessageId = found.id;
            this.assistantMessageId = this.assistantMessageId || uuidv4();
            logger.debug('[SimplifiedPersistence] Updated found draft (by seq) to final', { conversationId: this.conversationId, messageId: found.id });
          } catch (err) {
            logger.warn('[SimplifiedPersistence] Failed to update found draft; falling back to insert:', err?.message || err);
            const result = this.conversationManager.recordAssistantMessage({
              conversationId: this.conversationId,
              content: finalContent,
              seq: this.assistantSeq,
              finishReason,
              responseId: responseId || this.responseId,
              reasoningDetails: this._finalizeReasoningDetails(),
              reasoningTokens: this.reasoningTokens,
              tokensIn: this.tokensIn,
              tokensOut: this.tokensOut,
              totalTokens: this.totalTokens,
              promptMs: this.promptMs,
              completionMs: this.completionMs,
              provider: this.upstreamProvider,
              clientMessageId: this.assistantMessageId,
            });
            if (result && result.id) {
              this.currentMessageId = result.id;
              this.assistantMessageId = result.clientMessageId || this.assistantMessageId;
            }
          }
        } else {
          // No existing row found — insert as final
          const result = this.conversationManager.recordAssistantMessage({
            conversationId: this.conversationId,
            content: finalContent,
            seq: this.assistantSeq,
            finishReason,
            responseId: responseId || this.responseId,
            reasoningDetails: this._finalizeReasoningDetails(),
            reasoningTokens: this.reasoningTokens,
            tokensIn: this.tokensIn,
            tokensOut: this.tokensOut,
            totalTokens: this.totalTokens,
            promptMs: this.promptMs,
            completionMs: this.completionMs,
            provider: this.upstreamProvider,
            clientMessageId: this.assistantMessageId,
          });
          if (result && result.id) {
            this.currentMessageId = result.id;
            this.assistantMessageId = result.clientMessageId || this.assistantMessageId;
            logger.debug('[SimplifiedPersistence] Assistant message recorded', {
              conversationId: this.conversationId,
              messageId: this.currentMessageId,
              seq: this.assistantSeq
            });
          }
        }
      }

    if (this.messageEventsEnabled) {
      const finalizedReasoning = this._finalizeReasoningDetails();
      const hasReasoningEvent = this.messageEvents.some((event) => event?.type === 'reasoning');
      if (!hasReasoningEvent && Array.isArray(finalizedReasoning)) {
        const reasoningText = finalizedReasoning
          .map((detail) => (typeof detail?.text === 'string' ? detail.text.trim() : ''))
          .filter(Boolean)
          .join('\n\n');
        if (reasoningText) {
          this.messageEvents.unshift({ seq: -1, type: 'reasoning', payload: { text: reasoningText } });
        }
      }
    }

    // Automatically persist any buffered tool calls and outputs now that we have a messageId
    this.persistToolCallsAndOutputs();
    this.persistMessageEvents();
  }

  /**
   * Add tool calls to buffer
   * @param {Array} toolCalls - Array of tool calls in OpenAI format
   */
  addToolCalls(toolCalls) {
    if (!this.persist || !Array.isArray(toolCalls) || toolCalls.length === 0) return;
    logger.debug('[SimplifiedPersistence] Buffering tool calls', {
      conversationId: this.conversationId,
      messageSeq: this.assistantSeq,
      callIds: toolCalls.map(tc => tc?.id),
      count: toolCalls.length
    });
    this.toolCalls.push(...toolCalls);
  }

  addMessageEvent(type, payload) {
    if (!this.persist || !type || !this.messageEventsEnabled) return;
    const normalizedPayload = payload ?? null;
    if (normalizedPayload && typeof normalizedPayload.text === 'string' && normalizedPayload.text.length === 0) {
      return;
    }
    const last = this.messageEvents[this.messageEvents.length - 1];
    const isMergeable =
      last &&
      last.type === type &&
      (type === 'content' || type === 'reasoning') &&
      last.payload &&
      normalizedPayload &&
      typeof last.payload.text === 'string' &&
      typeof normalizedPayload.text === 'string';

    if (isMergeable) {
      last.payload.text += normalizedPayload.text;
      return;
    }

    const seq = this.nextEventSeq;
    this.nextEventSeq += 1;
    this.messageEvents.push({ seq, type, payload: normalizedPayload });
  }

  /**
   * Add tool outputs to buffer
   * @param {Array} toolOutputs - Array of tool outputs
   */
  addToolOutputs(toolOutputs) {
    if (!this.persist || !Array.isArray(toolOutputs) || toolOutputs.length === 0) return;
    logger.debug('[SimplifiedPersistence] Buffering tool outputs', {
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
    if (!this.persist || !this.conversationId || !this.currentMessageId) {
      // Clear buffers even if we can't persist
      this.toolCalls = [];
      this.toolOutputs = [];
      return;
    }

    try {
      // Save tool calls to database (attached to assistant message)
      if (this.toolCalls.length > 0) {
        logger.debug('[SimplifiedPersistence] Persisting tool calls to database', {
          conversationId: this.conversationId,
          messageId: this.currentMessageId,
          count: this.toolCalls.length,
          callIds: this.toolCalls.map(tc => tc?.id)
        });
        insertToolCalls({
          messageId: this.currentMessageId,
          conversationId: this.conversationId,
          toolCalls: this.toolCalls
        });
      }

      // Save tool outputs as separate "tool" role messages
      if (this.toolOutputs.length > 0) {
        logger.debug('[SimplifiedPersistence] Persisting tool outputs as separate messages', {
          conversationId: this.conversationId,
          count: this.toolOutputs.length
        });

        for (const toolOutput of this.toolOutputs) {
          // Create a separate message with role="tool" for each output
          const seq = getNextSeq(this.conversationId);
          const toolContent = typeof toolOutput.output === 'string'
            ? toolOutput.output
            : JSON.stringify(toolOutput.output);

          const result = insertToolMessage({
            conversationId: this.conversationId,
            content: toolContent,
            seq,
            status: toolOutput.status || 'success',
            clientMessageId: null
          });

          if (result?.id) {
            // Link the tool output to this tool message
            insertToolOutputs({
              messageId: result.id,
              conversationId: this.conversationId,
              toolOutputs: [{
                tool_call_id: toolOutput.tool_call_id,
                output: toolContent,
                status: toolOutput.status || 'success'
              }]
            });
          }
        }
      }
    } catch (error) {
      logger.error('[SimplifiedPersistence] Failed to persist tool calls/outputs:', error);
      // Don't throw - this is cleanup, allow the response to complete
    } finally {
      // Clear buffers after persistence attempt
      this.toolCalls = [];
      this.toolOutputs = [];
    }
  }

  persistMessageEvents() {
    if (!this.persist || !this.conversationId || !this.currentMessageId || !this.messageEventsEnabled) {
      this.messageEvents = [];
      return;
    }

    if (this.messageEvents.length === 0) return;

    try {
      const normalizedEvents = [];
      for (const event of this.messageEvents) {
        if (event?.payload && typeof event.payload.text === 'string' && event.payload.text.length === 0) {
          continue;
        }
        const last = normalizedEvents[normalizedEvents.length - 1];
        const canMerge =
          last &&
          last.type === event.type &&
          (event.type === 'content' || event.type === 'reasoning') &&
          last.payload &&
          event.payload &&
          typeof last.payload.text === 'string' &&
          typeof event.payload.text === 'string';
        if (canMerge) {
          last.payload.text += event.payload.text;
          continue;
        }
        normalizedEvents.push({ ...event, payload: event.payload ?? null });
      }
      const orderedEvents = normalizedEvents.map((event, index) => ({
        ...event,
        seq: index,
      }));
      insertMessageEvents({
        messageId: this.currentMessageId,
        conversationId: this.conversationId,
        events: orderedEvents,
      });
    } catch (error) {
      logger.error('[SimplifiedPersistence] Failed to persist message events:', error);
    } finally {
      this.messageEvents = [];
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
      // Prefer to update the existing assistant message row (by cached id or lookup) to preserve partial content
      let targetId = this.currentMessageId;
      const db = getDb();
      logger.debug('[SimplifiedPersistence] markError invoked', { conversationId: this.conversationId, seq: this.assistantSeq, cachedId: this.currentMessageId });
      if (!targetId) {
        const found = db.prepare("SELECT id FROM messages WHERE conversation_id=@conversationId AND seq=@seq AND role = 'assistant'").get({ conversationId: this.conversationId, seq: this.assistantSeq });
        logger.debug('[SimplifiedPersistence] markError lookup result', { foundId: found?.id });
        if (found && found.id) targetId = found.id;
      }

      if (targetId) {
        try {
          updateMessageContent({
            messageId: targetId,
            conversationId: this.conversationId,
            userId: this.userId,
            content: this.assistantContentJson ?? this.assistantBuffer,
            status: 'error',
            finishReason: 'error',
            responseId: this.responseId || null,
            reasoningDetails: this._finalizeReasoningDetails(),
            reasoningTokens: this.reasoningTokens,
            tokensIn: this.tokensIn,
            tokensOut: this.tokensOut,
            totalTokens: this.totalTokens,
            promptMs: this.promptMs,
            completionMs: this.completionMs,
            provider: this.upstreamProvider,
          });
        } catch (err) {
          logger.warn('[SimplifiedPersistence] markError update failed, falling back to seq-based error:', err?.message || err);
          this.conversationManager.markAssistantError(this.conversationId, this.assistantSeq);
        }
      } else {
        this.conversationManager.markAssistantError(this.conversationId, this.assistantSeq);
      }
      this.errored = true;
    } catch (error) {
      logger.error('[SimplifiedPersistence] Failed to mark error:', error);
      // Don't re-throw as this is cleanup
    }
  }

  /**
   * Create a draft message row for the current assistant seq
   * Non-throwing: failures will be logged and currentMessageId left null
   */
  createDraftMessage() {
    if (!this.persist || !this.conversationId || this.assistantSeq === null) return null;
    try {
      const db = getDb();
      const now = new Date().toISOString();
      const info = db.prepare(
        `INSERT INTO messages (conversation_id, role, status, content, seq, client_message_id, created_at, updated_at)
         VALUES (@conversationId, 'assistant', 'draft', '', @seq, @clientMessageId, @now, @now)`
      ).run({
        conversationId: this.conversationId,
        seq: this.assistantSeq,
        clientMessageId: this.assistantMessageId,
        now
      });

      this.currentMessageId = info.lastInsertRowid;
      this.lastCheckpoint = Date.now();
      this.lastCheckpointLength = 0;

      logger.debug('[SimplifiedPersistence] Created draft message', {
        conversationId: this.conversationId,
        messageId: this.currentMessageId,
        seq: this.assistantSeq,
      });
      return { id: this.currentMessageId, seq: this.assistantSeq };
    } catch (error) {
      logger.error('[SimplifiedPersistence] Failed to create draft message:', error);
      this.currentMessageId = null;
      return null;
    }
  }

  /**
   * Decide whether a checkpoint is necessary based on hybrid triggers
   * @returns {boolean}
   */
  shouldCheckpoint() {
    if (!this.checkpointConfig?.enabled) return false;
    if (!this.persist || !this.currentMessageId) return false;
    if (this.finalized || this.errored) return false;

    const now = Date.now();
    const timeSince = now - (this.lastCheckpoint || 0);
    const growth = this.assistantBuffer.length - (this.lastCheckpointLength || 0);

    const timeThresholdMet = timeSince >= (this.checkpointConfig.intervalMs || 0);
    const sizeThresholdMet = growth >= (this.checkpointConfig.minCharacters || 0);

    return timeThresholdMet || sizeThresholdMet;
  }

  /**
   * Perform a checkpoint: update the draft message with current content
   */
  performCheckpoint() {
    if (!this.persist || !this.currentMessageId) return;
    if (this.finalized || this.errored) return;
    try {
      updateMessageContent({
        messageId: this.currentMessageId,
        conversationId: this.conversationId,
        userId: this.userId,
        content: this.assistantContentJson ?? this.assistantBuffer,
        status: 'draft',
        reasoningDetails: this._finalizeReasoningDetails(),
        reasoningTokens: this.reasoningTokens,
        tokensIn: this.tokensIn,
        tokensOut: this.tokensOut,
        totalTokens: this.totalTokens,
        promptMs: this.promptMs,
        completionMs: this.completionMs,
      });

      this.lastCheckpoint = Date.now();
      this.lastCheckpointLength = this.assistantBuffer.length;

      logger.debug('[SimplifiedPersistence] Saved partial content', {
        conversationId: this.conversationId,
        messageId: this.currentMessageId,
        length: this.assistantBuffer.length,
        seq: this.assistantSeq,
      });
    } catch (error) {
      logger.error('[SimplifiedPersistence] Failed to save checkpoint:', error);
      // Don't throw - streaming must continue
    }
  }

  /**
   * Cleanup resources (no-op in final-only approach)
   */
  cleanup() {
    // No timers or resources to clean up in final-only approach
  }
}
