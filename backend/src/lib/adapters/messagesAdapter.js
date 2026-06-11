import { BaseAdapter } from './baseAdapter.js';
import { normalizeUsage } from '../utils/usage.js';
import { convertContentPartImage } from '../localImageEncoder.js';

const ANTHROPIC_ALLOWED_REQUEST_KEYS = new Set([
  'max_tokens',
  'metadata',
  'stop_sequences',
  'stream',
  'temperature',
  'tool_choice',
  'top_k',
  'top_p',
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
  'max_tokens',
  'system',
]);

function applyCustomRequestParams(target, customParams) {
  if (!customParams || typeof customParams !== 'object' || Array.isArray(customParams)) return;
  for (const [key, value] of Object.entries(customParams)) {
    if (CUSTOM_REQUEST_PARAMS_BLOCKLIST.has(key)) continue;
    target[key] = value;
  }
}

/**
 * Map our normalized reasoning_effort values to the Anthropic Messages API
 * extended / adaptive thinking shape.
 *
 * Per current Claude API docs (Opus 4.6+, Sonnet 4.6+, Opus 4.7+, Opus 4.8+):
 *  - `thinking: { type: "adaptive" }` lets the model decide when to think.
 *  - `output_config: { effort: "<level>" }` provides soft guidance on how
 *    much thinking Claude should allocate. `effort` must be a sibling of
 *    `thinking` (NOT nested inside it).
 *  - `thinking.display` controls how thinking content is surfaced in the
 *    response. We default to `"summarized"` to avoid the full chain-of-
 *    thought being returned (recommended for cost/latency). The full
 *    chain-of-thought can still be obtained by passing
 *    `thinking.display: "full"` via `custom_request_params`.
 *  - `thinking: { type: "disabled" }` explicitly turns thinking off.
 *  - `thinking: { type: "enabled", budget_tokens: N }` is the legacy manual
 *    form; we do not emit it because the proxy does not know the model's
 *    max thinking budget, and adaptive + effort is the recommended path
 *    going forward. Users who need manual control can still pass it through
 *    `custom_request_params`.
 *
 * Effort levels accepted by the upstream `output_config.effort`:
 *   low, medium, high, xhigh, max (xhigh/max availability depends on model).
 *
 * Our internal vocabulary (from openaiProxy validation):
 *   none, minimal, low, medium, high, xhigh
 * `none` / `minimal` are treated as "disable thinking". `max` is forwarded
 * as-is when explicitly provided.
 */
function applyAnthropicReasoningControls(target, reasoningEffort) {
  if (typeof reasoningEffort !== 'string' || !reasoningEffort) return;

  const normalized = reasoningEffort.toLowerCase();

  if (normalized === 'none' || normalized === 'minimal') {
    target.thinking = { type: 'disabled' };
    return;
  }

  const allowedEffort = new Set(['low', 'medium', 'high', 'xhigh', 'max']);
  if (!allowedEffort.has(normalized)) return;

  // `display: "summarized"` requests that the API return a summary of the
  // thinking content (rather than the full chain-of-thought) on models that
  // support it. This is the recommended default for cost/latency.
  target.thinking = { type: 'adaptive', display: 'summarized' };
  target.output_config = { ...(target.output_config || {}), effort: normalized };
}

/**
 * Convert OpenAI-style message format to Anthropic Messages API format
 */
