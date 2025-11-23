import { Readable } from 'node:stream';
import { logUpstreamRequest, logUpstreamResponse, teeStreamWithPreview } from '../logging/upstreamLogger.js';
import { BaseProvider, ProviderModelsError } from './baseProvider.js';
import { MessagesAdapter } from '../adapters/messagesAdapter.js';
import { logger } from '../../logger.js';

const FALLBACK_MODEL = 'claude-3-5-sonnet-20241022';
export const ANTHROPIC_API_VERSION = '2023-06-01';

function wrapStreamingResponse(response) {
  if (!response || !response.body) return response;
  // If the body already exposes Node stream semantics, nothing to do.
  if (typeof response.body.on === 'function') {
    return response;
  }

  // Convert WHATWG ReadableStream to Node.js Readable to satisfy existing consumers.
  const canConvert = typeof Readable?.fromWeb === 'function' && typeof response.body.getReader === 'function';
  if (!canConvert) return response;

  let nodeReadable;
  return new Proxy(response, {
    get(target, prop, receiver) {
      if (prop === 'body') {
        if (!nodeReadable) {
          nodeReadable = Readable.fromWeb(target.body);
        }
        return nodeReadable;
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

export class AnthropicProvider extends BaseProvider {
  createAdapter() {
    return new MessagesAdapter({
      config: this.config,
      settings: this.settings,
      getDefaultModel: () => this.getDefaultModel(),
    });
  }

  buildAdapterContext(context = {}) {
    return {
      getDefaultModel: () => this.getDefaultModel(),
      ...context,
    };
  }

  get apiKey() {
    return this.settings?.apiKey || this.config?.providerConfig?.apiKey || this.config?.anthropicApiKey;
  }

  get baseUrl() {
    const seededDefaultUrl = 'https://api.anthropic.com';
    const dbBaseUrl = this.settings?.baseUrl;
    const normalizedDbBase = dbBaseUrl ? String(dbBaseUrl).replace(/\/$/, '').replace(/\/v1$/, '') : '';
    const isMismatchedDbBase = normalizedDbBase && /api\.openai\.com/i.test(normalizedDbBase);
    const effectiveDbBase = isMismatchedDbBase ? null : normalizedDbBase || null;

    const normalizedAnthropicOverride = this.config?.anthropicBaseUrl
      ? String(this.config.anthropicBaseUrl).replace(/\/$/, '').replace(/\/v1$/, '')
      : null;
    const normalizedProviderOverride = this.config?.providerConfig?.baseUrl
      ? String(this.config.providerConfig.baseUrl).replace(/\/$/, '').replace(/\/v1$/, '')
      : null;
    const providerOverride =
      normalizedProviderOverride && /anthropic/i.test(normalizedProviderOverride) ? normalizedProviderOverride : null;
    const overrideBaseUrl = normalizedAnthropicOverride || providerOverride;

    const shouldPreferOverride = Boolean(overrideBaseUrl) && (!effectiveDbBase || effectiveDbBase === seededDefaultUrl);
    const configuredBase = shouldPreferOverride
      ? overrideBaseUrl
      : effectiveDbBase || overrideBaseUrl || seededDefaultUrl;
    return String(configuredBase).replace(/\/$/, '').replace(/\/v1$/, '');
  }

  get defaultHeaders() {
    return {
      ...(this.config?.providerConfig?.headers || {}),
      ...(this.settings?.headers || {}),
    };
  }

  get httpClient() {
    if (this.http) return this.http;
    if (typeof globalThis.fetch === 'function') return globalThis.fetch.bind(globalThis);
    return null;
  }

  isConfigured() {
    return Boolean(this.apiKey || this.defaultHeaders['x-api-key']);
  }

  async makeHttpRequest(translatedRequest) {
    const client = this.httpClient;
    if (!client) {
      throw new Error('No HTTP client available for Anthropic provider');
    }

    const endpoint = '/v1/messages';
    const url = `${this.baseUrl}${endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      'anthropic-version': ANTHROPIC_API_VERSION,
      ...(translatedRequest?.stream ? { Accept: 'text/event-stream' } : { Accept: 'application/json' }),
      ...this.defaultHeaders,
    };

    if (this.apiKey && !headers['x-api-key']) {
      headers['x-api-key'] = this.apiKey;
    }

    // Log the exact upstream request for debugging
    try {
      logUpstreamRequest({ url, headers, body: translatedRequest });
    } catch (err) {
      logger.error('Failed to log upstream request:', err?.message || err);
    }

    const response = await client(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(translatedRequest),
    });

    // Log the upstream response for debugging
    try {
      const responseHeaders =
        response.headers && typeof response.headers.entries === 'function'
          ? Object.fromEntries(response.headers.entries())
          : {};

      // Check if response is actually a stream by inspecting content-type
      const contentType = response.headers?.get?.('content-type') || '';
      const isActuallyStreaming = contentType.includes('text/event-stream') || contentType.includes('text/plain');

      if (translatedRequest?.stream && isActuallyStreaming) {
        // For streaming responses, tee the stream to capture SSE data
        const wrappedResponse = wrapStreamingResponse(response);
        const { previewPromise, stream: loggedStream } = teeStreamWithPreview(wrappedResponse.body, {
          maxBytes: 128 * 1024, // Capture up to 128KB of SSE data
          encoding: 'utf8',
        });

        // Log asynchronously without blocking the response
        previewPromise
          .then((preview) => {
            logUpstreamResponse({
              url,
              status: response.status,
              headers: responseHeaders,
              body: preview,
            });
          })
          .catch((err) => {
            logger.error('Failed to capture streaming response preview:', err?.message || err);
          });

        // Return response with the logged stream
        return new Proxy(wrappedResponse, {
          get(target, prop, receiver) {
            if (prop === 'body') {
              return loggedStream;
            }
            return Reflect.get(target, prop, receiver);
          },
        });
      } else {
        // For non-streaming responses, capture the body
        let responseBody = null;
        if (response.clone) {
          const responseClone = response.clone();
          if (typeof responseClone.text === 'function') {
            responseBody = await responseClone.text();
          }
        }
        logUpstreamResponse({
          url,
          status: response.status,
          headers: responseHeaders,
          body: responseBody,
        });
        return response;
      }
    } catch (err) {
      // logger should be best-effort; don't let logging break responses
      logger.error('Failed to log upstream response:', err?.message || err);
      if (translatedRequest?.stream) {
        return wrapStreamingResponse(response);
      }
      return response;
    }
  }

  async listModels({ timeoutMs } = {}) {
    const client = this.httpClient;
    if (!client) {
      throw new Error('No HTTP client available for Anthropic provider');
    }

    const url = `${this.baseUrl}/v1/models`;
    const headers = {
      Accept: 'application/json',
      'anthropic-version': ANTHROPIC_API_VERSION,
      ...this.defaultHeaders,
    };

    if (this.apiKey && !headers['x-api-key']) {
      headers['x-api-key'] = this.apiKey;
    }

    const response = await client(url, {
      method: 'GET',
      headers,
      timeout: timeoutMs,
    });

    if (!response.ok) {
      const errorBody = typeof response.text === 'function' ? await response.text().catch(() => '') : '';
      throw new ProviderModelsError('Failed to fetch models', {
        status: response.status,
        body: errorBody,
      });
    }

    let payload = {};
    if (typeof response.json === 'function') {
      try {
        payload = await response.json();
      } catch {
        payload = {};
      }
    } else if (typeof response.text === 'function') {
      const raw = await response.text().catch(() => '');
      if (raw) {
        try {
          payload = JSON.parse(raw);
        } catch {
          payload = {};
        }
      }
    }

    return this.normalizeModelListPayload(payload);
  }

  getToolsetSpec(toolRegistry) {
    if (!toolRegistry) return [];
    if (Array.isArray(toolRegistry)) {
      // Convert OpenAI tool specs to Anthropic format
      return toolRegistry.map((tool) => {
        if (typeof tool === 'string') {
          return {
            name: tool,
            description: '',
            input_schema: { type: 'object', properties: {} },
          };
        }
        const fn = tool.function || tool;
        return {
          name: fn.name,
          description: fn.description || '',
          input_schema: fn.parameters || fn.input_schema || { type: 'object', properties: {} },
        };
      });
    }
    if (typeof toolRegistry.generateOpenAIToolSpecs === 'function') {
      const openAISpecs = toolRegistry.generateOpenAIToolSpecs();
      return this.getToolsetSpec(openAISpecs);
    }
    if (typeof toolRegistry.generateToolSpecs === 'function') {
      const specs = toolRegistry.generateToolSpecs();
      return this.getToolsetSpec(specs);
    }
    return [];
  }

  supportsTools() {
    return true;
  }

  supportsReasoningControls(_model) {
    // Anthropic models like Claude 3.5 Sonnet support extended thinking
    // but it uses a different mechanism than OpenAI's reasoning controls
    // For now, return false to avoid confusion
    return false;
  }

  supportsPromptCaching() {
    // Anthropic supports prompt caching natively via cache_control in messages
    // Available for Claude 3.5+ models
    return true;
  }

  needsStreamingTranslation() {
    return true;
  }

  getDefaultModel() {
    return this.settings?.defaultModel || this.config?.defaultModel || FALLBACK_MODEL;
  }
}
