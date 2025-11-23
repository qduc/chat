import { Readable } from 'node:stream';
import { logUpstreamRequest, logUpstreamResponse, teeStreamWithPreview } from '../logging/upstreamLogger.js';
import { BaseProvider, ProviderModelsError } from './baseProvider.js';
import { ChatCompletionsAdapter } from '../adapters/chatCompletionsAdapter.js';
import { ResponsesAPIAdapter } from '../adapters/responsesApiAdapter.js';
import { logger } from '../../logger.js';

const FALLBACK_MODEL = 'gpt-4.1-mini';


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

export class OpenAIProvider extends BaseProvider {
  static get defaultBaseUrl() {
    return 'https://api.openai.com/v1';
  }

  createAdapter() {
    if (this.shouldUseResponsesAPI()) {
      const ResponsesAPIAdapter = this.resolveResponsesAdapter();
      if (ResponsesAPIAdapter) {
        return new ResponsesAPIAdapter({
          config: this.config,
          settings: this.settings,
          getDefaultModel: () => this.getDefaultModel(),
          supportsReasoningControls: (model) => this.supportsReasoningControls(model),
        });
      }
    }

    return new ChatCompletionsAdapter({
      config: this.config,
      settings: this.settings,
      getDefaultModel: () => this.getDefaultModel(),
      supportsReasoningControls: (model) => this.supportsReasoningControls(model),
    });
  }

  buildAdapterContext(context = {}) {
    return {
      getDefaultModel: () => this.getDefaultModel(),
      supportsReasoningControls: (model) => this.supportsReasoningControls(model),
      ...context,
    };
  }

  shouldUseResponsesAPI() {
    const baseUrl = (this.baseUrl || '').toLowerCase();
    return baseUrl.includes('api.openai.com');
  }

  resolveResponsesAdapter() {
    return ResponsesAPIAdapter;
  }

  get apiKey() {
    return this.settings?.apiKey || this.config?.providerConfig?.apiKey || this.config?.openaiApiKey;
  }

  get baseUrl() {
    const seededDefaultUrl = 'https://api.openai.com/v1';
    const dbBaseUrl = this.settings?.baseUrl;
    const overrideBaseUrl = this.config?.providerConfig?.baseUrl || this.config?.openaiBaseUrl;
    const shouldPreferOverride = Boolean(overrideBaseUrl) && (!dbBaseUrl || dbBaseUrl === seededDefaultUrl);
    const configuredBase = shouldPreferOverride ? overrideBaseUrl : dbBaseUrl || overrideBaseUrl || seededDefaultUrl;
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
    return Boolean(this.apiKey || this.defaultHeaders.Authorization);
  }

  async makeHttpRequest(translatedRequest) {
    const client = this.httpClient;
    if (!client) {
      throw new Error('No HTTP client available for OpenAI provider');
    }

    const endpoint = translatedRequest?.__endpoint || '/v1/chat/completions';
    const url = `${this.baseUrl}${endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      ...(translatedRequest?.stream ? { Accept: 'text/event-stream' } : { Accept: 'application/json' }),
      ...this.defaultHeaders,
    };

    if (this.apiKey && !headers.Authorization) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    // Log the exact upstream request for debugging using centralized logger
    try {
      logUpstreamRequest({ url, headers, body: translatedRequest });
    } catch (err) {
      // logger should be best-effort; don't let logging break requests
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
      throw new Error('No HTTP client available for OpenAI provider');
    }

    const url = `${this.baseUrl}/v1/models`;
    const headers = {
      Accept: 'application/json',
      ...this.defaultHeaders,
    };

    if (this.apiKey && !headers.Authorization) {
      headers.Authorization = `Bearer ${this.apiKey}`;
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

    let models = this.normalizeModelListPayload(payload);

    const normalizedBase = String(this.baseUrl || '').toLowerCase();
    if (normalizedBase.includes('openrouter.ai')) {
      const oneYearAgo = Math.floor(Date.now() / 1000) - 365 * 24 * 60 * 60;
      models = models.filter((model) => {
        if (!model?.created) return true;
        return model.created >= oneYearAgo;
      });
    }

    return models;
  }

  getToolsetSpec(toolRegistry) {
    if (!toolRegistry) return [];
    if (Array.isArray(toolRegistry)) return toolRegistry;
    if (typeof toolRegistry.generateOpenAIToolSpecs === 'function') {
      return toolRegistry.generateOpenAIToolSpecs();
    }
    if (typeof toolRegistry.generateToolSpecs === 'function') {
      return toolRegistry.generateToolSpecs();
    }
    return [];
  }

  supportsTools() {
    return true;
  }

  supportsReasoningControls(model) {
    if (!model || typeof model !== 'string') return false;
    // const normalized = model.toLowerCase();
    // if (!normalized.includes('gpt-5') && !normalized.includes('o3') && !normalized.includes('o4')) return false;
    // return !normalized.includes('chat');
    // Trust what frontend send, backend will not check this
    return true;
  }

  supportsPromptCaching(model) {
    const baseUrl = (this.baseUrl || '').toLowerCase();

    // OpenRouter supports passing through cache_control for Anthropic models
    if (baseUrl.includes('openrouter.ai')) {
      const modelStr = (model || '').toLowerCase();
      return modelStr.includes('anthropic') || modelStr.includes('claude');
    }

    // OpenAI doesn't natively support Anthropic's cache_control format
    return false;
  }

  getDefaultModel() {
    return this.settings?.defaultModel || this.config?.defaultModel || FALLBACK_MODEL;
  }
}
