import { Readable } from 'node:stream';
import { BaseAdapter } from './baseAdapter.js';
import { parseSSEStream } from '../sseParser.js';
import { createChatCompletionChunk } from '../streamUtils.js';

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

const RESPONSES_ALLOWED_REQUEST_KEYS = new Set([
  'metadata',
  'temperature',
  'top_p',
  'top_k',
  'max_output_tokens',
  'stop',
  'stream',
  'response_format',
  'reasoning',
  'text',
  'user',
  'previous_response_id',
]);

function omitReservedKeys(payload) {
  if (!payload || typeof payload !== 'object') return {};
  const result = {};
  for (const [key, value] of Object.entries(payload)) {
    if (RESERVED_INTERNAL_KEYS.has(key)) continue;
    result[key] = value;
  }
  return result;
}

function asString(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return value.map(asString).join('');
  }
  if (typeof value === 'object') {
    if (typeof value.text === 'string') return value.text;
    if (Array.isArray(value.text)) return value.text.map(asString).join('');
    if (Array.isArray(value.content)) return value.content.map(asString).join('');
  }
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

function extractSystemInstructions(messages) {
  if (!Array.isArray(messages)) return undefined;
  const parts = [];
  for (const msg of messages) {
    if (!msg || msg.role !== 'system') continue;
    const content = 'content' in msg ? msg.content : undefined;
    const str = asString(content);
    if (str) parts.push(str);
  }
  if (parts.length === 0) return undefined;
  return parts.join('\n\n');
}

function toResponsesContent(role, content) {
  const type = role === 'user'
    ? 'input_text'
    : role === 'assistant'
      ? 'output_text'
      : role === 'tool'
        ? 'tool_result'
        : 'output_text';

  const ensureItem = (value) => {
    if (value === null || value === undefined) {
      return null;
    }
    if (typeof value === 'string') {
      return { type, text: value };
    }
    if (typeof value === 'object') {
      if (typeof value.type === 'string' && value.text !== undefined) {
        return value;
      }
      if (typeof value.text === 'string') {
        return { type, text: value.text };
      }
      if (value.content !== undefined) {
        return { type, text: asString(value.content) };
      }
    }
    return { type, text: asString(value) };
  };

  if (Array.isArray(content)) {
    const items = content
      .map((part) => ensureItem(part))
      .filter(Boolean);
    return items.length > 0 ? items : [{ type, text: '' }];
  }

  const item = ensureItem(content);
  return item ? [item] : [{ type, text: '' }];
}

function normalizeMessagesToInput(messages = []) {
  if (!Array.isArray(messages)) return [];
  const input = [];
  for (const message of messages) {
    if (!message || typeof message !== 'object') continue;
    if (message.role === 'system') continue;
    const role = typeof message.role === 'string' ? message.role : 'user';
    const content = toResponsesContent(role, message.content ?? '');
    input.push({ role, content });
  }
  return input;
}

function collectTextFromOutput(output) {
  const parts = [];
  const walk = (node) => {
    if (node === null || node === undefined) return;
    if (typeof node === 'string') {
      parts.push(node);
      return;
    }
    if (typeof node === 'number' || typeof node === 'boolean') {
      parts.push(String(node));
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) {
        walk(item);
      }
      return;
    }
    if (typeof node === 'object') {
      if (typeof node.text === 'string') {
        parts.push(node.text);
      }
      if (Array.isArray(node.text)) {
        for (const item of node.text) {
          walk(item);
        }
      }
      if (Array.isArray(node.content)) {
        for (const item of node.content) {
          walk(item);
        }
      }
      if (typeof node.delta === 'string') {
        parts.push(node.delta);
      }
    }
  };
  walk(output);
  return parts.join('');
}

function normalizeTimestamp(value) {
  if (typeof value === 'number') {
    // Accept both seconds and milliseconds
    return value > 1e12 ? Math.floor(value / 1000) : Math.floor(value);
  }
  return Math.floor(Date.now() / 1000);
}

function convertResponsesJson(json, context) {
  if (!json || typeof json !== 'object') return json;

  const response = json.response && typeof json.response === 'object'
    ? json.response
    : json;

  const id = response.id || json.id || `resp_${Date.now()}`;
  const model = response.model || json.model || context.requestedModel || context.getDefaultModel?.() || 'gpt-4.1-mini';
  const created = normalizeTimestamp(response.created_at || response.created || json.created_at || json.created);
  const status = response.status || json.status;
  const finishReason = status === 'completed' || status === 'succeeded'
    ? 'stop'
    : status === 'in_progress'
      ? null
      : status || 'stop';

  const outputSource = response.output ?? json.output ?? response.output_text ?? json.output_text;
  const assistantContent = collectTextFromOutput(outputSource);

  // Extract reasoning summary if present
  const reasoningSummary = response.reasoning_summary ?? json.reasoning_summary;

  const mapped = {
    id,
    object: 'chat.completion',
    created,
    model,
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content: assistantContent,
        ...(reasoningSummary && { reasoning_content: reasoningSummary }),
      },
      finish_reason: finishReason,
    }],
  };

  if (json.usage || response.usage) {
    mapped.usage = response.usage || json.usage;
  }

  return mapped;
}

