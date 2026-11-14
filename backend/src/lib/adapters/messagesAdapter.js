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

const SAMPLING_PARAM_KEYS = ['temperature', 'top_p', 'top_k'];

/**
 * Request-shape adjustments keyed by canonical Claude model id.
 *
 * Dated and other suffixes (`claude-opus-5-5-20251101`, `claude-opus-5-5-latest`)
 * resolve to the same entry. Ids that do not match keep the historical shape
 * (`claude-opus-4-5`, `claude-sonnet-4-5`, `claude-3-5-*`, and so on).
 *
 * `noneThinking` is how effort `none` is sent:
 *  - `adaptive-low`: Opus 5.5 rejects `thinking.type: "disabled"`. Send
 *    adaptive thinking with `output_config.effort: "low"`.
 *  - `between_tools`: Sonnet 5.5 rejects `"disabled"`. `between_tools` is the
 *    off switch and is valid only at effort high or below (the API default
 *    is high, so `none` does not send an effort).
 *  - omitted: `thinking: { type: "disabled" }` (Haiku 5.5 and earlier).
 * `acceptsXhigh`: pass `xhigh` through. Set from the effort docs, not from
 * "4.7+" alone. Sonnet 4.7 and Haiku variants are included only when that
 * page lists them.
 * https://platform.claude.com/docs/en/build-with-claude/effort
 *
 * Sampling parameters are omitted for the 5.5 models and for every other
 * Claude 4.7+ id. Non-default `temperature` / `top_p` / `top_k` return 400
 * on Claude 4.7 and later, and the docs say to omit them:
 * https://platform.claude.com/docs/en/build-with-claude/working-with-messages
 */
const CLAUDE_55_CAPABILITIES = {
  'claude-opus-5-5': {
    noneThinking: 'adaptive-low',
    acceptsXhigh: true,
    stripSamplingParams: true,
    downgradeForcedToolChoice: true,
  },
  'claude-sonnet-5-5': {
    noneThinking: 'between_tools',
    acceptsXhigh: true,
    stripSamplingParams: true,
    downgradeForcedToolChoice: true,
  },
  'claude-haiku-5-5': {
    acceptsXhigh: true,
    stripSamplingParams: true,
    downgradeForcedToolChoice: false,
  },
};

const CLAUDE_47_PLUS_CAPABILITIES = {
  stripSamplingParams: true,
  downgradeForcedToolChoice: false,
};

const NO_ANTHROPIC_ADJUSTMENTS = {
  stripSamplingParams: false,
  downgradeForcedToolChoice: false,
};

function normalizeAnthropicModelId(model) {
  if (typeof model !== 'string') return '';
  let id = model.trim().toLowerCase();
  const scoped = id.lastIndexOf('::');
  if (scoped !== -1) id = id.slice(scoped + 2).trim();
  const slash = id.lastIndexOf('/');
  if (slash !== -1) id = id.slice(slash + 1).trim();
  return id;
}

function parseClaudeModelId(modelId) {
  // Minor is one or two digits (`4-5`, `4-7`). An 8-digit snapshot such as
  // `claude-sonnet-4-20250514` is not a minor version; treat it as `4.0`.
  const match = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?=-|$)/.exec(modelId);
  if (!match) return null;
  return {
    family: match[1],
    major: Number(match[2]),
    minor: match[3] === undefined ? 0 : Number(match[3]),
  };
}

function isClaude47OrLater(modelId) {
  const version = parseClaudeModelId(modelId);
  if (!version) return false;
  return version.major > 4 || (version.major === 4 && version.minor >= 7);
}

/**
 * `output_config.effort: "xhigh"` is not available on every Claude model.
 * The effort docs list exactly: Fable 5.2, Mythos 5.2, Fable 5.1, Mythos 5.1,
 * Fable 5, Mythos 5, Opus 5.5, Opus 5, Opus 4.8, Opus 4.7, Sonnet 5.5,
 * Sonnet 5, and Haiku 5.5.
 * https://platform.claude.com/docs/en/build-with-claude/effort
 * Opus 4.6, Sonnet 4.6, Sonnet 4.7, Haiku 5, and anything 4.5 or earlier
 * are not on that list.
 */
function claudeAcceptsXhigh(modelId) {
  const parsed = parseClaudeModelId(modelId);
  if (!parsed) return false;
  const { family, major, minor } = parsed;
  if (family === 'fable' || family === 'mythos') {
    return major === 5 && (minor === 2 || minor === 1 || minor === 0);
  }
  if (family === 'opus') {
    if (major === 5 && (minor === 5 || minor === 0)) return true;
    return major === 4 && (minor === 8 || minor === 7);
  }
  if (family === 'sonnet') {
    return major === 5 && (minor === 5 || minor === 0);
  }
  if (family === 'haiku') {
    return major === 5 && minor === 5;
  }
  return false;
}

function withXhigh(capabilities, modelId) {
  if (!claudeAcceptsXhigh(modelId) || capabilities.acceptsXhigh) return capabilities;
  return { ...capabilities, acceptsXhigh: true };
}

