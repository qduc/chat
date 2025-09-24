import { Readable } from 'node:stream';
import { BaseProvider } from './baseProvider.js';
import { ChatCompletionsAdapter } from '../adapters/chatCompletionsAdapter.js';
import { ResponsesAPIAdapter } from '../adapters/responsesApiAdapter.js';

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
    return baseUrl.includes('api.openai.com') && this.isResponsesAPIEnabled();
  }

  resolveResponsesAdapter() {
    return ResponsesAPIAdapter;
  }

  isResponsesAPIEnabled() {
    if (typeof this.config?.featureFlags?.responsesApiEnabled === 'boolean') {
      return this.config.featureFlags.responsesApiEnabled;
    }
    if (typeof this.settings?.responsesApiEnabled === 'boolean') {
      return this.settings.responsesApiEnabled;
    }
    return process.env.RESPONSES_API_ENABLED === 'true';
  }

  get apiKey() {
    return this.settings?.apiKey
      || this.config?.providerConfig?.apiKey
      || this.config?.openaiApiKey;
  }

  get baseUrl() {
    const seededDefaultUrl = 'https://api.openai.com/v1';
    const dbBaseUrl = this.settings?.baseUrl;
    const overrideBaseUrl = this.config?.providerConfig?.baseUrl || this.config?.openaiBaseUrl;
    const shouldPreferOverride = Boolean(overrideBaseUrl)
      && (!dbBaseUrl || dbBaseUrl === seededDefaultUrl);
    const configuredBase = shouldPreferOverride
      ? overrideBaseUrl
      : dbBaseUrl || overrideBaseUrl || seededDefaultUrl;
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

    const response = await client(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(translatedRequest),
    });

    if (translatedRequest?.stream) {
      return wrapStreamingResponse(response);
    }

    return response;
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
    const normalized = model.toLowerCase();
    if (!normalized.startsWith('gpt-5')) return false;
    return !normalized.includes('chat');
  }

  getDefaultModel() {
    return this.settings?.defaultModel
      || this.config?.defaultModel
      || FALLBACK_MODEL;
  }
}
