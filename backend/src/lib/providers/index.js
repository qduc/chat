import { getDb } from '../../db/client.js';
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

function normalizeBaseUrl(url) {
  if (!url) return undefined;
  return String(url).trim().replace(/\/$/, '').replace(/\/v1$/, '');
}

const providerConstructors = {
  'openai-responses': OpenAIProvider,
  'openai-completions': OpenAIProvider,
  anthropic: AnthropicProvider,
  gemini: GeminiProvider,
};

export function selectProviderConstructor(providerType) {
  const key = (providerType || 'openai-completions').toLowerCase();
  return providerConstructors[key] || OpenAIProvider;
}

function getProviderDefaults(providerType) {
  const type = (providerType || 'openai').toLowerCase();
  const ProviderClass = selectProviderConstructor(type);
  return {
    baseUrl: ProviderClass.defaultBaseUrl,
    apiKey: null,  // API key only from database
  };
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
        const responsesApiEnabled =
          typeof metadata?.responses_api_enabled === 'boolean' ? metadata.responses_api_enabled : undefined;
        const providerType = (row.provider_type || config?.provider || 'openai').toLowerCase();
        const defaults = getProviderDefaults(providerType);
        const baseUrl = normalizeBaseUrl(row.base_url || defaults.baseUrl);

        return {
          source: 'db',
          providerType,
          baseUrl,
          apiKey: row.api_key || null,
          headers,
          defaultModel: config?.defaultModel, // Only use config defaultModel, not from metadata
          responsesApiEnabled,
          raw: row,
        };
      }
    }
  } catch {
    // TODO: surface diagnostics when provider resolution fails.
  }

  const providerType = config?.provider || 'openai';
  const defaults = getProviderDefaults(providerType);

  return {
    source: 'env',
    providerType,
    baseUrl: defaults.baseUrl,
    apiKey: null,
    headers: {},
    defaultModel: config?.defaultModel,
    responsesApiEnabled: config?.featureFlags?.responsesApiEnabled,
    raw: null,
  };
}

export function createProviderWithSettings(config, providerType, settings = {}, options = {}) {
  const normalizedType = (providerType || settings?.providerType || config?.provider || 'openai').toLowerCase();
  const ProviderClass = selectProviderConstructor(normalizedType);
  return new ProviderClass({
    config,
    providerId: options.providerId,
    http: options.http,
    settings: {
      ...settings,
      providerType: normalizedType,
    },
  });
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
  const context = {
    providerId: options.providerId || provider.providerId,
    ...options.context,
  };
  return provider.sendRawRequest(requestBody, context);
}