function ensureResponseId(state) {
  if (!state.responseId) {
    state.responseId = state.fallbackResponseId || `resp_${Date.now()}`;
  }
  return state.responseId;
}

function ensureModel(state) {
  return state.model || 'gpt-4.1-mini';
}

function convertStreamingEvent(event, state) {
  if (!event || typeof event !== 'object') return null;

  if (event.response && typeof event.response === 'object') {
    if (event.response.id) state.responseId = event.response.id;
    if (event.response.model) state.model = event.response.model;
  }
  if (event.response_id) state.responseId = event.response_id;
  if (event.model) state.model = event.model;

  switch (event.type) {
    case 'response.output_text.delta': {
      const deltaText = typeof event.delta === 'string'
        ? event.delta
        : asString(event.delta);
      if (!deltaText) return null;
      const chunk = createChatCompletionChunk(
        ensureResponseId(state),
        ensureModel(state),
        { content: deltaText },
        null,
      );
      return chunk;
    }
    case 'response.completed': {
      const chunk = createChatCompletionChunk(
        ensureResponseId(state),
        ensureModel(state),
        {},
        'stop',
      );
      return chunk;
    }
    case 'response.refusal.delta': {
      const deltaText = typeof event.delta === 'string' ? event.delta : asString(event.delta);
      if (!deltaText) return null;
      const chunk = createChatCompletionChunk(
        ensureResponseId(state),
        ensureModel(state),
        { refusal: deltaText },
        null,
      );
      return chunk;
    }
    case 'response.error': {
      const chunk = createChatCompletionChunk(
        ensureResponseId(state),
        ensureModel(state),
        {},
        'error',
      );
      return chunk;
    }
    default:
      return null;
  }
}

function buildStreamingResponse(providerResponse, context) {
  const upstream = providerResponse?.body;
  if (!upstream || typeof upstream.on !== 'function') {
    return providerResponse;
  }

  const transformed = new Readable({ read() {} });
  const state = {
    responseId: null,
    model: context.requestedModel || context.getDefaultModel?.() || 'gpt-4.1-mini',
    fallbackResponseId: context.fallbackResponseId,
  };
  let leftover = '';

  upstream.on('data', (chunk) => {
    try {
      leftover = parseSSEStream(
        chunk,
        leftover,
        (event) => {
          const converted = convertStreamingEvent(event, state);
          if (!converted) return;
          transformed.push(`data: ${JSON.stringify(converted)}\n\n`);
        },
        () => {
          transformed.push('data: [DONE]\n\n');
        },
        () => {
          // Ignore JSON parse errors for individual events
        },
      );
    } catch {
      // Swallow errors to keep parity with passthrough behaviour
    }
  });

  upstream.on('end', () => {
    if (leftover && leftover.trim()) {
      transformed.push(leftover);
    }
    transformed.push(null);
  });

  upstream.on('error', (err) => {
    transformed.destroy(err);
  });

  const headers = (() => {
    try {
      const h = new Headers(providerResponse.headers);
      h.set('content-type', 'text/event-stream');
      return h;
    } catch {
      return providerResponse.headers;
    }
  })();

  return {
    ok: providerResponse.ok,
    status: providerResponse.status,
    statusText: providerResponse.statusText,
    headers,
    url: providerResponse.url,
    redirected: providerResponse.redirected,
    type: providerResponse.type,
    body: transformed,
    clone() {
      throw new Error('Streaming response cannot be cloned');
    },
    async json() {
      throw new Error('Cannot call json() on streaming response');
    },
    async text() {
      const chunks = [];
      for await (const chunk of transformed) {
        chunks.push(Buffer.from(chunk));
      }
      return Buffer.concat(chunks).toString('utf8');
    },
    async arrayBuffer() {
      const text = await this.text();
      return Buffer.from(text, 'utf8');
    },
  };
}

export class ResponsesAPIAdapter extends BaseAdapter {
  constructor(options = {}) {
    super(options);
    this.supportsReasoningControls = options.supportsReasoningControls || ((_model) => false);
    this.getDefaultModel = options.getDefaultModel || (() => undefined);
  }

