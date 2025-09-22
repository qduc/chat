import { BaseProvider } from './baseProvider.js';

export class OpenAIProvider extends BaseProvider {
  isConfigured() {
    // TODO: check for API keys or other required OpenAI config.
    return Boolean(this.settings?.apiKey || this.config?.openaiApiKey);
  }

  normalizeRequest(internalRequest) {
    // TODO: adapt internal request into OpenAI Chat Completions payload.
    return internalRequest;
  }

  async sendRequest(normalizedRequest) {
    // TODO: move legacy OpenAI fetch logic into a dedicated adapter.
    const base = String(this.settings?.baseUrl || '').replace(/\/v1\/?$/, '');
    const url = `${base}/v1/chat/completions`;
    const apiKey = this.settings?.apiKey;
    const headers = {
      'Content-Type': 'application/json',
      ...(this.settings?.headers || {}),
    };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const http = this.http || globalThis.fetch;
    if (!http) {
      throw new Error('No HTTP client available for OpenAI provider');
    }
    return http(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(normalizedRequest),
    });
  }

  normalizeResponse(upstreamResponse) {
    // TODO: shape OpenAI response back into internal response format.
    return upstreamResponse;
  }

  normalizeStreamChunk(chunk) {
    // TODO: translate OpenAI streaming chunk to internal chunk structure.
    return chunk;
  }

  getToolsetSpec(toolRegistry) {
    // TODO: emit OpenAI function-call tool schema.
    return toolRegistry?.generateOpenAIToolSpecs?.() || [];
  }

  supportsTools() {
    // TODO: return true when OpenAI supports tools for the selected model.
    return true;
  }

  supportsReasoningControls(model) {
    // TODO: align with OpenAI's reasoning control availability.
    return typeof model === 'string' && model.startsWith('gpt-5');
  }

  getDefaultModel() {
    // TODO: pull default model from config or persistence layer.
    return this.settings?.defaultModel || this.config?.defaultModel;
  }
}
