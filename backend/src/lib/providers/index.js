import { getDb } from '../../db/index.js';
import { OpenAIProvider } from './openaiProvider.js';
import { AnthropicProvider } from './anthropicProvider.js';
import { GeminiProvider } from './geminiProvider.js';

function parseJSONSafe(value, fallback) {
  try {
    if (!value) return fallback;
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export async function resolveProviderSettings(config, options = {}) {
  try {
    const db = getDb();
    if (db) {
      let row;
      if (options.providerId) {
        row = db
          .prepare(
            `SELECT id, name, provider_type, api_key, base_url, extra_headers, metadata
             FROM providers
             WHERE id=@id AND enabled = 1 AND deleted_at IS NULL
             LIMIT 1`
          )
          .get({ id: options.providerId });
      }
      if (!row) {
        row = db
          .prepare(
            `SELECT id, name, provider_type, api_key, base_url, extra_headers, metadata
             FROM providers
             WHERE enabled = 1 AND deleted_at IS NULL
             ORDER BY updated_at DESC
             LIMIT 1`
          )
          .get();
      }
      if (row) {
        const headers = parseJSONSafe(row.extra_headers, {});
        const metadata = parseJSONSafe(row.metadata, {});
        return {
          source: 'db',
          providerType: row.provider_type || (config?.provider || 'openai'),
          baseUrl: row.base_url || config?.providerConfig?.baseUrl || config?.openaiBaseUrl,
          apiKey: row.api_key || config?.providerConfig?.apiKey || config?.openaiApiKey,
          headers,
          defaultModel: metadata?.default_model || config?.defaultModel,
          raw: row,
        };
      }
    }
  } catch {
    // TODO: surface diagnostics when provider resolution fails.
  }

  return {
    source: 'env',
    providerType: (config?.provider || 'openai'),
    baseUrl: config?.providerConfig?.baseUrl || config?.openaiBaseUrl,
    apiKey: config?.providerConfig?.apiKey || config?.openaiApiKey,
    headers: { ...(config?.providerConfig?.headers || {}) },
    defaultModel: config?.defaultModel,
    raw: null,
  };
}

const providerConstructors = {
  openai: OpenAIProvider,
  anthropic: AnthropicProvider,
  gemini: GeminiProvider,
};

function selectProviderConstructor(providerType) {
  const key = (providerType || 'openai').toLowerCase();
  return providerConstructors[key] || OpenAIProvider;
}

export async function createProvider(config, options = {}) {
  const settings = await resolveProviderSettings(config, options);
  const ProviderClass = selectProviderConstructor(settings.providerType);
  return new ProviderClass({
    config,
    providerId: options.providerId,
    http: options.http,
    settings,
  });
}

export async function providerIsConfigured(config, options = {}) {
  const provider = await createProvider(config, options);
  return provider.isConfigured();
}

export async function providerSupportsReasoning(config, model, options = {}) {
  const provider = await createProvider(config, options);
  return provider.supportsReasoningControls(model);
}

export async function getDefaultModel(config, options = {}) {
  const provider = await createProvider(config, options);
  return provider.getDefaultModel();
}

export async function providerChatCompletions(config, requestBody, options = {}) {
  const provider = await createProvider(config, options);
  const normalizedRequest = provider.normalizeRequest(requestBody);
  return provider.sendRequest(normalizedRequest);
}
