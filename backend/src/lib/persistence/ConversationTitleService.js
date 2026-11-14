import { createOpenAIRequest } from '../streamUtils.js';
import { providerIsConfigured } from '../providers/index.js';
import { logger } from '../../logger.js';
import { titleGenerationOverrides } from '../adapters/reasoningEffort.js';

/**
 * Handles conversation title generation
 * Separated from persistence logic for better testability and reusability
 */
export class ConversationTitleService {
  constructor(config) {
    this.config = config;
  }

  /**
   * Generate a concise conversation title from user content
   * @param {string} content - User message content
   * @param {string} providerId - Provider ID for API requests
   * @param {string} [model] - Specific model to use for title generation (defaults to titleModel/defaultModel)
   * @returns {Promise<string|null>} Generated title or null
   */
  async generateTitle(content, providerId, model = null) {
    try {
      const text = ConversationTitleService.extractTextFromContent(content).trim();
      if (!text) return null;

      // Extract provider and model from model string if qualified (provider::model)
      let modelToUse = model || this.config.titleModel || this.config.defaultModel || 'gpt-4.1-mini';
      let providerToUse = providerId;
      if (typeof modelToUse === 'string' && modelToUse.includes('::')) {
        const parts = modelToUse.split('::');
        providerToUse = parts[0];
        modelToUse = parts[1];
      }

      // Check if provider is configured for API requests
      const configured = await providerIsConfigured(this.config, { providerId: providerToUse });
      if (!configured) {
        return this.generateFallbackTitle(text);
      }

      const title = await this._requestTitleFromAPI(text, providerToUse, modelToUse);
      return title || this.generateFallbackTitle(text);
    } catch (error) {
      // Log error but don't throw - title generation is non-critical
      logger.warn('[ConversationTitleService] Title generation failed:', error?.message || error);
      return this.generateFallbackTitle(ConversationTitleService.extractTextFromContent(content));
    }
  }

  /**
   * Generate fallback title from user content when API is unavailable
   * @param {string} text - User message content
   * @returns {string|null} Fallback title or null
   */
  generateFallbackTitle(text) {
    const cleaned = String(text || '').trim().replace(/[\r\n]+/g, ' ');
    if (!cleaned) return null;

    const words = cleaned.split(/\s+/).slice(0, 6).join(' ');
    return words.length > 80 ? words.slice(0, 77) + '…' : words;
  }

  /**
   * Request title generation from AI API
   * @private
   * @param {string} text - User message content
   * @param {string} providerId - Provider ID for API requests
   * @param {string} [model] - Specific model to use for title generation
   * @returns {Promise<string|null>} Generated title or null
   */
  async _requestTitleFromAPI(text, providerId, model = null) {
    let modelToUse = model || this.config.titleModel || this.config.defaultModel || 'gpt-4.1-mini';
    let providerToUse = providerId;

    if (typeof modelToUse === 'string' && modelToUse.includes('::')) {
      const parts = modelToUse.split('::');
      providerToUse = parts[0];
      modelToUse = parts[1];
    }

    const requestBody = ConversationTitleService.buildTitleRequestBody(modelToUse, text);

    const resp = await createOpenAIRequest(this.config, requestBody, { providerId: providerToUse });

    if (!resp.ok) {
      return null;
    }

    const body = await resp.json();
    const raw = body?.choices?.[0]?.message?.content || '';

    let title = String(raw)
      .replace(/^["'\s]+|["'\s]+$/g, '') // Remove quotes and whitespace
      .replace(/[\r\n]+/g, ' ')         // Replace line breaks with spaces
      .trim();

    if (!title) return null;

    // Ensure title isn't too long
    if (title.length > 80) {
      title = title.slice(0, 77) + '…';
    }

    return title;
  }

  /**
   * OpenAI-shaped title request. Reasoning models get effort `none` (adapters
   * lower that to the model's minimum) and a larger output cap, because a
   * 20-token cap is spent on thinking before any title text. Temperature stays
   * 0.2 except where the model rejects it at the effort that will be sent.
   * Every other model keeps temperature 0.2 and max_tokens 20.
   * @param {string} model
   * @param {string} text - User text. Longer than 500 characters is truncated here.
   * @returns {object}
   */
  static buildTitleRequestBody(model, text) {
    const promptUser = text.length > 500 ? text.slice(0, 500) + '…' : text;
    const overrides = titleGenerationOverrides(model);
    const requestBody = {
      model,
      max_tokens: overrides ? overrides.maxTokens : 20,
      messages: [
        {
          role: 'system',
          content: 'You create a very short, descriptive chat title (max 6 words). Output only the title, no quotes, no punctuation at the end.'
        },
        {
          role: 'user',
          content: `Create a short title for: ${promptUser}`
        },
      ],
    };

    if (!overrides || overrides.includeTemperature) {
      requestBody.temperature = 0.2;
    }
    if (overrides) {
      requestBody.reasoning_effort = overrides.reasoningEffort;
    }
    return requestBody;
  }

  /**
   * Extract system prompt from request body with fallback handling
   * @param {Object} bodyIn - Request body
   * @returns {string} System prompt or empty string
   */
  static extractSystemPrompt(bodyIn) {
    const sysPrompt = typeof bodyIn?.systemPrompt === 'string'
      ? bodyIn.systemPrompt.trim()
      : (typeof bodyIn?.system_prompt === 'string' ? bodyIn.system_prompt.trim() : '');

    return sysPrompt;
  }

  /**
   * Find the last user message from a message array for title generation
   * @param {Array} messages - Array of messages
   * @returns {Object|null} Last user message or null
   */
  static findLastUserMessage(messages) {
    const nonSystemMessages = messages.filter(m => m && m.role !== 'system');

    return [...nonSystemMessages]
      .reverse()
      .find(m => m && m.role === 'user' && (typeof m.content === 'string' || Array.isArray(m.content))) || null;
  }

  /**
   * Extract text content from message content (string or mixed content array)
   * @param {string|Array} content - Message content
   * @returns {string} Extracted text content
   */
  static extractTextFromContent(content) {
    if (typeof content === 'string') {
      return content;
    }

    if (Array.isArray(content)) {
      return content
        .filter(part => part && part.type === 'text' && typeof part.text === 'string')
        .map(part => part.text)
        .join(' ');
    }

    return '';
  }
}