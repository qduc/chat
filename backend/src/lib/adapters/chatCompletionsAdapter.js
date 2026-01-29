import { BaseAdapter } from './baseAdapter.js';
import { convertContentPartImage } from '../localImageEncoder.js';

const OPENAI_ALLOWED_REQUEST_KEYS = new Set([
  'frequency_penalty',
  'image_config',
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
  'reasoning',
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
  'researchMode',
  'systemPrompt',
  'system_prompt',
  'previous_response_id',
]);

const CUSTOM_REQUEST_PARAMS_BLOCKLIST = new Set([
  'model',
  'messages',
  'stream',
  'tools',
  'tool_choice',
]);

function applyCustomRequestParams(target, customParams) {
  if (!customParams || typeof customParams !== 'object' || Array.isArray(customParams)) return;
  for (const [key, value] of Object.entries(customParams)) {
    if (CUSTOM_REQUEST_PARAMS_BLOCKLIST.has(key)) continue;
    target[key] = value;
  }
}

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

async function normalizeMessage(message) {
  if (!message || typeof message !== 'object') return null;
  const role = typeof message.role === 'string' ? message.role : undefined;
  if (!role) return null;

  const normalized = { role };
  if ('content' in message) {
    const content = message.content;
    if (Array.isArray(content)) {
      normalized.content = await Promise.all(content.map((part) => convertContentPartImage(part)));
    } else if (content === null || typeof content === 'object') {
      normalized.content = await convertContentPartImage(content);
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
    const normalizedCalls = message.tool_calls.map(normalizeToolCall).filter(Boolean);
    if (normalizedCalls.length > 0) {
      normalized.tool_calls = normalizedCalls;
      if (!('content' in normalized)) normalized.content = null;
    }
  }

  if (Array.isArray(message.reasoning_details) && message.reasoning_details.length > 0) {
    const cloneDetail = (detail) => {
      if (!detail || typeof detail !== 'object') return null;
      return { ...detail };
    };
    const normalizedReasoning = message.reasoning_details.map(cloneDetail).filter(Boolean);
    if (normalizedReasoning.length > 0) {
      normalized.reasoning_details = normalizedReasoning;
    }
  }

  if (message.function_call && typeof message.function_call === 'object') {
    const fn = message.function_call;
    const normalizedFn = {};
    if (typeof fn.name === 'string') normalizedFn.name = fn.name;
    if ('arguments' in fn) {
      normalizedFn.arguments = typeof fn.arguments === 'string' ? fn.arguments : JSON.stringify(fn.arguments ?? {});
    }
    if (Object.keys(normalizedFn).length > 0) {
      normalized.function_call = normalizedFn;
    }
  }

  // Preserve cache_control for prompt caching support
  if (message.cache_control && typeof message.cache_control === 'object') {
    normalized.cache_control = message.cache_control;
  }

  return normalized;
}

async function normalizeMessages(messages) {
  if (!Array.isArray(messages)) return [];
  const normalized = await Promise.all(messages.map((message) => normalizeMessage(message)));
  return normalized.filter(Boolean);
}

function normalizeTools(tools) {
  if (!Array.isArray(tools)) return undefined;
  const normalized = tools.map(normalizeToolSpec).filter(Boolean);
  return normalized.length > 0 ? normalized : undefined;
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

export class ChatCompletionsAdapter extends BaseAdapter {
  /**
   * @param {object} options
   * @param {function} [options.supportsReasoningControls] - Function to check if model supports reasoning
   * @param {function} [options.getDefaultModel] - Function to get default model
   * @param {'nested'|'flat'|'none'} [options.reasoningFormat='nested'] - Format for reasoning controls:
   *   - 'nested': Use `reasoning: { effort: value }` (OpenAI o1/o3 style)
   *   - 'flat': Use `reasoning_effort: value` as top-level field
   *   - 'none': Don't include reasoning fields (for providers that don't support it)
   */
  constructor(options = {}) {
    super(options);
    this.supportsReasoningControls = options.supportsReasoningControls || ((_model) => false);
    this.getDefaultModel = options.getDefaultModel || (() => undefined);
    this.reasoningFormat = options.reasoningFormat || 'nested';
  }

  async translateRequest(internalRequest = {}, context = {}) {
    const payload = omitReservedKeys(internalRequest);

    const resolveDefaultModel = context.getDefaultModel || this.getDefaultModel;
    const model = payload.model || resolveDefaultModel();
    if (!model) {
      throw new Error('OpenAI provider requires a model');
    }

    const normalized = {
      model,
      messages: await normalizeMessages(payload.messages),
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
      if (key === 'messages' || key === 'model' || key === 'tools' || key === 'tool_choice' || key === 'stream')
        continue;
      if (key === 'reasoning_effort') continue; // handled separately below
      if (key === 'reasoning') continue; // handled separately below
      if (OPENAI_ALLOWED_REQUEST_KEYS.has(key)) {
        normalized[key] = value;
      }
    }

    // Handle reasoning_effort based on configured format
    // Accept either reasoning_effort (flat) or reasoning.effort (nested) from input
    const reasoningEffort = payload.reasoning_effort ?? payload.reasoning?.effort;
    if (reasoningEffort !== undefined) {
      const format = context.reasoningFormat || this.reasoningFormat;
      if (format === 'nested') {
        // OpenAI o1/o3 style: reasoning: { effort: value }
        normalized.reasoning = { effort: reasoningEffort };
      } else if (format === 'flat') {
        // Some providers expect top-level reasoning_effort
        normalized.reasoning_effort = reasoningEffort;
      }
      // format === 'none': Don't include reasoning fields
    }

    applyCustomRequestParams(normalized, payload.custom_request_params);

    return normalized;
  }

  translateResponse(providerResponse, _context = {}) {
    if (typeof providerResponse === 'string') {
      try {
        return JSON.parse(providerResponse);
      } catch {
        return providerResponse;
      }
    }
    return providerResponse;
  }

  translateStreamChunk(chunk, _context = {}) {
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
}
