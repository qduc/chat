import { PassThrough } from 'node:stream';
import { maybeConvertLocalImageUrl } from '../localImageEncoder.js';
import { BaseAdapter } from './baseAdapter.js';
import { createChatCompletionChunk } from '../streamUtils.js';
import { normalizeUsage } from '../utils/usage.js';

const RESPONSES_ENDPOINT = '/v1/responses';

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

const RESPONSES_PASSTHROUGH_KEYS = new Set([
	'frequency_penalty',
	'image_config',
	'logit_bias',
	'logprobs',
	'metadata',
	'modalities',
	'parallel_tool_calls',
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

const CUSTOM_REQUEST_PARAMS_BLOCKLIST = new Set([
  'model',
  'messages',
  'stream',
  'tools',
  'tool_choice',
  'input',
]);

function applyCustomRequestParams(target, customParams) {
  if (!customParams || typeof customParams !== 'object' || Array.isArray(customParams)) return;
  for (const [key, value] of Object.entries(customParams)) {
    if (CUSTOM_REQUEST_PARAMS_BLOCKLIST.has(key)) continue;
    target[key] = value;
  }
}

const DEFAULT_FUNCTION_PARAMETERS = { type: 'object', properties: {} };

function omitReservedKeys(payload) {
	if (!payload || typeof payload !== 'object') return {};
	const result = {};
	for (const [key, value] of Object.entries(payload)) {
		if (RESERVED_INTERNAL_KEYS.has(key)) continue;
		result[key] = value;
	}
	return result;
}

function defineEndpoint(target) {
	if (!target || typeof target !== 'object') return target;
	Object.defineProperty(target, '__endpoint', {
		value: RESPONSES_ENDPOINT,
		enumerable: false,
		configurable: true,
		writable: false,
	});
	return target;
}

function normalizeToolSpec(tool) {
	if (!tool) return null;

	if (typeof tool === 'string') {
		return {
			type: 'function',
			name: tool,
			parameters: DEFAULT_FUNCTION_PARAMETERS,
		};
	}

	if (typeof tool !== 'object') return null;

	const type = tool.type || (tool.function ? 'function' : undefined);
	if (!type) return null;

	if (type !== 'function') {
		return { ...tool, type };
	}

	const fn = tool.function && typeof tool.function === 'object' ? tool.function : tool;
	const name = typeof fn.name === 'string' ? fn.name : tool.name;
	if (!name) return null;

	const normalized = {
		type: 'function',
		name,
	};

	if (typeof fn.description === 'string') {
		normalized.description = fn.description;
	} else if (typeof tool.description === 'string') {
		normalized.description = tool.description;
	}

	if (fn.parameters && typeof fn.parameters === 'object') {
		normalized.parameters = fn.parameters;
	} else if (tool.parameters && typeof tool.parameters === 'object') {
		normalized.parameters = tool.parameters;
	} else {
		normalized.parameters = DEFAULT_FUNCTION_PARAMETERS;
	}

	return normalized;
}

function normalizeTools(tools) {
	if (!Array.isArray(tools)) return undefined;
	const normalized = tools
		.map(normalizeToolSpec)
		.filter(Boolean);
	return normalized.length > 0 ? normalized : undefined;
}

function mapToolChoice(toolChoice) {
	if (toolChoice == null) return undefined;
	if (toolChoice === 'auto' || toolChoice === 'none' || toolChoice === 'required') {
		return toolChoice;
	}

	if (typeof toolChoice === 'object') {
		const type = toolChoice.type || toolChoice?.function?.type;
		const name = toolChoice?.function?.name || toolChoice.name;
		if (type === 'function' && name) {
			return { type: 'function', name };
		}
	}

	return undefined;
}

function inferTextPartType(role) {
	if (role === 'assistant' || role === 'tool') return 'output_text';
	return 'input_text';
}

async function normalizeContentPart(part, role) {
  if (part == null) return null;

  const textType = inferTextPartType(role);

  if (typeof part === 'string' || typeof part === 'number' || typeof part === 'boolean') {
    const text = String(part);
    return text ? { type: textType, text } : null;
  }

  if (typeof part !== 'object') return null;

  if (typeof part.text === 'string') {
    return { type: textType, text: part.text };
  }

  if (part.type === 'text' && typeof part.text === 'string') {
    return { type: textType, text: part.text };
  }

  if (part.type === 'input_text' || part.type === 'output_text') {
    if (typeof part.text === 'string' && part.text.length > 0) {
      return part;
    }
    if (typeof part.value === 'string' && part.value.length > 0) {
      return { type: part.type, text: part.value };
    }
  }

  if (part.type === 'input_audio') {
    const payload =
      part.input_audio && typeof part.input_audio === 'object'
        ? part.input_audio
        : (part.inputAudio && typeof part.inputAudio === 'object' ? part.inputAudio : null);

    const data = typeof payload?.data === 'string' ? payload.data : '';
    const format = typeof payload?.format === 'string' ? payload.format : '';
    if (!data || !format) return null;

    // Keep OpenAI-compatible shape; providers that don't support it will error upstream.
    return {
      type: 'input_audio',
      input_audio: { data, format },
    };
  }

  if (part.type === 'image_url') {
    const imageUrlRaw = typeof part.image_url === 'string' ? part.image_url : part.image_url?.url || null;
    const imageUrl = imageUrlRaw ? await maybeConvertLocalImageUrl(imageUrlRaw) : null;
    if (imageUrl) {
      return {
        type: role === 'assistant' ? 'output_image' : 'input_image',
        image_url: imageUrl,
      };
    }
    return null;
  }

  if (part.type === 'input_image' || part.type === 'output_image') {
    if (part.image_url && typeof part.image_url === 'string') {
      const converted = await maybeConvertLocalImageUrl(part.image_url);
      if (converted !== part.image_url) {
        return { ...part, image_url: converted };
      }
    }
    return { ...part };
  }

  if (typeof part.content === 'string') {
    return { type: textType, text: part.content };
  }

  return null;
}

async function normalizeMessage(message) {
  if (!message || typeof message !== 'object') return null;
  const role = typeof message.role === 'string' ? message.role : null;
  if (!role || role === 'tool') return null;

  const normalized = { role };

  let contentParts = [];
  if (Array.isArray(message.content)) {
    contentParts = await Promise.all(message.content.map((part) => normalizeContentPart(part, role)));
  } else {
    const normalizedPart = await normalizeContentPart(message.content, role);
    if (normalizedPart) {
      contentParts = [normalizedPart];
    }
  }

  const hasAssistantToolCalls =
    role === 'assistant' && Array.isArray(message.tool_calls) && message.tool_calls.length > 0;

  if (contentParts.length > 0) {
    normalized.content = contentParts;
  } else if (hasAssistantToolCalls) {
    normalized.content = [];
  } else {
    return null;
  }

  return normalized;
}

function stringifyToolContent(message) {
  if (!message) return '';
  const collect = [];
  const rawParts = Array.isArray(message.content) ? message.content : [message.content];
  for (const raw of rawParts) {
    if (raw == null) continue;
    const normalized = normalizeContentPart(raw, 'tool');
    if (normalized && typeof normalized.text === 'string') {
      collect.push(normalized.text);
    } else if (typeof raw === 'string') {
      collect.push(raw);
    } else if (typeof raw?.text === 'string') {
      collect.push(raw.text);
    } else if (typeof raw?.content === 'string') {
      collect.push(raw.content);
    } else if (typeof raw === 'object') {
      try {
        collect.push(JSON.stringify(raw));
      } catch {
        continue;
      }
    }
  }
  return collect.join('');
}

async function normalizeMessages(messages) {
  if (!Array.isArray(messages)) return [];
  const normalized = [];
  for (const message of messages) {
    if (message?.role === 'tool') {
      const toolCallId =
        typeof message.tool_call_id === 'string' && message.tool_call_id
          ? message.tool_call_id
          : typeof message.id === 'string' && message.id
            ? message.id
            : null;
      if (!toolCallId) continue;
      const output = stringifyToolContent(message);
      normalized.push({
        type: 'function_call_output',
        call_id: toolCallId,
        output,
      });
      continue;
    }

    const mapped = await normalizeMessage(message);
    const hasAssistantToolCalls =
      message?.role === 'assistant' && Array.isArray(message.tool_calls) && message.tool_calls.length > 0;
    if (hasAssistantToolCalls) {
      const functionCalls = message.tool_calls.map((call, idx) => mapFunctionCallInput(call, idx)).filter(Boolean);
      normalized.push(...functionCalls);
      if (mapped && Array.isArray(mapped.content) && mapped.content.length > 0) {
        normalized.push(mapped);
      }
      continue;
    }

    if (mapped) {
      normalized.push(mapped);
    }
  }
  return normalized;
}

function stringifyArguments(args) {
  if (args == null) return '{}';
  if (typeof args === 'string') {
    return args;
  }
  try {
    return JSON.stringify(args);
  } catch {
    return '{}';
  }
}

function mapFunctionCallInput(call, index = 0) {
  if (!call || typeof call !== 'object') return null;
  const callId = call.call_id || call.tool_call_id || call.id || `call_${index}`;
  const name = call.name || call.function?.name;
  if (!callId || !name) return null;
  const args = call.function?.arguments ?? call.arguments ?? call.args ?? {};
  return {
    type: 'function_call',
    call_id: callId,
    name,
    arguments: stringifyArguments(args),
  };
}

function mapToolCall(call, index = 0) {
  if (!call || typeof call !== 'object') return null;

  const id = call.call_id || call.tool_call_id || call.id || `call_${index}`;
  const name = call.name || call.function?.name;
  const args = call.arguments ?? call.function?.arguments ?? call.args;

  if (!name) return null;

  return {
    id,
    type: 'function',
    function: {
      name,
      arguments: stringifyArguments(args),
    },
  };
}

function mapToolCalls(response) {
  if (!response || typeof response !== 'object') return [];
  const collections = [];

  if (Array.isArray(response.tool_calls)) {
    collections.push(response.tool_calls);
  }

  if (Array.isArray(response.output)) {
    for (const item of response.output) {
      if (Array.isArray(item?.tool_calls)) {
        collections.push(item.tool_calls);
      }
      if (item?.type === 'tool_call' || item?.type === 'function_call') {
        collections.push([item]);
      }
      if (Array.isArray(item?.content)) {
        collections.push(item.content.filter((part) => part?.type === 'tool_call' || part?.type === 'function_call'));
      }
    }
  }

  if (response.response && typeof response.response === 'object') {
    collections.push(mapToolCalls(response.response));
  }

  const flattened = collections.flat().filter(Boolean);
  const mapped = flattened.map((call, idx) => mapToolCall(call, idx)).filter(Boolean);

  // Remove duplicates by id when multiple sources overlap
  const seen = new Map();
  for (const call of mapped) {
    if (!seen.has(call.id)) {
      seen.set(call.id, call);
    }
  }
  return Array.from(seen.values());
}

function mapStreamingToolCall(call, index = 0) {
  if (!call || typeof call !== 'object') return null;
  const idx = typeof call.index === 'number' ? call.index : index;
  const id = call.call_id || call.tool_call_id || call.id || `call_${idx}`;
  const type = call.type === 'function_call' ? 'function' : call.type || 'function';
  const fn = call.function && typeof call.function === 'object' ? call.function : {};
  const name = fn.name || call.name;
  const argumentsDelta = fn.arguments_delta ?? call.arguments_delta;
  const argumentsValue = fn.arguments ?? call.arguments ?? call.args;

  if (!name) return null;

  let args = '';
  if (typeof argumentsDelta === 'string') {
    args = argumentsDelta;
  } else if (typeof argumentsValue === 'string') {
    args = argumentsValue;
  } else if (argumentsValue != null) {
    args = stringifyArguments(argumentsValue);
  }

  const toolCall = {
    index: idx,
    id,
    type,
    function: {
      name,
    },
  };

  if (args) {
    toolCall.function.arguments = args;
  }

  return toolCall;
}

function collectToolCallsFromPayload(payload) {
  if (!payload || typeof payload !== 'object') return [];
  const sources = [];

  const pushCalls = (calls) => {
    if (Array.isArray(calls)) {
      sources.push(...calls);
    }
  };

  // Handle Responses API streaming events
  if (payload.type === 'response.output_item.added' && payload.item?.type === 'function_call') {
    sources.push({
      type: 'function_call',
      id: payload.item.call_id,
      call_id: payload.item.call_id,
      name: payload.item.name,
      arguments: payload.item.arguments || '',
      index: payload.output_index ?? 0,
    });
  }

  if (payload.type === 'response.function_call_arguments.delta') {
    sources.push({
      type: 'function_call',
      call_id: payload.item_id,
      arguments_delta: payload.delta || '',
      index: payload.output_index ?? 0,
    });
  }

  if (payload.type === 'response.output_item.done' && payload.item?.type === 'function_call') {
    sources.push({
      type: 'function_call',
      id: payload.item.call_id,
      call_id: payload.item.call_id,
      name: payload.item.name,
      arguments: payload.item.arguments || '',
      index: payload.output_index ?? 0,
    });
  }

  // Handle Chat Completions API format
  pushCalls(payload.delta?.tool_calls);
  pushCalls(payload.tool_calls);
  pushCalls(payload.required_action?.submit_tool_outputs?.tool_calls);
  pushCalls(payload.response?.required_action?.submit_tool_outputs?.tool_calls);
  pushCalls(payload.response?.tool_calls);

  if (Array.isArray(payload.output)) {
    for (const item of payload.output) {
      pushCalls(item?.tool_calls);
      if (Array.isArray(item?.content)) {
        pushCalls(item.content.filter((part) => Array.isArray(part?.tool_calls)).flatMap((part) => part.tool_calls));
      }
    }
  }

  const mapped = [];
  const seen = new Map();
  for (let i = 0; i < sources.length; i += 1) {
    const candidate = mapStreamingToolCall(sources[i], i);
    if (!candidate) continue;
    const key = candidate.id || `${candidate.index}:${candidate.function?.name || ''}`;
    if (!seen.has(key)) {
      seen.set(key, candidate);
      mapped.push(candidate);
    } else {
      const existing = seen.get(key);
      if (candidate.function?.arguments) {
        existing.function.arguments = (existing.function.arguments || '') + candidate.function.arguments;
      }
    }
  }

  return mapped;
}

function extractOutputText(response) {
  if (!response || typeof response !== 'object') return '';

  if (typeof response.output_text === 'string') {
    return response.output_text;
  }

  if (Array.isArray(response.output_text)) {
    return response.output_text.join('');
  }

  const collect = (obj) => {
    let text = '';
    if (!obj || typeof obj !== 'object') return text;

    if (Array.isArray(obj)) {
      for (const item of obj) {
        text += collect(item);
      }
      return text;
    }

    if (typeof obj.text === 'string') {
      return obj.text;
    }

    if (Array.isArray(obj.content)) {
      for (const part of obj.content) {
        text += collect(part);
      }
    }

    if (typeof obj.output_text === 'string') {
      text += obj.output_text;
    }

    return text;
  };

  let text = '';
  if (Array.isArray(response.output)) {
    text += collect(response.output);
  }

  if (!text && response.response) {
    text += extractOutputText(response.response);
  }

  return text;
}

function extractReasoningDetails(response) {
  const collected = [];
  const seen = new Set();
  const visited = new WeakSet();

  const collectArray = (arr) => {
    for (const detail of arr) {
      if (detail == null) continue;
      let key = null;
      try {
        key = JSON.stringify(detail);
      } catch {
        key = null;
      }
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);
      collected.push(detail);
    }
  };

  const visit = (node, depth = 0) => {
    if (!node || depth > 6) return;
    if (typeof node !== 'object') return;

    if (visited.has(node)) return;
    visited.add(node);

    if (Array.isArray(node)) {
      for (const item of node) {
        visit(item, depth);
      }
      return;
    }

    if (Array.isArray(node.reasoning_details)) {
      collectArray(node.reasoning_details);
    }

    if (node.reasoning && Array.isArray(node.reasoning.details)) {
      collectArray(node.reasoning.details);
    }

    if (node.type === 'reasoning' && Array.isArray(node.details)) {
      collectArray(node.details);
    }

    const values = Object.values(node);
    for (const value of values) {
      if (value && typeof value === 'object') {
        visit(value, depth + 1);
      }
    }
  };

  visit(response);

  return collected.length > 0 ? collected : null;
}

function extractReasoningText(source) {
  let text = '';
  const visited = new WeakSet();

  const visit = (node) => {
    if (!node || typeof node === 'number' || typeof node === 'boolean') return;
    if (typeof node === 'string') {
      text += node;
      return;
    }
    if (typeof node !== 'object') return;
    if (visited.has(node)) return;
    visited.add(node);

    if (Array.isArray(node)) {
      for (const item of node) {
        visit(item);
      }
      return;
    }

    if (typeof node.text === 'string') {
      text += node.text;
    }
    if (typeof node.reasoning_content === 'string') {
      text += node.reasoning_content;
    }
    if (typeof node.value === 'string') {
      text += node.value;
    }
    if (typeof node.output_text === 'string') {
      text += node.output_text;
    }

    if (Array.isArray(node.content)) {
      for (const item of node.content) {
        visit(item);
      }
    }

    if (Array.isArray(node.parts)) {
      for (const item of node.parts) {
        visit(item);
      }
    }

    if (Array.isArray(node.details)) {
      for (const item of node.details) {
        visit(item);
      }
    }

    const values = Object.values(node);
    for (const value of values) {
      if (value && typeof value === 'object') {
        visit(value);
      }
    }
  };

  visit(source);

  return text;
}

function inferFinishReason(response, toolCalls) {
  const status = response?.status || response?.response?.status;

  if (toolCalls && toolCalls.length > 0) {
    return 'tool_calls';
  }

  if (status === 'incomplete') {
    const reason = response?.incomplete_details?.reason || response?.response?.incomplete_details?.reason;
    if (reason === 'max_output_tokens') return 'length';
    if (reason === 'content_filter') return 'content_filter';
    return 'stop';
  }

  if (status === 'failed') return 'error';
  if (status === 'cancelled' || status === 'canceled') return 'cancelled';

  return 'stop';
}

function toChatCompletionResponse(response) {
  const base = response?.response && typeof response.response === 'object' ? response.response : response;

  const id = base?.id || response?.id || `resp_${Date.now()}`;
  const model = response?.model || base?.model;
  const created = base?.created ?? base?.created_at ?? response?.created ?? Math.floor(Date.now() / 1000);

  const toolCalls = mapToolCalls(response);
  const text = extractOutputText(response);
  const finishReason = inferFinishReason(response, toolCalls);
  const reasoningDetails = extractReasoningDetails(response);

  const message = {
    role: 'assistant',
    content: text ?? '',
  };

  if (toolCalls.length > 0) {
    message.tool_calls = toolCalls;
    if (!message.content) {
      message.content = '';
    }
  }

  if (Array.isArray(reasoningDetails) && reasoningDetails.length > 0) {
    message.reasoning_details = reasoningDetails;
  }

  const completion = {
    id,
    object: 'chat.completion',
    created,
    model,
    choices: [
      {
        index: 0,
        message,
        finish_reason: finishReason,
      },
    ],
  };

  const usage = normalizeUsage(response?.usage || base?.usage);
  if (usage) {
    completion.usage = usage;
  }

  if (typeof response?.system_fingerprint === 'string') {
    completion.system_fingerprint = response.system_fingerprint;
  }

  return completion;
}

function defaultModelFromContext(context) {
  if (context?.model) return context.model;
  if (typeof context?.getDefaultModel === 'function') {
    try {
      return context.getDefaultModel();
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function transformStreamingResponse(response, context = {}) {
  if (!response || typeof response !== 'object' || !response.body || typeof response.body.on !== 'function') {
    return response;
  }

  const defaultModel = defaultModelFromContext(context);
  const persistence = context?.persistence;
  const upstream = response.body;
  const downstream = new PassThrough();

  const state = {
    id: null,
    model: defaultModel,
    roleSent: false,
    finishReason: null,
    usage: null,
    completed: false,
    toolCallsMap: new Map(), // Accumulate tool calls by index
    reasoningDetails: [],
    reasoningSeen: new Set(),
    reasoningTokens: null,
  };

  function ensureRoleChunk() {
    if (state.roleSent) return;
    const chunk = createChatCompletionChunk(
      state.id || `resp_${Date.now()}`,
      state.model || defaultModel || 'unknown',
      { role: 'assistant' }
    );
    downstream.write(`data: ${JSON.stringify(chunk)}\n\n`);
    state.roleSent = true;
  }

  function sendContent(text) {
    if (!text) return;
    ensureRoleChunk();
    const chunk = createChatCompletionChunk(
      state.id || `resp_${Date.now()}`,
      state.model || defaultModel || 'unknown',
      { content: text }
    );
    downstream.write(`data: ${JSON.stringify(chunk)}\n\n`);
    if (persistence?.persist) {
      persistence.appendContent(text);
    }
  }

  function sendFinalChunk() {
    if (state.completed) return;
    state.completed = true;
    const delta = {};
    if (state.reasoningDetails.length > 0) {
      delta.reasoning_details = state.reasoningDetails;
    }
    const chunk = createChatCompletionChunk(
      state.id || `resp_${Date.now()}`,
      state.model || defaultModel || 'unknown',
      delta,
      state.finishReason || 'stop'
    );
    if (state.usage) chunk.usage = state.usage;
    if (persistence?.persist) {
      persistence.setReasoningDetails(state.reasoningDetails);
      if (state.reasoningTokens != null) {
        persistence.setReasoningTokens(state.reasoningTokens);
      }
    }
    downstream.write(`data: ${JSON.stringify(chunk)}\n\n`);
  }

  function addReasoningDetails(details) {
    if (!Array.isArray(details) || details.length === 0) return;
    let updated = false;
    for (const detail of details) {
      if (detail == null) continue;
      let key = null;
      try {
        key = JSON.stringify(detail);
      } catch {
        key = null;
      }
      if (key && state.reasoningSeen.has(key)) continue;
      if (key) state.reasoningSeen.add(key);
      state.reasoningDetails.push(detail);
      updated = true;
    }

    if (updated && persistence?.persist) {
      persistence.setReasoningDetails(state.reasoningDetails);
    }
  }

  function handleReasoningDelta(deltaSource) {
    if (!deltaSource) return;
    const text = extractReasoningText(deltaSource);
    if (text) {
      ensureRoleChunk();
      const chunk = createChatCompletionChunk(
        state.id || `resp_${Date.now()}`,
        state.model || defaultModel || 'unknown',
        { reasoning: text, reasoning_content: text }
      );
      downstream.write(`data: ${JSON.stringify(chunk)}\n\n`);
      if (persistence?.persist) {
        persistence.appendReasoningText(text);
      }
    }

    const details = extractReasoningDetails(deltaSource);
    if (details) {
      addReasoningDetails(details);
    }
  }

  let buffer = '';

  upstream.on('data', (chunk) => {
    buffer += chunk.toString();
    const parts = buffer.split(/\n\n/);
    buffer = parts.pop() || '';

    for (const part of parts) {
      if (!part) continue;
      const dataLines = part
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.replace(/^data:\s*/, ''));

      if (dataLines.length === 0) continue;

      for (const dataLine of dataLines) {
        if (dataLine === '[DONE]') {
          sendFinalChunk();
          downstream.write('data: [DONE]\n\n');
          downstream.end();
          upstream.destroy();
          return;
        }

        let payload;
        try {
          payload = JSON.parse(dataLine);
        } catch {
          continue;
        }

        if (!payload || typeof payload !== 'object') continue;

        const responseData = payload.response && typeof payload.response === 'object' ? payload.response : null;
        if (responseData) {
          if (responseData.id) state.id = responseData.id;
          if (responseData.model) state.model = responseData.model;
        }

        if (typeof payload.id === 'string') {
          state.id = payload.id;
        }

        if (typeof payload.model === 'string') {
          state.model = payload.model;
        }

        const toolCallDeltas = collectToolCallsFromPayload(payload);
        if (toolCallDeltas.length > 0) {
          state.finishReason = 'tool_calls';
          ensureRoleChunk();

          // Accumulate tool calls and emit deltas
          const deltaChunks = [];
          for (const delta of toolCallDeltas) {
            const idx = delta.index ?? 0;
            const existing = state.toolCallsMap.get(idx) || {
              index: idx,
              id: delta.id || `call_${idx}`,
              type: delta.type || 'function',
              function: { name: '', arguments: '' },
            };

            // Track what changed for the delta
            // IMPORTANT: Use delta.id if available, otherwise fall back to existing.id
            const deltaToEmit = { index: idx, id: delta.id || existing.id, type: existing.type, function: {} };
            let hasChanges = false;

            // Update ID if new
            if (delta.id && delta.id !== existing.id) {
              existing.id = delta.id;
              deltaToEmit.id = delta.id;
              hasChanges = true;
            }

            // Update function name if new
            if (delta.function?.name && delta.function.name !== existing.function.name) {
              existing.function.name = delta.function.name;
              deltaToEmit.function.name = delta.function.name;
              hasChanges = true;
            }

            // Append arguments delta
            if (delta.function?.arguments) {
              existing.function.arguments += delta.function.arguments;
              deltaToEmit.function.arguments = delta.function.arguments;
              hasChanges = true;
            }

            state.toolCallsMap.set(idx, existing);

            if (hasChanges) {
              deltaChunks.push(deltaToEmit);
            }
          }

          // Emit accumulated deltas
          if (deltaChunks.length > 0) {
            const chunk = createChatCompletionChunk(
              state.id || `resp_${Date.now()}`,
              state.model || defaultModel || 'unknown',
              { tool_calls: deltaChunks }
            );
            downstream.write(`data: ${JSON.stringify(chunk)}\n\n`);
          }
        }

        switch (payload.type) {
          case 'response.created':
          case 'response.in_progress':
            state.id = payload.response?.id || state.id;
            state.model = payload.response?.model || state.model;
            break;
          case 'response.output_text.delta':
            if (typeof payload.delta === 'string') {
              sendContent(payload.delta);
            }
            break;
          case 'response.output_text.done':
            // Skip - we already streamed all the deltas
            break;
          case 'response.refusal.delta':
            if (typeof payload.delta === 'string') {
              sendContent(payload.delta);
            }
            break;
          case 'response.reasoning.delta':
            handleReasoningDelta(payload.delta ?? payload);
            break;
          case 'response.reasoning.done':
            if (payload.reasoning) {
              handleReasoningDelta(payload.reasoning);
            }
            break;
          case 'response.completed': {
            state.id = payload.response?.id || state.id;
            state.model = payload.response?.model || state.model;
            state.finishReason = inferFinishReason(payload.response, []);
            const usage = normalizeUsage(payload.response?.usage);
            if (usage) state.usage = usage;
            if (payload.response?.reasoning) {
              handleReasoningDelta(payload.response.reasoning);
            }
            if (state.usage?.reasoning_tokens != null) {
              state.reasoningTokens = state.usage.reasoning_tokens;
            }
            sendFinalChunk();
            downstream.write('data: [DONE]\n\n');
            downstream.end();
            upstream.destroy();
            break;
          }
          case 'response.required_action':
            state.finishReason = 'tool_calls';
            break;
          case 'response.failed':
            state.finishReason = 'error';
            sendFinalChunk();
            downstream.write('data: [DONE]\n\n');
            downstream.end();
            upstream.destroy();
            break;
          default:
            if (payload.delta && payload.type && payload.type.includes('reasoning')) {
              handleReasoningDelta(payload.delta);
            }
            break;
        }
      }
    }
  });

  upstream.on('end', () => {
    sendFinalChunk();
    downstream.write('data: [DONE]\n\n');
    downstream.end();
  });

  upstream.on('error', (err) => {
    downstream.destroy(err);
  });

  return new Proxy(response, {
    get(target, prop, receiver) {
      if (prop === 'body') {
        return downstream;
      }
      if (prop === 'clone' && typeof target.clone === 'function') {
        return () => transformStreamingResponse(target.clone(), context);
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

function wrapJsonResponse(response) {
  if (!response || typeof response !== 'object' || typeof response.json !== 'function') {
    return response;
  }

  return new Proxy(response, {
    get(target, prop, receiver) {
      if (prop === 'json') {
        return async () => {
          const payload = await target.json();
          if (target.ok) {
            return toChatCompletionResponse(payload);
          }
          return payload;
        };
      }
      if (prop === 'clone' && typeof target.clone === 'function') {
        return () => wrapJsonResponse(target.clone());
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

export class ResponsesAPIAdapter extends BaseAdapter {
  constructor(options = {}) {
    super(options);
    this.supportsReasoningControls = options.supportsReasoningControls || (() => false);
    this.getDefaultModel = options.getDefaultModel || (() => undefined);
  }

  async translateRequest(internalRequest = {}, context = {}) {
    const payload = omitReservedKeys(internalRequest);

    const resolveDefaultModel = context.getDefaultModel || this.getDefaultModel;
    const model = payload.model || (typeof resolveDefaultModel === 'function' ? resolveDefaultModel() : undefined);
    if (!model) {
      throw new Error('OpenAI Responses API requires a model');
    }

    const messages = Array.isArray(payload.messages) ? payload.messages : [];

    // When using previous_response_id, only send new messages since the previous response
    // The API already has the conversation context from the previous response
    let input;
    if (payload.previous_response_id) {
      // Find the last assistant message (which would have tool_calls in a tool orchestration scenario)
      const lastAssistantIndex = messages.findLastIndex((msg) => msg?.role === 'assistant');

      if (lastAssistantIndex >= 0) {
        // Send all messages AFTER the last assistant message (tool outputs or new user message)
        const newMessages = messages.slice(lastAssistantIndex + 1);
        input = await normalizeMessages(newMessages);
      } else {
        // No assistant message found, send the last user message
        const lastUserMessage = messages.findLast((msg) => msg?.role === 'user');
        input = lastUserMessage ? await normalizeMessages([lastUserMessage]) : [];
      }
    } else {
      // Normal flow: send all messages including system prompt
      input = await normalizeMessages(messages);
    }

    if (input.length === 0 && typeof payload.input === 'string') {
      input.push({ role: 'user', content: [{ type: 'input_text', text: payload.input }] });
    }

    if (input.length === 0) {
      throw new Error('OpenAI Responses API requires at least one message');
    }

    const request = {
      model,
      input,
    };

    if (payload.previous_response_id) {
      request.previous_response_id = payload.previous_response_id;
    }

    if (payload.stream === true) {
      request.stream = true;
    }

    const tools = normalizeTools(payload.tools);
    if (tools) {
      request.tools = tools;
      const mappedChoice = mapToolChoice(payload.tool_choice);
      if (mappedChoice) {
        request.tool_choice = mappedChoice;
      } else if (
        payload.tool_choice === 'none' ||
        payload.tool_choice === 'required' ||
        payload.tool_choice === 'auto'
      ) {
        request.tool_choice = payload.tool_choice;
      }
    }

    if (payload.max_output_tokens != null) {
      request.max_output_tokens = payload.max_output_tokens;
    } else if (payload.max_completion_tokens != null) {
      request.max_output_tokens = payload.max_completion_tokens;
    } else if (payload.max_tokens != null) {
      request.max_output_tokens = payload.max_tokens;
    }

    for (const key of RESPONSES_PASSTHROUGH_KEYS) {
      if (key === 'tool_choice') continue; // handled separately
      if (key === 'reasoning_effort') continue; // handled separately below
      if (key === 'verbosity') continue; // handled separately below
      if (payload[key] !== undefined) {
        request[key] = payload[key];
      }
    }

    if (payload.reasoning_effort !== undefined) {
      request.reasoning = {
        effort: payload.reasoning_effort,
        summary: 'auto',
      };
    }
    if (payload.verbosity !== undefined) {
      request.text = { verbosity: payload.verbosity };
    }

    applyCustomRequestParams(request, payload.custom_request_params);

    return defineEndpoint(request);
  }

  translateResponse(providerResponse, context = {}) {
    if (typeof providerResponse === 'string') {
      try {
        return toChatCompletionResponse(JSON.parse(providerResponse));
      } catch {
        return providerResponse;
      }
    }

    if (!providerResponse || typeof providerResponse !== 'object') {
      return providerResponse;
    }

    const contentType =
      providerResponse.headers?.get?.('content-type') || providerResponse.headers?.get?.('Content-Type') || '';
    const isStream = typeof contentType === 'string' && contentType.includes('text/event-stream');

    if (isStream && providerResponse.ok) {
      return transformStreamingResponse(providerResponse, context);
    }

    if (typeof providerResponse.json === 'function') {
      return wrapJsonResponse(providerResponse);
    }

    return providerResponse;
  }

  translateStreamChunk(chunk, _context = {}) {
    if (!chunk) return null;
    if (typeof chunk === 'string') {
      const trimmed = chunk.trim();
      if (!trimmed) return null;
      if (trimmed === '[DONE]') return '[DONE]';
      try {
        return JSON.parse(trimmed);
      } catch {
        return null;
      }
    }
    return chunk;
  }
}