async function normalizeMessageForAnthropic(message) {
  if (!message || typeof message !== 'object') return null;

  const role = typeof message.role === 'string' ? message.role : undefined;
  if (!role) return null;

  // Anthropic doesn't support 'system' role in messages array
  // System messages should be extracted to top-level system parameter
  if (role === 'system') return null;

  const normalized = { role: role === 'assistant' ? 'assistant' : 'user' };

  if ('content' in message) {
    const content = message.content;
    if (Array.isArray(content)) {
      // Anthropic Messages API does not support audio input parts.
      if (content.some((part) => part?.type === 'input_audio')) {
        throw new Error('Audio input (input_audio) is not supported for Anthropic providers');
      }
      // Convert multimodal content
      const convertedParts = await Promise.all(content.map(async (part) => {
        if (typeof part === 'string') {
          return { type: 'text', text: part };
        }
        if (part?.type === 'text') {
          return { type: 'text', text: part.text };
        }
        if (part?.type === 'image_url') {
          // Convert OpenAI image format to Anthropic format
          const converted = await convertContentPartImage(part);
          if (converted?.type === 'image_url') {
            const url = converted.image_url?.url || converted.image_url;
            // Extract base64 data if present
            if (typeof url === 'string' && url.startsWith('data:image/')) {
              const matches = url.match(/^data:image\/(\w+);base64,(.+)$/);
              if (matches) {
                const [, mediaType, data] = matches;
                return {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: `image/${mediaType}`,
                    data,
                  },
                };
              }
            }
          }
          return null;
        }
        if (part?.type === 'tool_result') {
          // Anthropic tool result format
          return part;
        }
        if (part?.type === 'tool_use') {
          // Anthropic tool use format
          return part;
        }
        return null;
      }));
      normalized.content = convertedParts.filter(Boolean);
    } else if (typeof content === 'string') {
      normalized.content = content;
    } else if (content === null) {
      normalized.content = '';
    }
  }

  // Handle extended-thinking blocks preserved from a previous assistant turn.
  // Anthropic requires thinking blocks to be sent back with their original
  // `signature` so it can preserve the prompt cache. See:
  // https://platform.claude.com/docs/en/build-with-claude/extended-thinking#preserving-thinking-blocks
  if (role === 'assistant'
    && Array.isArray(message.reasoning_details)
    && message.reasoning_details.length > 0) {
    const thinkingBlocks = message.reasoning_details
      .filter((detail) => detail && typeof detail === 'object' && detail.type === 'thinking')
      .map((detail) => {
        const block = { type: 'thinking' };
        // Always set the `thinking` field to satisfy the Anthropic API schema
        // (the field is required on thinking content blocks). Use detail.text
        // when available; fall back to an empty string when only a signature
        // is present (defensive — the persistence layer should merge text in).
        block.thinking = typeof detail.text === 'string' ? detail.text : '';
        if (typeof detail.signature === 'string' && detail.signature) {
          block.signature = detail.signature;
        }
        return block;
      })
      // Only keep blocks that have meaningful text or a cryptographic signature
      .filter((block) => block.thinking || block.signature !== undefined);

    if (thinkingBlocks.length > 0) {
      if (!normalized.content) {
        normalized.content = thinkingBlocks;
      } else if (Array.isArray(normalized.content)) {
        normalized.content = [...thinkingBlocks, ...normalized.content];
      } else {
        normalized.content = [...thinkingBlocks, { type: 'text', text: normalized.content }];
      }
    }
  }

  // Handle tool calls from OpenAI format
  if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
    const toolUseBlocks = message.tool_calls.map((toolCall) => {
      const fn = toolCall.function || {};
      let input = {};
      try {
        input = typeof fn.arguments === 'string' ? JSON.parse(fn.arguments) : fn.arguments || {};
      } catch {
        input = {};
      }
      return {
        type: 'tool_use',
        id: toolCall.id || `tool_${Date.now()}`,
        name: fn.name,
        input,
      };
    });

    // If content is empty, initialize it as array
    if (!normalized.content) {
      normalized.content = toolUseBlocks;
    } else if (Array.isArray(normalized.content)) {
      normalized.content.push(...toolUseBlocks);
    } else {
      // Convert string content to array and add tool use blocks
      normalized.content = [
        { type: 'text', text: normalized.content },
        ...toolUseBlocks,
      ];
    }
  }

  // Handle tool results from OpenAI format (tool role)
  if (role === 'tool' && message.tool_call_id && message.content) {
    return {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: message.tool_call_id,
          content: message.content,
        },
      ],
    };
  }

  // Preserve cache_control for prompt caching
  if (message.cache_control && typeof message.cache_control === 'object') {
    const hasContent = Array.isArray(normalized.content)
      ? normalized.content.length > 0
      : Boolean(normalized.content);

    if (hasContent) {
      normalized.cache_control = message.cache_control;
    }
  }

  return normalized;
}

async function normalizeMessagesForAnthropic(messages) {
  if (!Array.isArray(messages)) return { system: undefined, messages: [] };

  // Extract system messages
  const systemMessages = messages.filter((m) => m.role === 'system');
  const nonSystemMessages = messages.filter((m) => m.role !== 'system');

  // Combine system messages into a single system prompt
  const system = systemMessages.length > 0
    ? systemMessages.map((m) => m.content).filter(Boolean).join('\n\n')
    : undefined;

  const normalized = await Promise.all(
    nonSystemMessages.map((message) => normalizeMessageForAnthropic(message))
  );

  return {
    system,
    messages: normalized.filter(Boolean),
  };
}

/**
 * Convert OpenAI-style tool spec to Anthropic format
 */
