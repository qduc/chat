import { Readable } from 'node:stream';
import { BaseProvider } from './baseProvider.js';

const FALLBACK_MODEL = 'gpt-4.1-mini';
const OPENAI_ALLOWED_REQUEST_KEYS = new Set([
  'frequency_penalty',
  'logit_bias',
  'logprobs',
  'max_completion_tokens',
  'max_output_tokens',
  'max_prompt_tokens',
  'max_tokens',
  'metadata',
  'modalities',
  'n',
  'parallel_tool_calls',
  'presence_penalty',
  'prediction',
  'reasoning_effort',
  'response_format',
  'seed',
  'stop',
  'store',
  'store_tokens',
  'temperature',
  'tool_choice',
  'top_k',
  'top_p',
  'user',
  'verbosity',
]);

const RESERVED_INTERNAL_KEYS = new Set([
  'conversation_id',
  'provider_id',
  'provider',
  'streamingEnabled',
  'toolsEnabled',
  'qualityLevel',
  'researchMode',
  'systemPrompt',
  'system_prompt',
]);

function normalizeToolCall(toolCall) {
  if (!toolCall || typeof toolCall !== 'object') return null;
  const fn = toolCall.function || {};
  const normalizedFn = {};
  if (typeof fn.name === 'string' && fn.name.trim()) {
    normalizedFn.name = fn.name.trim();
  }
  if ('arguments' in fn) {
    if (typeof fn.arguments === 'string') {
      normalizedFn.arguments = fn.arguments;
    } else {
      try {
        normalizedFn.arguments = JSON.stringify(fn.arguments ?? {});
      } catch {
        normalizedFn.arguments = '{}';
      }
    }
  } else {
    normalizedFn.arguments = '{}';
  }

  const normalized = {
    type: toolCall.type || 'function',
    function: normalizedFn,
  };

  if (typeof toolCall.id === 'string' && toolCall.id) {
    normalized.id = toolCall.id;
  }

  if (typeof toolCall.index === 'number') {
    normalized.index = toolCall.index;
  }

  return normalized;
}

function normalizeToolSpec(tool) {
  if (!tool) return null;
  if (typeof tool === 'string') {
    return {
      type: 'function',
      function: {
        name: tool,
        description: '',
        parameters: { type: 'object', properties: {} },
      },
    };
  }
  if (typeof tool !== 'object') return null;

  const spec = { type: tool.type || 'function' };
  if (tool.function && typeof tool.function === 'object') {
    spec.function = { ...tool.function };
  }
  return spec;
}

function normalizeMessage(message) {
  if (!message || typeof message !== 'object') return null;
  const role = typeof message.role === 'string' ? message.role : undefined;
  if (!role) return null;

  const normalized = { role };
  if ('content' in message) {
    const content = message.content;
    if (Array.isArray(content)) {
      normalized.content = content;
    } else if (content === null || typeof content === 'object') {
      normalized.content = content;
    } else if (content !== undefined) {
      normalized.content = String(content);
    }
  }

  if (typeof message.name === 'string' && message.name.trim()) {
    normalized.name = message.name.trim();
  }

  if (typeof message.tool_call_id === 'string' && message.tool_call_id.trim()) {
    normalized.tool_call_id = message.tool_call_id.trim();
  }

  if (Array.isArray(message.tool_calls)) {
    const normalizedCalls = message.tool_calls
      .map(normalizeToolCall)
      .filter(Boolean);
    if (normalizedCalls.length > 0) {
      normalized.tool_calls = normalizedCalls;
      if (!('content' in normalized)) normalized.content = null;
    }
  }

  if (message.function_call && typeof message.function_call === 'object') {
    const fn = message.function_call;
    const normalizedFn = {};
    if (typeof fn.name === 'string') normalizedFn.name = fn.name;
    if ('arguments' in fn) {
      normalizedFn.arguments = typeof fn.arguments === 'string'
        ? fn.arguments
        : JSON.stringify(fn.arguments ?? {});
    }
    if (Object.keys(normalizedFn).length > 0) {
      normalized.function_call = normalizedFn;
    }
  }

  return normalized;
}

function normalizeMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .map(normalizeMessage)
    .filter(Boolean);
}

function normalizeTools(tools) {
  if (!Array.isArray(tools)) return undefined;
  const normalized = tools.map(normalizeToolSpec).filter(Boolean);
  return normalized.length > 0 ? normalized : undefined;
}

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

function omitReservedKeys(payload) {
  if (!payload || typeof payload !== 'object') return {};
  const result = {};
  for (const [key, value] of Object.entries(payload)) {
    if (RESERVED_INTERNAL_KEYS.has(key)) continue;
    result[key] = value;
  }
  return result;
}

export class OpenAIProvider extends BaseProvider {
  get apiKey() {
    return this.settings?.apiKey
      || this.config?.providerConfig?.apiKey
      || this.config?.openaiApiKey;
  }

  get baseUrl() {
    const configuredBase = this.settings?.baseUrl
      || this.config?.providerConfig?.baseUrl
      || this.config?.openaiBaseUrl
      || 'https://api.openai.com/v1';
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

  normalizeRequest(internalRequest = {}) {
    const payload = omitReservedKeys(internalRequest);

    const model = payload.model || this.getDefaultModel();
    if (!model) {
      throw new Error('OpenAI provider requires a model');
    }

    const normalized = {
      model,
      messages: normalizeMessages(payload.messages),
    };

    if (normalized.messages.length === 0) {
      throw new Error('OpenAI provider requires at least one message');
    }

    if ('stream' in payload) {
      normalized.stream = Boolean(payload.stream);
    }

    const tools = normalizeTools(payload.tools);
    if (tools) {
      normalized.tools = tools;
      if (payload.tool_choice !== undefined) {
        normalized.tool_choice = payload.tool_choice;
      }
    }

    for (const [key, value] of Object.entries(payload)) {
      if (value === undefined) continue;
      if (key === 'messages' || key === 'model' || key === 'tools' || key === 'tool_choice' || key === 'stream') continue;
      if (OPENAI_ALLOWED_REQUEST_KEYS.has(key)) {
        normalized[key] = value;
      }
    }

    // Only forward reasoning controls when supported for the target model.
    if (!this.supportsReasoningControls(model)) {
      delete normalized.reasoning_effort;
      delete normalized.verbosity;
    }

    return normalized;
  }

  async sendRequest(normalizedRequest) {
    const client = this.httpClient;
    if (!client) {
      throw new Error('No HTTP client available for OpenAI provider');
    }

    const url = `${this.baseUrl}/v1/chat/completions`;
    const headers = {
      'Content-Type': 'application/json',
      ...(normalizedRequest?.stream ? { Accept: 'text/event-stream' } : { Accept: 'application/json' }),
      ...this.defaultHeaders,
    };

    if (this.apiKey && !headers.Authorization) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    const response = await client(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(normalizedRequest),
    });

    if (normalizedRequest?.stream) {
      return wrapStreamingResponse(response);
    }

    return response;
  }

  normalizeResponse(upstreamResponse) {
    if (typeof upstreamResponse === 'string') {
      try {
        return JSON.parse(upstreamResponse);
      } catch {
        return upstreamResponse;
      }
    }
    return upstreamResponse;
  }

  normalizeStreamChunk(chunk) {
    if (!chunk) return null;
    if (typeof chunk === 'string') {
      const trimmed = chunk.trim();
      if (!trimmed) return null;
      if (trimmed === '[DONE]') return trimmed;
      try {
        return JSON.parse(trimmed);
      } catch {
        return null;
      }
    }
    return chunk;
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
