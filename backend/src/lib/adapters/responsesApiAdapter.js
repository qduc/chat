import { PassThrough } from 'node:stream';
import { BaseAdapter } from './baseAdapter.js';
import { createChatCompletionChunk } from '../streamUtils.js';

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

function normalizeContentPart(part, role) {
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

	if (part.type === 'image_url') {
		const imageUrl = typeof part.image_url === 'string'
			? part.image_url
			: (part.image_url?.url || null);
		if (imageUrl) {
			return {
				type: role === 'assistant' ? 'output_image' : 'input_image',
				image_url: imageUrl,
			};
		}
		return null;
	}

	if (part.type === 'input_image' || part.type === 'output_image') {
		return { ...part };
	}

	if (typeof part.content === 'string') {
		return { type: textType, text: part.content };
	}

	return null;
}

function normalizeMessage(message) {
	if (!message || typeof message !== 'object') return null;
	const role = typeof message.role === 'string' ? message.role : null;
	if (!role || role === 'tool') return null;

	const normalized = { role };

	let contentParts = [];
	if (Array.isArray(message.content)) {
		contentParts = message.content
			.map((part) => normalizeContentPart(part, role))
			.filter(Boolean);
	} else {
		const normalizedPart = normalizeContentPart(message.content, role);
		if (normalizedPart) {
			contentParts = [normalizedPart];
		}
	}

	const hasAssistantToolCalls = role === 'assistant' && Array.isArray(message.tool_calls) && message.tool_calls.length > 0;

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

function normalizeMessages(messages) {
	if (!Array.isArray(messages)) return [];
	const normalized = [];
	for (const message of messages) {
		if (message?.role === 'tool') {
			const toolCallId = typeof message.tool_call_id === 'string' && message.tool_call_id
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

		const mapped = normalizeMessage(message);
		const hasAssistantToolCalls = message?.role === 'assistant' && Array.isArray(message.tool_calls) && message.tool_calls.length > 0;
		if (hasAssistantToolCalls) {
			const functionCalls = message.tool_calls
				.map((call, idx) => mapFunctionCallInput(call, idx))
				.filter(Boolean);
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
	const callId = call.id || call.call_id || call.tool_call_id || `call_${index}`;
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

	const id = call.id || call.call_id || call.tool_call_id || `call_${index}`;
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
	const mapped = flattened
		.map((call, idx) => mapToolCall(call, idx))
		.filter(Boolean);

	// Remove duplicates by id when multiple sources overlap
	const seen = new Map();
	for (const call of mapped) {
		if (!seen.has(call.id)) {
			seen.set(call.id, call);
		}
	}
		return Array.from(seen.values());
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

function mapUsage(usage) {
	if (!usage || typeof usage !== 'object') return undefined;

	const promptTokens = usage.prompt_tokens ?? usage.input_tokens ?? usage.input_token_count ?? usage.prompt_token_count;
	const completionTokens = usage.completion_tokens ?? usage.output_tokens ?? usage.output_token_count ?? usage.completion_token_count;
	const totalTokens = usage.total_tokens ?? usage.total_token_count ?? (promptTokens != null && completionTokens != null
		? promptTokens + completionTokens
		: undefined);
	const reasoningTokens = usage.reasoning_tokens ?? usage.reasoning_token_count;

	const mapped = {};
	if (promptTokens != null) mapped.prompt_tokens = promptTokens;
	if (completionTokens != null) mapped.completion_tokens = completionTokens;
	if (totalTokens != null) mapped.total_tokens = totalTokens;
	if (reasoningTokens != null) mapped.reasoning_tokens = reasoningTokens;

	return Object.keys(mapped).length > 0 ? mapped : undefined;
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
	const base = response?.response && typeof response.response === 'object'
		? response.response
		: response;

	const id = base?.id || response?.id || `resp_${Date.now()}`;
	const model = response?.model || base?.model;
	const created = base?.created ?? base?.created_at ?? response?.created ?? Math.floor(Date.now() / 1000);

	const toolCalls = mapToolCalls(response);
	const text = extractOutputText(response);
	const finishReason = inferFinishReason(response, toolCalls);

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

	const completion = {
		id,
		object: 'chat.completion',
		created,
		model,
		choices: [{
			index: 0,
			message,
			finish_reason: finishReason,
		}],
	};

	const usage = mapUsage(response?.usage || base?.usage);
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
	const upstream = response.body;
	const downstream = new PassThrough();

	const state = {
		id: null,
		model: defaultModel,
		roleSent: false,
		finishReason: null,
		usage: null,
		completed: false,
	};

	function ensureRoleChunk() {
		if (state.roleSent) return;
		const chunk = createChatCompletionChunk(state.id || `resp_${Date.now()}`, state.model || defaultModel || 'unknown', { role: 'assistant' });
		downstream.write(`data: ${JSON.stringify(chunk)}\n\n`);
		state.roleSent = true;
	}

	function sendContent(text) {
		if (!text) return;
		ensureRoleChunk();
		const chunk = createChatCompletionChunk(state.id || `resp_${Date.now()}`, state.model || defaultModel || 'unknown', { content: text });
		downstream.write(`data: ${JSON.stringify(chunk)}\n\n`);
	}

	function sendFinalChunk() {
		if (state.completed) return;
		state.completed = true;
		const chunk = createChatCompletionChunk(state.id || `resp_${Date.now()}`, state.model || defaultModel || 'unknown', {}, state.finishReason || 'stop');
		if (state.usage) chunk.usage = state.usage;
		downstream.write(`data: ${JSON.stringify(chunk)}\n\n`);
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

				if (payload.response && !state.id) {
					state.id = payload.response.id || state.id;
					state.model = payload.response.model || state.model;
				}

				if (typeof payload.model === 'string' && !state.model) {
					state.model = payload.model;
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
						if (typeof payload.text === 'string') {
							sendContent(payload.text);
						}
						break;
					case 'response.refusal.delta':
						if (typeof payload.delta === 'string') {
							sendContent(payload.delta);
						}
						break;
					case 'response.completed': {
						state.id = payload.response?.id || state.id;
						state.model = payload.response?.model || state.model;
						state.finishReason = inferFinishReason(payload.response, []);
						const usage = mapUsage(payload.response?.usage);
						if (usage) state.usage = usage;
						sendFinalChunk();
						downstream.write('data: [DONE]\n\n');
						downstream.end();
						upstream.destroy();
						break;
					}
					case 'response.failed':
						state.finishReason = 'error';
						sendFinalChunk();
						downstream.write('data: [DONE]\n\n');
						downstream.end();
						upstream.destroy();
						break;
					default:
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

	translateRequest(internalRequest = {}, context = {}) {
		const payload = omitReservedKeys(internalRequest);

		const resolveDefaultModel = context.getDefaultModel || this.getDefaultModel;
		const model = payload.model || (typeof resolveDefaultModel === 'function' ? resolveDefaultModel() : undefined);
		if (!model) {
			throw new Error('OpenAI Responses API requires a model');
		}

		const messages = Array.isArray(payload.messages) ? payload.messages : [];
		const input = normalizeMessages(messages);
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
			} else if (payload.tool_choice === 'none' || payload.tool_choice === 'required' || payload.tool_choice === 'auto') {
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
			if (payload[key] !== undefined) {
				request[key] = payload[key];
			}
		}

		const supportsReasoningControls = context.supportsReasoningControls || this.supportsReasoningControls;
		if (!supportsReasoningControls(model)) {
			delete request.reasoning_effort;
			delete request.verbosity;
		}

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

		const contentType = providerResponse.headers?.get?.('content-type') || providerResponse.headers?.get?.('Content-Type') || '';
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