function normalizeToolForAnthropic(tool) {
  if (!tool) return null;
  if (typeof tool === 'string') {
    return {
      name: tool,
      description: '',
      input_schema: { type: 'object', properties: {} },
    };
  }
  if (typeof tool !== 'object') return null;

  const fn = tool.function || tool;
  if (!fn.name) return null;

  return {
    name: fn.name,
    description: fn.description || '',
    input_schema: fn.parameters || fn.input_schema || { type: 'object', properties: {} },
  };
}

function normalizeToolsForAnthropic(tools) {
  if (!Array.isArray(tools)) return undefined;
  const normalized = tools.map(normalizeToolForAnthropic).filter(Boolean);
  return normalized.length > 0 ? normalized : undefined;
}

function omitReservedKeys(payload) {
  if (!payload || typeof payload !== 'object') return {};
  const result = {};
  for (const key in payload) {
    if (RESERVED_INTERNAL_KEYS.has(key)) continue;
    result[key] = payload[key];
  }
  return result;
}

/**
 * Adapter for Anthropic Messages API
 */
export class MessagesAdapter extends BaseAdapter {
  /**
   * @param {object} options
   * @param {function} [options.getDefaultModel] - Returns the default model
   * @param {'anthropic'|'none'} [options.reasoningFormat='none'] - Format for reasoning controls:
   *   - 'anthropic': Translate `reasoning_effort` to `thinking` + `output_config.effort`
   *   - 'none': Don't include reasoning fields (caller is expected to pass
   *     `thinking` / `output_config` through `custom_request_params` if needed)
   */
  constructor(options = {}) {
    super(options);
    this.getDefaultModel = options.getDefaultModel || (() => undefined);
    this.reasoningFormat = options.reasoningFormat || 'none';
  }

  async translateRequest(internalRequest = {}, context = {}) {
    const payload = omitReservedKeys(internalRequest);

    const resolveDefaultModel = context.getDefaultModel || this.getDefaultModel;
    const model = payload.model || resolveDefaultModel();
    if (!model) {
      throw new Error('Anthropic provider requires a model');
    }

    const { system, messages } = await normalizeMessagesForAnthropic(payload.messages);

    if (messages.length === 0) {
      throw new Error('Anthropic provider requires at least one non-system message');
    }

    const normalized = { model, messages };

    // Add system prompt if present
    if (system) {
      normalized.system = system;
    }

    // Anthropic requires max_tokens
    if (payload.max_tokens) {
      normalized.max_tokens = payload.max_tokens;
    } else {
      // Use a sensible default if not provided
      normalized.max_tokens = 64000;
    }

    if ('stream' in payload) {
      normalized.stream = Boolean(payload.stream);
    }

    // Handle tools
    const tools = normalizeToolsForAnthropic(payload.tools);
    if (tools) {
      normalized.tools = tools;
      if (payload.tool_choice !== undefined) {
        // Convert OpenAI tool_choice format to Anthropic format
        if (typeof payload.tool_choice === 'string') {
          if (payload.tool_choice === 'auto') {
            normalized.tool_choice = { type: 'auto' };
          } else if (payload.tool_choice === 'required') {
            normalized.tool_choice = { type: 'any' };
          }
        } else if (payload.tool_choice?.type === 'function') {
          normalized.tool_choice = {
            type: 'tool',
            name: payload.tool_choice.function?.name,
          };
        }
      }
    }

    // Copy allowed parameters
    for (const [key, value] of Object.entries(payload)) {
      if (value === undefined) continue;
      if (key === 'messages' || key === 'model' || key === 'tools' || key === 'tool_choice' || key === 'stream' || key === 'max_tokens')
        continue;
      if (key === 'reasoning_effort') continue; // handled separately below
      if (key === 'reasoning') continue; // handled separately below
      if (ANTHROPIC_ALLOWED_REQUEST_KEYS.has(key)) {
        normalized[key] = value;
      }
    }

    // Handle reasoning_effort based on configured format.
    // Accept either `reasoning_effort` (flat) or `reasoning.effort` (nested) from input.
    const reasoningEffort = payload.reasoning_effort ?? payload.reasoning?.effort;
    if (reasoningEffort !== undefined) {
      const format = context.reasoningFormat || this.reasoningFormat;
      if (format === 'anthropic') {
        applyAnthropicReasoningControls(normalized, reasoningEffort);
      }
      // format === 'none': Don't include reasoning fields. Callers that need
      // manual extended thinking can still inject `thinking` /
      // `output_config` via `custom_request_params`.
    }

    applyCustomRequestParams(normalized, payload.custom_request_params);

    return normalized;
  }

