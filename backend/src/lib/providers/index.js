// Provider registry and interface helpers
// Each provider should implement:
// - name: string
// - isConfigured(config): boolean
// - supportsReasoningControls(model): boolean
// - createChatCompletionsRequest(config, requestBody): Promise<Response>

import fetch from 'node-fetch';
import { getDb } from '../../db/index.js';

function parseJSONSafe(s, fallback) {
  try {
    if (!s) return fallback;
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}

async function resolveProviderSettings(config) {
  try {
    const db = getDb();
    if (db) {
      const row = db
        .prepare(
          `SELECT id, name, provider_type, api_key, base_url, extra_headers, metadata
           FROM providers
           WHERE enabled = 1 AND deleted_at IS NULL
           ORDER BY is_default DESC, updated_at DESC
           LIMIT 1`
        )
        .get();
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
        };
      }
    }
  } catch (e) {
    // fall through to env fallback
  }

  // Fallback to env-based config
  return {
    source: 'env',
    providerType: (config?.provider || 'openai'),
    baseUrl: config?.providerConfig?.baseUrl || config?.openaiBaseUrl,
    apiKey: config?.providerConfig?.apiKey || config?.openaiApiKey,
    headers: { ...(config?.providerConfig?.headers || {}) },
    defaultModel: config?.defaultModel,
  };
}

function headerDict(obj) {
  // Normalize header keys to proper casing where helpful but keep as-is mostly
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) out[k] = v;
  return out;
}

// OpenAI-compatible provider
const OpenAIProvider = {
  name: 'openai',
  isConfigured(config) {
    // OpenAI legacy fields
    return !!(config?.openaiApiKey || config?.providerConfig?.apiKey);
  },
  supportsReasoningControls(model) {
    return typeof model === 'string' && model.startsWith('gpt-5');
  },
  async createChatCompletionsRequest(config, requestBody) {
    const settings = await resolveProviderSettings(config);
    const base = String(settings.baseUrl || '').replace(/\/v1\/?$/, '');
    const url = `${base}/v1/chat/completions`;
    const apiKey = settings.apiKey;
    const extraHeaders = headerDict(settings.headers || {});
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      ...extraHeaders,
    };
    return fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
    });
  },
};

const providers = {
  openai: OpenAIProvider,
};

export function getProvider(config) {
  const key = (config?.provider || 'openai').toLowerCase();
  return providers[key] || OpenAIProvider;
}

export function providerIsConfigured(config) {
  return getProvider(config).isConfigured(config);
}

export function providerSupportsReasoning(config, model) {
  return getProvider(config).supportsReasoningControls(model);
}

export async function providerChatCompletions(config, requestBody) {
  const provider = getProvider(config);
  return provider.createChatCompletionsRequest(config, requestBody);
}

export async function getDefaultModel(config) {
  const settings = await resolveProviderSettings(config);
  return settings.defaultModel || config?.defaultModel;
}
