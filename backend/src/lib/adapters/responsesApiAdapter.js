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
  'parallel_tool_calls',
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

function normalizeToolSpec(tool) {
  if (!tool) return null;
  if (typeof tool === 'string') {
    return {
      type: 'function',
      name: tool,
      description: '',
      parameters: { type: 'object', properties: {} },
    };
  }
  if (typeof tool !== 'object') return null;

  const type = tool.type || 'function';
  if (type !== 'function') {
    return { ...tool, type };
  }

  const fn = typeof tool.function === 'object' ? tool.function : {};
  const name = typeof tool.name === 'string' && tool.name
    ? tool.name
    : fn.name;
  if (!name) {
    return null;
  }

  const spec = {
    type,
    name,
  };

  const description = tool.description ?? fn.description;
  if (description !== undefined) {
    spec.description = description;
  }

  const parameters = tool.parameters ?? fn.parameters;
  spec.parameters = parameters || { type: 'object', properties: {} };

  const strict = tool.strict ?? fn.strict;
  if (strict !== undefined) {
    spec.strict = strict;
  }

  if (tool.metadata !== undefined) {
    spec.metadata = tool.metadata;
  } else if (fn.metadata !== undefined) {
    spec.metadata = fn.metadata;
  }

  return spec;
}

function normalizeTools(tools) {
  if (!Array.isArray(tools)) return undefined;
  const normalized = tools
    .map(normalizeToolSpec)
    .filter(Boolean);
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeToolChoice(choice) {
  if (choice === undefined || choice === null) return undefined;
  if (choice === 'auto' || choice === 'none') return choice;
  if (typeof choice !== 'object') return choice;

  const type = choice.type || 'function';
  if (type !== 'function') {
    return { ...choice, type };
  }

  const fn = typeof choice.function === 'object' ? choice.function : {};
  const name = typeof choice.name === 'string' && choice.name
    ? choice.name
    : fn.name;
  if (!name) {
    return choice;
  }

  const normalized = { type, name };
  if (choice.strict !== undefined) {
    normalized.strict = choice.strict;
  } else if (fn.strict !== undefined) {
    normalized.strict = fn.strict;
  }

  return normalized;
}

function resolveToolOutput(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => resolveToolOutput(item));
  }
  if (typeof value === 'object') {
    return value;
  }
  return String(value);
}