  async translateResponse(providerResponse, _context = {}) {
    if (!providerResponse) return providerResponse;

    if (typeof providerResponse === 'string') {
      try {
        const parsed = JSON.parse(providerResponse);
        return this.convertAnthropicToOpenAI(parsed);
      } catch {
        return providerResponse;
      }
    }
    // Handle Response objects from fetch API
    if (providerResponse && typeof providerResponse === 'object' && typeof providerResponse.json === 'function') {
      try {
        // Check if body is already used
        if (providerResponse.bodyUsed) {
           // If body is used, we can't read it again.
           // Assuming it was read elsewhere and we received the parsed object or string.
           // If we received the Response object here, it implies we need to read it.
           // However, if it's already used, we might be in a tricky spot.
           // For now, let's return it as is or try to clone if possible (but clone won't work if used).
           return providerResponse;
        }
        const parsed = await providerResponse.json();
        return this.convertAnthropicToOpenAI(parsed);
      } catch {
        return providerResponse;
      }
    }
    if (providerResponse && typeof providerResponse === 'object') {
      return this.convertAnthropicToOpenAI(providerResponse);
    }
    return providerResponse;
  }

  translateStreamChunk(chunk, _context = {}) {
    if (!chunk) return null;
    if (typeof chunk === 'string') {
      const trimmed = chunk.trim();
      if (!trimmed) return null;
      try {
        const parsed = JSON.parse(trimmed);
        return this.convertAnthropicStreamToOpenAI(parsed);
      } catch {
        return null;
      }
    }
    if (chunk && typeof chunk === 'object') {
      return this.convertAnthropicStreamToOpenAI(chunk);
    }
    return chunk;
  }

  /**
   * Map Anthropic stop_reason to OpenAI finish_reason
   */
  mapStopReason(stopReason) {
    switch (stopReason) {
      case 'end_turn':
        return 'stop';
      case 'max_tokens':
        return 'length';
      case 'tool_use':
        return 'tool_calls';
      case 'stop_sequence':
        return 'stop';
      default:
        return stopReason || null;
    }
  }

  /**
   * Convert Anthropic response to OpenAI format
   */
  convertAnthropicToOpenAI(anthropicResponse) {
    if (!anthropicResponse || typeof anthropicResponse !== 'object') {
      return anthropicResponse;
    }

    // Handle error responses
    if (anthropicResponse.type === 'error') {
      return anthropicResponse;
    }

    const openAIResponse = {
      id: anthropicResponse.id || `chatcmpl-${Date.now()}`,
      object: 'chat.completion',
      created: Date.now(),
      model: anthropicResponse.model,
      choices: [],
    };

    // Convert content blocks to OpenAI format
    const content = [];
    const toolCalls = [];
    // Capture extended-thinking blocks (text + signature) so signatures round-trip
    // back to Anthropic on the next request and preserve the prompt cache.
    // See: https://platform.claude.com/docs/en/build-with-claude/extended-thinking#preserving-thinking-blocks
    const reasoningDetails = [];

    if (Array.isArray(anthropicResponse.content)) {
      anthropicResponse.content.forEach((block, index) => {
        if (block.type === 'text') {
          content.push(block.text);
        } else if (block.type === 'tool_use') {
          toolCalls.push({
            id: block.id,
            type: 'function',
            function: {
              name: block.name,
              arguments: JSON.stringify(block.input),
            },
            index,
          });
        } else if (block.type === 'thinking') {
          const thinkingEntry = {
            type: 'thinking',
            index,
          };
          if (typeof block.thinking === 'string') {
            thinkingEntry.text = block.thinking;
          }
          if (typeof block.signature === 'string' && block.signature) {
            thinkingEntry.signature = block.signature;
          }
          reasoningDetails.push(thinkingEntry);
        }
      });
    }

    const message = {
      role: 'assistant',
      content: content.length > 0 ? content.join('') : null,
    };

    if (toolCalls.length > 0) {
      message.tool_calls = toolCalls;
    }

    if (reasoningDetails.length > 0) {
      message.reasoning_details = reasoningDetails;
    }

    openAIResponse.choices.push({
      index: 0,
      message,
      finish_reason: this.mapStopReason(anthropicResponse.stop_reason),
    });

    // Add usage information
    const usage = normalizeUsage(anthropicResponse.usage);
    if (usage) {
      openAIResponse.usage = usage;
    }

    return openAIResponse;
  }

