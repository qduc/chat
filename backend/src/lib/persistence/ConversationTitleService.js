import { createOpenAIRequest } from '../streamUtils.js';
import { providerIsConfigured } from '../providers/index.js';
import { logger } from '../../logger.js';

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

      // Check if provider is configured for API requests
      const configured = await providerIsConfigured(this.config);
      if (!configured) {
        return this.generateFallbackTitle(text);
      }

      const title = await this._requestTitleFromAPI(text, providerId, model);
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
    const promptUser = text.length > 500 ? text.slice(0, 500) + '…' : text;

    const requestBody = {
      model: model || this.config.titleModel || this.config.defaultModel || 'gpt-4.1-mini',
      temperature: 0.2,
      max_tokens: 20,
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

    const resp = await createOpenAIRequest(this.config, requestBody, { providerId });

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