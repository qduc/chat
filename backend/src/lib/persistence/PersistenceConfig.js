import { logger } from '../../logger.js';
import { normalizeCustomRequestParamsIds } from '../customRequestParams.js';

/**
 * Centralized configuration management for persistence operations
 * Handles validation and provides defaults for persistence-related settings
 */
export class PersistenceConfig {
  constructor(config) {
    this.config = config;
    this._validateConfig();
  }

  /**
   * Check if persistence is enabled
   * @returns {boolean} True if persistence is enabled
   */
  isPersistenceEnabled() {
    return this.config?.persistence?.enabled || false;
  }

  /**
   * Get maximum conversations per session
   * @returns {number} Max conversations limit
   */
  getMaxConversationsPerSession() {
    return this.config?.persistence?.maxConversationsPerSession || 100;
  }

  /**
   * Get maximum messages per conversation
   * @returns {number} Max messages limit
   */
  getMaxMessagesPerConversation() {
    return this.config?.persistence?.maxMessagesPerConversation || 1000;
  }

  /**
   * Check if message event storage is enabled
   * @returns {boolean} True if message event storage is enabled
   */
  isMessageEventsEnabled() {
    if (this.config?.persistence?.messageEventsEnabled === undefined) return true;
    return Boolean(this.config.persistence.messageEventsEnabled);
  }

  /**
   * Get default model
   * @returns {string|null} Default model name
   */
  getDefaultModel() {
    return this.config?.defaultModel || null;
  }

  /**
   * Get title generation model
   * @returns {string} Model for title generation
   */
  getTitleModel() {
    return this.config?.titleModel || this.config?.defaultModel || 'gpt-4.1-mini';
  }

  /**
   * Extract request settings from body input
   * @param {Object} bodyIn - Request body
   * @returns {Object} Parsed request settings
   */
  extractRequestSettings(bodyIn) {
    const activeTools = this._extractActiveTools(bodyIn);

    const persistedStreamingEnabled = bodyIn.streamingEnabled !== undefined
      ? !!bodyIn.streamingEnabled
      : !!bodyIn.stream; // Map OpenAI 'stream' field

    const persistedToolsEnabled = bodyIn.toolsEnabled !== undefined
      ? !!bodyIn.toolsEnabled
      : activeTools.length > 0; // Map tools array presence

    // Extract system prompt
    const systemPrompt = typeof bodyIn?.systemPrompt === 'string'
      ? bodyIn.systemPrompt.trim()
      : (typeof bodyIn?.system_prompt === 'string' ? bodyIn.system_prompt.trim() : '');

    const hasCustomParamsId = bodyIn && Object.hasOwn(bodyIn, 'custom_request_params_id');
    const customRequestParamsId = hasCustomParamsId
      ? normalizeCustomRequestParamsIds(bodyIn.custom_request_params_id)
      : undefined;

    const metadata = {};
    if (systemPrompt) {
      metadata.system_prompt = systemPrompt;
    }
    metadata.active_tools = persistedToolsEnabled ? activeTools : [];
    if (customRequestParamsId !== undefined) {
      metadata.custom_request_params_id = customRequestParamsId;
    }

    return {
      model: bodyIn.model || this.getDefaultModel(),
      streamingEnabled: persistedStreamingEnabled,
      toolsEnabled: persistedToolsEnabled,
      reasoningEffort: bodyIn.reasoning_effort || bodyIn.reasoningEffort || null,
      verbosity: bodyIn.verbosity || null,
      systemPrompt,
      metadata,
      activeTools: metadata.active_tools,
      customRequestParamsId,
    };
  }

  /**
   * Extract request settings with resolved system prompt from active_system_prompt_id
   * @param {Object} bodyIn - Request body
   * @param {string} userId - User ID for resolving custom prompts
   * @returns {Promise<Object>} Parsed request settings with resolved system prompt
   */
  async extractRequestSettingsAsync(bodyIn, userId) {
    const settings = this.extractRequestSettings(bodyIn);

    // If there's no explicit system prompt but there's an active_system_prompt_id, resolve it
    if (!settings.systemPrompt && bodyIn.active_system_prompt_id) {
      try {
        const { getPromptById } = await import('../promptService.js');
        const prompt = await getPromptById(bodyIn.active_system_prompt_id, userId);
        if (prompt?.body) {
          settings.systemPrompt = prompt.body.trim();
          settings.metadata = {
            ...settings.metadata,
            system_prompt: settings.systemPrompt,
            active_system_prompt_id: bodyIn.active_system_prompt_id
          };
        }
      } catch (error) {
        logger.warn('[PersistenceConfig] Failed to resolve system prompt:', error);
      }
    } else if (settings.systemPrompt && bodyIn.active_system_prompt_id) {
      // If there's both an explicit system prompt and active_system_prompt_id, save both
      settings.metadata = {
        ...settings.metadata,
        system_prompt: settings.systemPrompt,
        active_system_prompt_id: bodyIn.active_system_prompt_id
      };
    }

    return settings;
  }

