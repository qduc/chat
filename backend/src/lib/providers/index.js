// Provider registry and interface helpers
// Each provider should implement:
// - name: string
// - isConfigured(config): boolean
// - supportsReasoningControls(model): boolean
// - createChatCompletionsRequest(config, requestBody): Promise<Response>

import fetch from 'node-fetch';

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
    const base = (config?.providerConfig?.baseUrl || config?.openaiBaseUrl || '').replace(/\/v1\/?$/, '');
    const url = `${base}/v1/chat/completions`;
    const apiKey = config?.providerConfig?.apiKey || config?.openaiApiKey;
    const extraHeaders = headerDict(config?.providerConfig?.headers || {});
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