  /**
   * Convert Anthropic streaming event to OpenAI streaming format
   */
  convertAnthropicStreamToOpenAI(event) {
    if (!event || typeof event !== 'object') {
      return null;
    }

    // Handle different event types
    switch (event.type) {
      case 'message_start':
        return {
          id: event.message?.id || `chatcmpl-${Date.now()}`,
          object: 'chat.completion.chunk',
          created: Date.now(),
          model: event.message?.model,
          choices: [
            {
              index: 0,
              delta: { role: 'assistant', content: '' },
              finish_reason: null,
            },
          ],
        };

      case 'content_block_start':
        if (event.content_block?.type === 'tool_use') {
          return {
            id: `chatcmpl-${Date.now()}`,
            object: 'chat.completion.chunk',
            created: Date.now(),
            model: event.model,
            choices: [
              {
                index: event.index || 0,
                delta: {
                  tool_calls: [
                    {
                      index: event.index || 0,
                      id: event.content_block.id,
                      type: 'function',
                      function: {
                        name: event.content_block.name,
                        arguments: '',
                      },
                    },
                  ],
                },
                finish_reason: null,
              },
            ],
          };
        }
        return null;

      case 'content_block_delta':
        if (event.delta?.type === 'text_delta') {
          return {
            id: `chatcmpl-${Date.now()}`,
            object: 'chat.completion.chunk',
            created: Date.now(),
            model: event.model,
            choices: [
              {
                index: event.index || 0,
                delta: { content: event.delta.text },
                finish_reason: null,
              },
            ],
          };
        }
        if (event.delta?.type === 'thinking_delta') {
          // Anthropic extended-thinking streaming: the thinking text delta.
          // Surface it to the UI as `reasoning_content` (the frontend's
          // streaming handler reads `delta.reasoning_content ?? delta.reasoning`).
          return {
            id: `chatcmpl-${Date.now()}`,
            object: 'chat.completion.chunk',
            created: Date.now(),
            model: event.model,
            choices: [
              {
                index: event.index || 0,
                delta: {
                  reasoning_content: event.delta.thinking ?? '',
                  reasoning: event.delta.thinking ?? '',
                },
                finish_reason: null,
              },
            ],
          };
        }
        if (event.delta?.type === 'signature_delta') {
          // Anthropic extended-thinking streaming: the cryptographic signature
          // for the preceding thinking block. We do NOT render this to the UI,
          // but we MUST keep it for later turns so Anthropic can preserve the
          // prompt cache (see:
          // https://platform.claude.com/docs/en/build-with-claude/extended-thinking#preserving-thinking-blocks).
          //
          // We attach the signature to a `reasoning_details` entry keyed by the
          // thinking block's `index`, so it merges with the accumulated thinking
          // text for the same block in `simplifiedPersistence.setReasoningDetails`,
          // and round-trips through the request as an Anthropic `thinking`
          // content block via `normalizeMessageForAnthropic`.
          if (typeof event.delta?.signature !== 'string' || !event.delta.signature) {
            return null;
          }
          return {
            id: `chatcmpl-${Date.now()}`,
            object: 'chat.completion.chunk',
            created: Date.now(),
            model: event.model,
            choices: [
              {
                index: event.index || 0,
                delta: {
                  reasoning_details: [
                    {
                      type: 'thinking',
                      index: event.index || 0,
                      signature: event.delta.signature,
                    },
                  ],
                },
                finish_reason: null,
              },
            ],
          };
        }
        if (event.delta?.type === 'input_json_delta') {
          return {
            id: `chatcmpl-${Date.now()}`,
            object: 'chat.completion.chunk',
            created: Date.now(),
            model: event.model,
            choices: [
              {
                index: event.index || 0,
                delta: {
                  tool_calls: [
                    {
                      index: event.index || 0,
                      function: {
                        arguments: event.delta.partial_json,
                      },
                    },
                  ],
                },
                finish_reason: null,
              },
            ],
          };
        }
        return null;

      case 'content_block_stop':
        return null; // No equivalent in OpenAI streaming

      case 'message_delta':
        return {
          id: `chatcmpl-${Date.now()}`,
          object: 'chat.completion.chunk',
          created: Date.now(),
          model: event.model,
          choices: [
            {
              index: 0,
              delta: {},
              finish_reason: this.mapStopReason(event.delta?.stop_reason),
            },
          ],
          usage: normalizeUsage(event.usage),
        };

      case 'message_stop':
        return '[DONE]';

      case 'ping':
        return null; // Ignore ping events

      default:
        return null;
    }
  }
}