  translateRequest(internalRequest = {}, context = {}) {
    const payload = omitReservedKeys(internalRequest);

    // Extract previous_response_id for message optimization logic
    const responseId = internalRequest.previous_response_id;

    const resolveDefaultModel = context.getDefaultModel || this.getDefaultModel;
    const model = payload.model || resolveDefaultModel();
    if (!model) {
      throw new Error('OpenAI provider requires a model');
    }

    const messages = Array.isArray(payload.messages) ? payload.messages : [];
    const instructions = extractSystemInstructions(messages);

    // When previous_response_id is provided, only send the latest message for context efficiency
    let input;
    if (responseId && messages.length > 0) {
      // Find the last non-system message (should be the user's new message)
      const lastMessage = messages[messages.length - 1];
      if (lastMessage && lastMessage.role !== 'system') {
        input = normalizeMessagesToInput([lastMessage]);
      } else {
        // Fallback: find the last non-system message
        const nonSystemMessages = messages.filter(msg => msg.role !== 'system');
        input = nonSystemMessages.length > 0
          ? normalizeMessagesToInput([nonSystemMessages[nonSystemMessages.length - 1]])
          : normalizeMessagesToInput(messages);
      }
    } else {
      input = normalizeMessagesToInput(messages);
    }

    if (input.length === 0) {
      throw new Error('OpenAI provider requires at least one non-system message');
    }

    const translated = {
      model,
      input,
    };

    if (instructions) {
      translated.instructions = instructions;
    }

    if ('stream' in payload) {
      translated.stream = Boolean(payload.stream);
    }

    // Handle reasoning parameters specially
    const reasoning = {};
    if (payload.reasoning_effort !== undefined) {
      reasoning.effort = payload.reasoning_effort;
    }
    if (payload.reasoning_summary !== undefined) {
      reasoning.summary = payload.reasoning_summary;
    }

    // Auto-set reasoning_summary to 'auto' if reasoning is enabled but summary not explicitly set
    // if (payload.reasoning_effort !== undefined && payload.reasoning_summary === undefined) {
    //   reasoning.summary = 'auto';
    // }

    // Handle text parameters specially
    const text = {};
    if (payload.verbosity !== undefined) {
      text.verbosity = payload.verbosity;
    }

    for (const [key, value] of Object.entries(payload)) {
      if (value === undefined) continue;
      if (key === 'messages' || key === 'model' || key === 'stream') continue;
      if (key === 'reasoning_effort' || key === 'reasoning_summary' || key === 'verbosity') continue;
      if (RESPONSES_ALLOWED_REQUEST_KEYS.has(key)) {
        translated[key] = value;
      }
    }

    // Add reasoning object if it has any properties and model supports it
    if (Object.keys(reasoning).length > 0 && this.supportsReasoningControls(model)) {
      translated.reasoning = reasoning;
    }

    // Add text object if it has any properties and model supports reasoning controls
    if (Object.keys(text).length > 0 && this.supportsReasoningControls(model)) {
      translated.text = text;
    }

    context.__isStream = translated.stream === true;
    context.requestedModel = model;
    context.fallbackResponseId = payload.id;

    Object.defineProperty(translated, '__endpoint', {
      value: '/v1/responses',
      enumerable: false,
      configurable: false,
      writable: false,
    });

    return translated;
  }

  async translateResponse(providerResponse, context = {}) {
    if (!providerResponse) return providerResponse;

    if (context.__isStream) {
      return buildStreamingResponse(providerResponse, context);
    }

    if (!providerResponse.ok || typeof providerResponse.text !== 'function') {
      return providerResponse;
    }

    let raw;
    try {
      raw = await providerResponse.text();
    } catch {
      return providerResponse;
    }

    let parsed;
    try {
      parsed = raw ? JSON.parse(raw) : {};
    } catch {
      // If parsing fails, return original response text
      return new Response(raw, {
        status: providerResponse.status,
        statusText: providerResponse.statusText,
        headers: providerResponse.headers,
      });
    }

    const mapped = convertResponsesJson(parsed, context);
    const headers = (() => {
      try {
        const h = new Headers(providerResponse.headers);
        h.set('content-type', 'application/json');
        return h;
      } catch {
        return providerResponse.headers;
      }
    })();

    return new Response(JSON.stringify(mapped), {
      status: providerResponse.status,
      statusText: providerResponse.statusText,
      headers,
    });
  }

  translateStreamChunk(chunk, context = {}) {
    if (!chunk) return null;
    if (context.__isStream) {
      // Streaming translation happens in translateResponse; chunks are already normalized.
      return chunk;
    }
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
}