  /**
   * Extract provider ID from request
   * @param {Object} bodyIn - Request body
   * @param {Object} req - Express request object
   * @returns {string|undefined} Provider ID
   */
  extractProviderId(bodyIn, req) {
    return bodyIn?.provider_id || req.header('x-provider-id') || undefined;
  }

  /**
   * Filter non-system messages from message array
   * @param {Array} messages - Array of messages
   * @returns {Array} Filtered messages
   */
  filterNonSystemMessages(messages) {
    if (!Array.isArray(messages)) return [];
    return messages.filter(m => m && m.role !== 'system');
  }

  /**
   * Check if system prompt, provider ID, model, active tools, or settings needs updating
   * @param {Object} existingConvo - Existing conversation metadata
   * @param {string} incomingSystemPrompt - New system prompt
   * @param {string} incomingProviderId - New provider ID
   * @param {Array} incomingActiveTools - New active tools
   * @param {string} incomingModel - New model
   * @returns {Object} Update flags and values
   */
  checkMetadataUpdates(existingConvo, incomingSystemPrompt, incomingProviderId, incomingActiveTools = [], incomingModel = null, incomingCustomRequestParamsId = undefined) {
    const existingSystemPrompt = existingConvo?.metadata?.system_prompt || null;
    const existingProviderId = existingConvo?.providerId;
    const existingModel = existingConvo?.model;
    const existingActiveTools = Array.isArray(existingConvo?.metadata?.active_tools)
      ? existingConvo.metadata.active_tools
      : [];
    const existingCustomRequestParamsId = Object.hasOwn(existingConvo?.metadata || {}, 'custom_request_params_id')
      ? normalizeCustomRequestParamsIds(existingConvo.metadata.custom_request_params_id)
      : undefined;
    const normalizedIncomingTools = Array.isArray(incomingActiveTools)
      ? incomingActiveTools
      : [];

    const needsActiveToolsUpdate = !this._areToolListsEqual(existingActiveTools, normalizedIncomingTools);

    const needsSystemUpdate = incomingSystemPrompt && incomingSystemPrompt !== existingSystemPrompt;
    const needsProviderUpdate = incomingProviderId && incomingProviderId !== existingProviderId;
    const needsModelUpdate = incomingModel && incomingModel !== existingModel;
    const needsCustomRequestParamsUpdate = incomingCustomRequestParamsId !== undefined
      && !this._areCustomRequestParamsEqual(incomingCustomRequestParamsId, existingCustomRequestParamsId);

    return {
      needsSystemUpdate,
      needsProviderUpdate,
      needsModelUpdate,
      systemPrompt: incomingSystemPrompt,
      providerId: incomingProviderId,
      model: incomingModel,
      needsActiveToolsUpdate,
      activeTools: normalizedIncomingTools,
      needsCustomRequestParamsUpdate,
      customRequestParamsId: incomingCustomRequestParamsId,
    };
  }

  _areCustomRequestParamsEqual(valueA, valueB) {
    const normalizedA = normalizeCustomRequestParamsIds(valueA);
    const normalizedB = normalizeCustomRequestParamsIds(valueB);

    if (normalizedA === undefined || normalizedB === undefined) {
      return normalizedA === normalizedB;
    }
    if (normalizedA === null || normalizedB === null) {
      return normalizedA === normalizedB;
    }
    if (normalizedA.length !== normalizedB.length) return false;
    return normalizedA.every((value, idx) => value === normalizedB[idx]);
  }

  /**
   * Validate configuration on initialization
   * @private
   */
  _validateConfig() {
    if (!this.config) {
      throw new Error('Configuration is required for PersistenceConfig');
    }

    // Validate limits are reasonable
    const maxConversations = this.getMaxConversationsPerSession();
    const maxMessages = this.getMaxMessagesPerConversation();

    if (maxConversations < 1 || maxConversations > 10000) {
      logger.warn('[PersistenceConfig] maxConversationsPerSession should be between 1 and 10000, got:', maxConversations);
    }

    if (maxMessages < 1 || maxMessages > 50000) {
      logger.warn('[PersistenceConfig] maxMessagesPerConversation should be between 1 and 50000, got:', maxMessages);
    }
  }

  _extractActiveTools(bodyIn) {
    if (!bodyIn || !Array.isArray(bodyIn.tools)) return [];

    const names = bodyIn.tools
      .map((tool) => {
        if (typeof tool === 'string') return tool.trim();
        if (tool && typeof tool === 'object') {
          const fnName = tool.function?.name;
          if (typeof fnName === 'string') return fnName.trim();
        }
        return null;
      })
      .filter((name) => typeof name === 'string' && name.length > 0);

    // Deduplicate while preserving order
    const seen = new Set();
    const deduped = [];
    for (const name of names) {
      if (seen.has(name)) continue;
      seen.add(name);
      deduped.push(name);
    }
    return deduped;
  }

  _areToolListsEqual(a, b) {
    if (a === b) return true;
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }
}