function getAnthropicModelCapabilities(model) {
  const id = normalizeAnthropicModelId(model);
  for (const [key, capabilities] of Object.entries(CLAUDE_55_CAPABILITIES)) {
    if (id === key || id.startsWith(`${key}-`)) return withXhigh(capabilities, id);
  }
  if (isClaude47OrLater(id)) return withXhigh(CLAUDE_47_PLUS_CAPABILITIES, id);
  return withXhigh(NO_ANTHROPIC_ADJUSTMENTS, id);
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
 *  - `thinking: { type: "disabled" }` explicitly turns thinking off on models
 *    that accept it. Opus 5.5 and Sonnet 5.5 do not; see
 *    `getAnthropicModelCapabilities`.
 *  - `thinking: { type: "enabled", budget_tokens: N }` is the legacy manual
 *    form; we do not emit it because the proxy does not know the model's
 *    max thinking budget, and adaptive + effort is the recommended path
 *    going forward. Users who need manual control can still pass it through
 *    `custom_request_params`.
 *
 * Canonical efforts are none, low, medium, high, xhigh. `minimal` and `max`
 * are legacy values: each model maps them to the nearest effort it accepts.
 * `xhigh` is passed through only on the models listed in the effort docs
 * (see `claudeAcceptsXhigh`); every other Claude model receives `high`.
 * Unknown strings are left unset.
 */
const CLAUDE_EFFORT_ORDER = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

function nearestAcceptedEffort(value, acceptsXhigh) {
  const accepted = acceptsXhigh
    ? ['none', 'low', 'medium', 'high', 'xhigh']
    : ['none', 'low', 'medium', 'high'];
  const index = CLAUDE_EFFORT_ORDER.indexOf(value);
  if (index === -1) return null;

  let best = accepted[0];
  let bestDistance = Infinity;
  for (const candidate of accepted) {
    const candidateIndex = CLAUDE_EFFORT_ORDER.indexOf(candidate);
    const distance = Math.abs(candidateIndex - index);
    if (distance < bestDistance || (distance === bestDistance && candidateIndex > CLAUDE_EFFORT_ORDER.indexOf(best))) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

function applyAnthropicReasoningControls(target, reasoningEffort, capabilities) {
  if (typeof reasoningEffort !== 'string' || !reasoningEffort) return;

  const normalized = reasoningEffort.trim().toLowerCase();
  const mapped = nearestAcceptedEffort(normalized, capabilities?.acceptsXhigh === true);
  if (!mapped) return;

  if (mapped === 'none') {
    if (capabilities?.noneThinking === 'adaptive-low') {
      target.thinking = { type: 'adaptive' };
      target.output_config = { ...(target.output_config || {}), effort: 'low' };
      return;
    }
    if (capabilities?.noneThinking === 'between_tools') {
      target.thinking = { type: 'between_tools' };
      return;
    }
    target.thinking = { type: 'disabled' };
    return;
  }

  // `display: "summarized"` requests that the API return a summary of the
  // thinking content (rather than the full chain-of-thought) on models that
  // support it. This is the recommended default for cost/latency.
  target.thinking = { type: 'adaptive', display: 'summarized' };
  target.output_config = { ...(target.output_config || {}), effort: mapped };
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
          return withCacheControl({ type: 'text', text: part.text }, part);
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
                return withCacheControl({
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: `image/${mediaType}`,
                    data,
                  },
                }, part);
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

function withCacheControl(block, sourcePart) {
  if (sourcePart?.cache_control && typeof sourcePart.cache_control === 'object') {
    return { ...block, cache_control: sourcePart.cache_control };
  }
  return block;
}

function buildAnthropicSystem(systemMessages) {
  if (systemMessages.length === 0) return undefined;

  const hasBlocks = systemMessages.some((m) => Array.isArray(m.content));
  if (!hasBlocks) {
    return systemMessages.map((m) => m.content).filter(Boolean).join('\n\n') || undefined;
  }

  const blocks = systemMessages.flatMap((m) => {
    if (typeof m.content === 'string') {
      return m.content ? [{ type: 'text', text: m.content }] : [];
    }
    if (!Array.isArray(m.content)) return [];
    return m.content
      .filter((part) => part?.type === 'text' && typeof part.text === 'string' && part.text.length > 0)
      .map((part) => withCacheControl({ type: 'text', text: part.text }, part));
  });
  return blocks.length > 0 ? blocks : undefined;
}

async function normalizeMessagesForAnthropic(messages) {
  if (!Array.isArray(messages)) return { system: undefined, messages: [] };

  // Extract system messages
  const systemMessages = messages.filter((m) => m.role === 'system');
  const nonSystemMessages = messages.filter((m) => m.role !== 'system');

  // Combine system messages into a single system prompt. Prompt caching turns
  // system content into text blocks carrying cache_control; keep those as
  // Anthropic system blocks instead of joining them as strings.
  const system = buildAnthropicSystem(systemMessages);

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
    const capabilities = getAnthropicModelCapabilities(model);

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
            // Opus 5.5 and Sonnet 5.5 reject tool_choice "any" and "tool".
            normalized.tool_choice = capabilities.downgradeForcedToolChoice
              ? { type: 'auto' }
              : { type: 'any' };
          }
        } else if (payload.tool_choice?.type === 'function') {
          normalized.tool_choice = capabilities.downgradeForcedToolChoice
            ? { type: 'auto' }
            : {
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
        applyAnthropicReasoningControls(normalized, reasoningEffort, capabilities);
      }
      // format === 'none': Don't include reasoning fields. Callers that need
      // manual extended thinking can still inject `thinking` /
      // `output_config` via `custom_request_params`.
    }

    applyCustomRequestParams(normalized, payload.custom_request_params);

    // Drop sampling params last so custom_request_params cannot put them back.
    // Claude 4.7+ and the 5.5 models reject them (title generation sends
    // temperature 0.2). Earlier models keep whatever the caller set.
    if (capabilities.stripSamplingParams) {
      for (const key of SAMPLING_PARAM_KEYS) {
        delete normalized[key];
      }
    }

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