function toResponsesContent(message = {}) {
  const role = typeof message.role === 'string' ? message.role : 'user';
  const content = message?.content;

  if (role === 'tool') {
    const template = {};
    if (typeof message.tool_call_id === 'string' && message.tool_call_id) {
      template.tool_call_id = message.tool_call_id;
    }
    if (typeof message.name === 'string' && message.name) {
      template.name = message.name;
    }

    const ensureToolItem = (value) => {
      if (value === null || value === undefined) return null;
      if (typeof value === 'object') {
        if (value.type === 'tool_result') {
          const merged = { ...value };
          if (template.tool_call_id && !merged.tool_call_id) {
            merged.tool_call_id = template.tool_call_id;
          }
          if (template.name && !merged.name) {
            merged.name = template.name;
          }
          if (merged.output === undefined) {
            if (merged.text !== undefined) {
              merged.output = resolveToolOutput(merged.text);
              delete merged.text;
            } else if (merged.content !== undefined) {
              merged.output = resolveToolOutput(merged.content);
              delete merged.content;
            } else {
              const fallbackSource = value?.text ?? value?.content ?? value;
              merged.output = resolveToolOutput(fallbackSource);
            }
          }
          merged.type = 'tool_result';
          return merged;
        }

        const item = { type: 'tool_result', ...template };
        if (value.output !== undefined) {
          item.output = resolveToolOutput(value.output);
          if (value.is_error !== undefined) {
            item.is_error = Boolean(value.is_error);
          }
          return item;
        }

        if (value.text !== undefined) {
          item.output = resolveToolOutput(value.text);
          return item;
        }

        if (value.content !== undefined) {
          item.output = resolveToolOutput(value.content);
          return item;
        }
      }

      return { type: 'tool_result', ...template, output: resolveToolOutput(value) };
    };

    const items = Array.isArray(content)
      ? content.map((part) => ensureToolItem(part)).filter(Boolean)
      : [ensureToolItem(content)].filter(Boolean);

    return items.length > 0
      ? items
      : [{ type: 'tool_result', ...template, output: '' }];
  }

  if (role === 'assistant' && Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
    return message.tool_calls.map((toolCall) => {
      const fn = toolCall?.function || {};
      let args = fn.arguments;
      if (args !== undefined && typeof args !== 'string') {
        try {
          args = JSON.stringify(args);
        } catch {
          args = '{}';
        }
      }
      return {
        type: 'tool_call',
        id: toolCall?.id,
        function: {
          name: fn.name,
          arguments: args ?? '{}',
        },
      };
    });
  }

  const type = role === 'user'
    ? 'input_text'
    : role === 'assistant'
      ? 'output_text'
      : 'output_text';

  const ensureItem = (value) => {
    if (value === null || value === undefined) {
      return null;
    }
    if (typeof value === 'string') {
      return { type, text: value };
    }
    if (typeof value === 'object') {
      if (typeof value.type === 'string') {
        if (value.text !== undefined) {
          return {
            ...value,
            text: typeof value.text === 'string' ? value.text : asString(value.text),
          };
        }
        if (value.content !== undefined) {
          return {
            ...value,
            text: asString(value.content),
          };
        }
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

  const items = Array.isArray(content)
    ? content.map((part) => ensureItem(part)).filter(Boolean)
    : [ensureItem(content)].filter(Boolean);

  return items.length > 0 ? items : [{ type, text: '' }];
}

function normalizeMessagesToInput(messages = []) {
  if (!Array.isArray(messages)) return [];
  const input = [];
  for (const message of messages) {
    if (!message || typeof message !== 'object') continue;
    if (message.role === 'system') continue;
    const role = typeof message.role === 'string' ? message.role : 'user';
    const content = toResponsesContent(message);
    const normalized = { role, content };

    if (role === 'tool' && typeof message.tool_call_id === 'string' && message.tool_call_id) {
      normalized.tool_call_id = message.tool_call_id;
    }

    if (typeof message.name === 'string' && message.name) {
      normalized.name = message.name;
    }

    input.push(normalized);
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

function toJSONString(value) {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

function normalizeToolCallFromOutput(node) {
  if (!node || typeof node !== 'object') return null;

  const source = node.tool_call && typeof node.tool_call === 'object'
    ? node.tool_call
    : node;

  const fn = typeof source.function === 'object' ? source.function : {};
  const id = source.id || source.tool_call_id || source.call_id;
  const name = fn.name || source.name;
  const argsValue = fn.arguments !== undefined ? fn.arguments : source.arguments;
  const args = toJSONString(argsValue);

  if (!name && args === undefined) {
    return null;
  }

  const normalized = {
    id: id || `tool_${Math.random().toString(36).slice(2, 10)}`,
    type: 'function',
    function: {},
  };

  if (name) normalized.function.name = name;
  if (args !== undefined) normalized.function.arguments = args;
  if (fn.metadata) normalized.function.metadata = fn.metadata;
  if (source.index !== undefined) normalized.index = source.index;

  if (Object.keys(normalized.function).length === 0) {
    delete normalized.function;
    return null;
  }

  state.toolCalls.delete(toolCallId);

  return normalized;
}

function extractToolCallsFromOutput(output) {
  if (!output) return [];

  const collected = [];
  const seen = new Set();

  const visit = (node) => {
    if (!node) return;
    if (Array.isArray(node)) {
      for (const item of node) {
        visit(item);
      }
      return;
    }
    if (typeof node !== 'object') return;

    if (node.type === 'tool_call' || node.tool_call || node.function) {
      const normalized = normalizeToolCallFromOutput(node);
      if (normalized && !seen.has(normalized.id)) {
        seen.add(normalized.id);
        collected.push(normalized);
      }
    }

    if (Array.isArray(node.tool_calls)) {
      for (const call of node.tool_calls) {
        const normalized = normalizeToolCallFromOutput(call);
        if (normalized && !seen.has(normalized.id)) {
          seen.add(normalized.id);
          collected.push(normalized);
        }
      }
    }

    if (Array.isArray(node.content)) {
      for (const contentItem of node.content) {
        visit(contentItem);
      }
    }

    if (Array.isArray(node.items)) {
      for (const item of node.items) {
        visit(item);
      }
    }

    if (node.output) {
      visit(node.output);
    }

    if (Array.isArray(node.outputs)) {
      for (const item of node.outputs) {
        visit(item);
      }
    }
  };

  visit(output);

  return collected;
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
  const statusLower = typeof status === 'string' ? status.toLowerCase() : undefined;

  const outputSource = response.output ?? json.output ?? response.output_text ?? json.output_text;
  const assistantContent = collectTextFromOutput(outputSource);
  const toolCalls = extractToolCallsFromOutput(outputSource);

  let finishReason;
  if (statusLower === 'completed' || statusLower === 'succeeded') {
    finishReason = 'stop';
  } else if (statusLower === 'in_progress') {
    finishReason = null;
  } else if (statusLower === 'requires_action') {
    finishReason = toolCalls.length > 0 ? 'tool_calls' : 'stop';
  } else if (!status && toolCalls.length > 0) {
    finishReason = 'tool_calls';
  } else {
    finishReason = status || 'stop';
  }

  // Extract reasoning summary if present
  const reasoningSummary = response.reasoning_summary ?? json.reasoning_summary;

  const assistantMessage = {
    role: 'assistant',
    content: assistantContent,
    ...(reasoningSummary && { reasoning_content: reasoningSummary }),
  };

  if (toolCalls.length > 0) {
    assistantMessage.tool_calls = toolCalls;
  }

  if (outputSource !== undefined) {
    assistantMessage.responses_output = outputSource;
  }

  const mapped = {
    id,
    object: 'chat.completion',
    created,
    model,
    choices: [{
      index: 0,
      message: assistantMessage,
      finish_reason: finishReason,
    }],
  };

  if (json.usage || response.usage) {
    mapped.usage = response.usage || json.usage;
  }

  if (status !== undefined) {
    mapped.status = status;
  }

  if (outputSource !== undefined) {
    mapped.responses_output = outputSource;
  }

  const errorInfo = response.error ?? json.error;
  if (errorInfo) {
    mapped.error = errorInfo;
    assistantMessage.error = errorInfo;
  }

  if (response.incomplete_details || json.incomplete_details) {
    mapped.incomplete_details = response.incomplete_details || json.incomplete_details;
  }

  if (response.reasoning) {
    mapped.reasoning = response.reasoning;
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

function ensureToolCallState(state, id) {
  if (!state.toolCalls) {
    state.toolCalls = new Map();
  }
  if (!state.toolCalls.has(id)) {
    state.toolCalls.set(id, {
      id,
      type: 'function',
      function: {
        arguments: '',
      },
    });
  }
  return state.toolCalls.get(id);
}

function appendToolCallDelta(event, state) {
  const payload = (event && typeof event === 'object' && (event.delta || event.tool_call)) || event;
  if (!payload || typeof payload !== 'object') return null;

  const toolCallId = payload.id
    || payload.tool_call_id
    || payload.call_id
    || event.tool_call_id
    || event.call_id;

  if (!toolCallId) return null;

  const entry = ensureToolCallState(state, toolCallId);

  const fn = typeof payload.function === 'object' ? payload.function : {};
  if (fn.name) {
    entry.function.name = fn.name;
  } else if (payload.name && !entry.function.name) {
    entry.function.name = payload.name;
  }

  if (payload.type) {
    entry.type = payload.type;
  }

  if (fn.metadata) {
    entry.function.metadata = { ...(entry.function.metadata || {}), ...fn.metadata };
  }

  const argsValue = fn.arguments !== undefined ? fn.arguments : payload.arguments;
  let argsDelta;
  if (argsValue !== undefined) {
    if (typeof argsValue === 'string') {
      argsDelta = argsValue;
    } else {
      argsDelta = toJSONString(argsValue) ?? '';
    }
    entry.function.arguments = (entry.function.arguments || '') + (argsDelta || '');
  }

  const chunkToolCall = {
    id: entry.id,
    type: entry.type || 'function',
    function: {},
  };

  if (entry.function.name) {
    chunkToolCall.function.name = entry.function.name;
  }
  if (argsDelta !== undefined) {
    chunkToolCall.function.arguments = argsDelta;
  }
  if (entry.function.metadata) {
    chunkToolCall.function.metadata = entry.function.metadata;
  }

  if (payload.index !== undefined) {
    chunkToolCall.index = payload.index;
  } else if (event.output_index !== undefined) {
    chunkToolCall.index = event.output_index;
  }

  if (Object.keys(chunkToolCall.function).length === 0) {
    delete chunkToolCall.function;
  }

  if (!chunkToolCall.function && argsDelta === undefined && !chunkToolCall.index) {
    return null;
  }

  return chunkToolCall;
}

function finalizeToolCall(event, state) {
  const payload = (event && typeof event === 'object' && (event.tool_call || event.delta)) || event;
  if (!payload || typeof payload !== 'object') return null;

  const toolCallId = payload.id
    || payload.tool_call_id
    || payload.call_id
    || event.tool_call_id
    || event.call_id;

  if (!toolCallId) return null;

  const entry = ensureToolCallState(state, toolCallId);

  const fn = typeof payload.function === 'object' ? payload.function : {};
  if (fn.name) {
    entry.function.name = fn.name;
  }

  if (fn.metadata) {
    entry.function.metadata = { ...(entry.function.metadata || {}), ...fn.metadata };
  }

  const argsValue = fn.arguments !== undefined ? fn.arguments : payload.arguments;
  if (argsValue !== undefined) {
    const args = typeof argsValue === 'string' ? argsValue : toJSONString(argsValue) ?? '';
    entry.function.arguments = args;
  }

  if (payload.type) {
    entry.type = payload.type;
  }

  const normalized = {
    id: entry.id,
    type: entry.type || 'function',
    function: {},
  };

  if (entry.function.name) {
    normalized.function.name = entry.function.name;
  }
  if (entry.function.arguments !== undefined) {
    normalized.function.arguments = entry.function.arguments;
  }
  if (entry.function.metadata) {
    normalized.function.metadata = entry.function.metadata;
  }

  if (payload.index !== undefined) {
    normalized.index = payload.index;
  } else if (event.output_index !== undefined) {
    normalized.index = event.output_index;
  }

  if (Object.keys(normalized.function).length === 0) {
    delete normalized.function;
    return null;
  }

  if (state.toolCalls && typeof state.toolCalls.delete === 'function') {
    state.toolCalls.delete(toolCallId);
  }

  return normalized;
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
    case 'response.output_text.done': {
      const hasActiveToolCalls = Boolean(state.toolCalls && state.toolCalls.size > 0);
      const shouldSignalStop = !hasActiveToolCalls && !state.sentFinalChunk;
      if (!hasActiveToolCalls && !state.sentFinalChunk) {
        state.sentFinalChunk = true;
      }
      return createChatCompletionChunk(
        ensureResponseId(state),
        ensureModel(state),
        { output_done: true },
        shouldSignalStop ? 'stop' : null,
      );
    }
    case 'response.tool_call.delta':
    case 'response.tool_calls.delta':
    case 'response.function_call_arguments.delta': {
      const toolCallDelta = appendToolCallDelta(event, state);
      if (!toolCallDelta) return null;
      return createChatCompletionChunk(
        ensureResponseId(state),
        ensureModel(state),
        { tool_calls: [toolCallDelta] },
        null,
      );
    }
    case 'response.tool_call.done':
    case 'response.tool_calls.done': {
      const toolCall = finalizeToolCall(event, state);
      if (!toolCall) return null;
      return createChatCompletionChunk(
        ensureResponseId(state),
        ensureModel(state),
        { tool_calls: [toolCall] },
        'tool_calls',
      );
    }
    case 'response.completed': {
      const alreadySent = Boolean(state.sentFinalChunk);
      if (!alreadySent) {
        state.sentFinalChunk = true;
      }
      const chunk = createChatCompletionChunk(
        ensureResponseId(state),
        ensureModel(state),
        { completed: true },
        alreadySent ? null : 'stop',
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
      state.sentFinalChunk = true;
      const errorPayload = event.error || event;
      const chunk = createChatCompletionChunk(
        ensureResponseId(state),
        ensureModel(state),
        { error: errorPayload },
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
    toolCalls: new Map(),
    sentFinalChunk: false,
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

    const tools = normalizeTools(payload.tools);
    if (tools) {
      translated.tools = tools;
    }

    const toolChoice = normalizeToolChoice(payload.tool_choice);
    if (toolChoice !== undefined) {
      translated.tool_choice = toolChoice;
    }

    if (payload.parallel_tool_calls !== undefined) {
      translated.parallel_tool_calls = Boolean(payload.parallel_tool_calls);
    }

    for (const [key, value] of Object.entries(payload)) {
      if (value === undefined) continue;
      if (key === 'messages' || key === 'model' || key === 'stream' || key === 'tools' || key === 'tool_choice' || key === 'parallel_tool_calls') continue;
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
