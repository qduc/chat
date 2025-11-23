import { BaseProvider, ProviderModelsError } from './baseProvider.js';
import { GeminiAdapter } from '../adapters/geminiAdapter.js';
import { logger } from '../../logger.js';
import { logUpstreamRequest, logUpstreamResponse, teeStreamWithPreview } from '../logging/upstreamLogger.js';
import { Readable } from 'node:stream';

function wrapStreamingResponse(response) {
  if (!response || !response.body) return response;
  if (typeof response.body.on === 'function') return response;

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

export class GeminiProvider extends BaseProvider {
  createAdapter() {
    return new GeminiAdapter({
      config: this.config,
      settings: this.settings,
      getDefaultModel: () => this.getDefaultModel(),
    });
  }

  get apiKey() {
    return (
      this.settings?.apiKey ||
      this.config?.providerConfig?.apiKey ||
      this.config?.geminiApiKey ||
      process.env.GEMINI_API_KEY
    );
  }

  get baseUrl() {
    return (
      this.settings?.baseUrl ||
      this.config?.providerConfig?.baseUrl ||
      'https://generativelanguage.googleapis.com/v1beta'
    );
  }

  get defaultHeaders() {
    return {
      ...(this.config?.providerConfig?.headers || {}),
      ...(this.settings?.headers || {}),
    };
  }

  isConfigured() {
    return Boolean(this.apiKey);
  }

  async makeHttpRequest(translatedRequest) {
    const client = this.httpClient;
    if (!client) {
      throw new Error('No HTTP client available for Gemini provider');
    }

    const model = translatedRequest.__model;
    const stream = translatedRequest.__stream;

    // Clean up internal flags
    const payload = { ...translatedRequest };
    delete payload.__model;
    delete payload.__stream;

    const method = stream ? 'streamGenerateContent' : 'generateContent';
    let url = `${this.baseUrl}/models/${model}:${method}?key=${this.apiKey}`;

    if (stream) {
      url += '&alt=sse';
    }

    const headers = {
      'Content-Type': 'application/json',
      ...this.defaultHeaders,
    };

    // Log upstream request
    try {
      logUpstreamRequest({ url, headers, body: payload });
    } catch (err) {
      logger.error('Failed to log upstream request:', err);
    }

    const response = await client(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    // Log upstream response
    try {
      const responseHeaders =
        response.headers && typeof response.headers.entries === 'function'
          ? Object.fromEntries(response.headers.entries())
          : {};

      if (stream) {
        const wrappedResponse = wrapStreamingResponse(response);
        const { previewPromise, stream: loggedStream } = teeStreamWithPreview(wrappedResponse.body, {
          maxBytes: 128 * 1024,
          encoding: 'utf8',
        });

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
            logger.error('Failed to capture streaming response preview:', err);
          });

        return new Proxy(wrappedResponse, {
          get(target, prop, receiver) {
            if (prop === 'body') {
              return loggedStream;
            }
            return Reflect.get(target, prop, receiver);
          },
        });
      } else {
        if (response.clone) {
          const clone = response.clone();
          const text = await clone.text();
          logUpstreamResponse({
            url,
            status: response.status,
            headers: responseHeaders,
            body: text,
          });
        }
        return response;
      }
    } catch (err) {
      logger.error('Failed to log upstream response:', err);
      return response;
    }
  }

  getModelsBaseUrl() {
    const value = this.baseUrl ?? '';
    const raw = value ? String(value).trim().replace(/\/$/, '') : '';
    if (!raw) {
      throw new Error('Missing base URL for Gemini provider');
    }
    if (raw.endsWith('/v1beta')) {
      return raw;
    }
    if (raw.endsWith('/v1')) {
      return `${raw.slice(0, -3)}v1beta`;
    }
    return `${raw}/v1beta`;
  }

  async listModels({ timeoutMs } = {}) {
    const client = this.httpClient;
    if (!client) {
      throw new Error('No HTTP client available for Gemini provider');
    }

    const base = this.getModelsBaseUrl();
    const url = `${base}/models`;
    const headers = {
      Accept: 'application/json',
      ...this.defaultHeaders,
    };

    if (this.apiKey && !headers['x-goog-api-key']) {
      headers['x-goog-api-key'] = this.apiKey;
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

  getToolsetSpec(_toolRegistry) {
    // Gemini tool specs are generated by the adapter during translation
    // We don't need to expose them separately here unless the registry needs it
    return [];
  }

  supportsTools() {
    return true;
  }

  supportsReasoningControls(_model) {
    return false;
  }

  supportsPromptCaching() {
    // Gemini supports context caching but it's a different API (cache manager)
    // For per-request caching via messages, it's not the same as Anthropic
    return false;
  }

  getDefaultModel() {
    return this.settings?.defaultModel || this.config?.defaultModel || 'gemini-1.5-flash';
  }
}
