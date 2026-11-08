/**
 * Conversion between harness `Item` history and the Chat Completions message
 * format every ChatForge provider adapter accepts as input.
 *
 * Round-trip rule: a ChatForge message the portable `Item` variants can't
 * represent exactly (audio parts, unknown roles, mid-history system messages)
 * travels as a `provider_input` item holding the original message, and comes
 * back out unchanged. Nothing is dropped.
 *
 * Provider continuity data rides on item metadata:
 *   - OpenRouter `reasoning_details` -> reasoning item `providerMetadata.reasoning_details`
 *   - Gemini `gemini_thought_signature` -> tool_call item `providerMetadata.gemini_thought_signature`
 */
import { randomUUID } from 'node:crypto';
import type { ContentPart, Item, ItemId, ToolCallId, ToolSpec } from './contracts.ts';

/** `provider` value on `provider_input` items that carry a raw ChatForge message. */
export const CHATFORGE_PROVIDER_INPUT = 'chatforge';

export type ChatContentPart = { readonly type: string; readonly [key: string]: unknown };

export type ChatToolCall = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
  gemini_thought_signature?: string;
  [key: string]: unknown;
};

export type ChatMessage = {
  role: string;
  content?: string | ChatContentPart[] | null;
  tool_calls?: ChatToolCall[];
  tool_call_id?: string;
  reasoning_details?: unknown[];
  [key: string]: unknown;
};

export type ChatTool = {
  type: 'function';
  function: { name: string; description: string; parameters: Readonly<Record<string, unknown>> };
};

export const newItemId = (): ItemId => randomUUID() as ItemId;

// ---------- Item[] -> Chat Completions messages ----------

function contentPartToChat(part: ContentPart): ChatContentPart {
  if (part.type === 'text') return { type: 'text', text: part.text };
  const url = isUrlLike(part.data) ? part.data : `data:${part.mediaType};base64,${part.data}`;
  return {
    type: 'image_url',
    image_url: { url, ...(part.detail ? { detail: part.detail } : {}) },
  };
}

/** Plain text stays a string, as ChatForge sends it today; anything else becomes parts. */
function contentToChat(content: readonly ContentPart[]): string | ChatContentPart[] {
  if (content.every((part) => part.type === 'text')) {
    return content.map((part) => (part as { text: string }).text).join('');
  }
  return content.map(contentPartToChat);
}

function isUrlLike(value: string): boolean {
  return /^(https?:|data:|blob:|\/)/i.test(value);
}

function toolCallArguments(item: Extract<Item, { type: 'tool_call' }>): string {
  if (typeof item.rawArguments === 'string' && item.rawArguments.length > 0) return item.rawArguments;
  if (typeof item.input === 'string') return item.input;
  return JSON.stringify(item.input ?? {});
}

/**
 * Collapse items into Chat Completions messages. Reasoning, assistant text and
 * tool calls from one model response merge into a single assistant message,
 * the shape providers expect back.
 */
export function itemsToChatMessages(items: readonly Item[], instructions = ''): ChatMessage[] {
  const messages: ChatMessage[] = [];
  if (instructions) messages.push({ role: 'system', content: instructions });

  let assistant: ChatMessage | null = null;
  const flush = () => {
    if (!assistant) return;
    if (assistant.content === undefined) assistant.content = '';
    messages.push(assistant);
    assistant = null;
  };
  const openAssistant = (): ChatMessage => {
    assistant ??= { role: 'assistant' };
    return assistant;
  };

  for (const item of items) {
    switch (item.type) {
      case 'user_message': {
        flush();
        if (item.conversationTiming) messages.push({ role: 'system', content: item.conversationTiming });
        messages.push({ role: 'user', content: contentToChat(item.content) });
        break;
      }
      case 'assistant_message': {
        const target = openAssistant();
        const text = contentToChat(item.content);
        if (typeof target.content === 'string' && typeof text === 'string') target.content += text;
        else if (target.content === undefined || target.content === '') target.content = text;
        else {
          const existing: ChatContentPart[] =
            typeof target.content === 'string' ? [{ type: 'text', text: target.content }] : target.content ?? [];
          target.content = [...existing, ...(typeof text === 'string' ? [{ type: 'text', text }] : text)];
        }
        break;
      }
      case 'reasoning': {
        const details = item.providerMetadata?.reasoning_details;
        if (Array.isArray(details) && details.length > 0) {
          const target = openAssistant();
          target.reasoning_details = [...(target.reasoning_details ?? []), ...details];
        }
        break;
      }
      case 'tool_call': {
        const target = openAssistant();
        const signature = item.providerMetadata?.gemini_thought_signature;
        const call: ChatToolCall = {
          id: item.callId,
          type: 'function',
          function: { name: item.toolName, arguments: toolCallArguments(item) },
          ...(typeof signature === 'string' ? { gemini_thought_signature: signature } : {}),
        };
        target.tool_calls = [...(target.tool_calls ?? []), call];
        break;
      }
      case 'tool_result': {
        flush();
        messages.push({ role: 'tool', tool_call_id: item.callId, content: item.output });
        break;
      }
      case 'summary': {
        flush();
        messages.push({ role: 'user', content: item.text });
        break;
      }
      case 'provider_input': {
        flush();
        messages.push({ ...(item.input as ChatMessage) });
        break;
      }
      case 'provider_opaque':
        // Provider-native output from another provider; ChatForge's adapters
        // can't replay it, so it stays out of the request.
        break;
    }
  }
  flush();
  return messages;
}

export function toolSpecsToChatTools(specs: readonly ToolSpec[]): ChatTool[] {
  return specs.map((spec) => ({
    type: 'function',
    function: { name: spec.name, description: spec.description, parameters: spec.inputSchema },
  }));
}

// ---------- Chat Completions messages -> Item[] ----------

function chatPartToContent(part: ChatContentPart): ContentPart | null {
  if (part.type === 'text' && typeof part.text === 'string') return { type: 'text', text: part.text };
  if (part.type === 'image_url') {
    const imageUrl = part.image_url as { url?: unknown; detail?: unknown } | string | undefined;
    const url = typeof imageUrl === 'string' ? imageUrl : imageUrl?.url;
    if (typeof url !== 'string') return null;
    const detail = typeof imageUrl === 'object' && typeof imageUrl.detail === 'string' ? imageUrl.detail : undefined;
    const match = /^data:([^;,]+)[;,]/.exec(url);
    return { type: 'image', mediaType: match?.[1] ?? 'image/*', data: url, ...(detail ? { detail } : {}) };
  }
  return null;
}

/** Portable content, or null when any part has no exact `ContentPart` form. */
function chatContentToParts(content: ChatMessage['content']): ContentPart[] | null {
  if (content === null || content === undefined) return [];
  if (typeof content === 'string') return content ? [{ type: 'text', text: content }] : [];
  const parts: ContentPart[] = [];
  for (const raw of content) {
    const part = chatPartToContent(raw);
    if (!part) return null;
    parts.push(part);
  }
  return parts;
}

function parseArguments(raw: string): unknown {
  try {
    return JSON.parse(raw || '{}');
  } catch {
    return raw;
  }
}

const KNOWN_KEYS: Record<string, readonly string[]> = {
  user: ['role', 'content', 'id'],
  assistant: ['role', 'content', 'tool_calls', 'reasoning_details', 'id'],
  tool: ['role', 'content', 'tool_call_id', 'id'],
};

function hasOnlyKnownKeys(message: ChatMessage): boolean {
  const known = KNOWN_KEYS[message.role];
  return Boolean(known) && Object.keys(message).every((key) => known!.includes(key));
}

function rawInput(message: ChatMessage): Item {
  return { type: 'provider_input', id: newItemId(), provider: CHATFORGE_PROVIDER_INPUT, input: { ...message } };
}

/**
 * Convert ChatForge history to items. Leading system messages become the
 * instructions; everything else maps to the closest portable item, or to a
 * `provider_input` item when the mapping would lose data.
 */
export function chatMessagesToItems(messages: readonly ChatMessage[]): { instructions: string; items: Item[] } {
  const instructionParts: string[] = [];
  let index = 0;
  for (; index < messages.length; index++) {
    const message = messages[index]!;
    if (message.role !== 'system' || typeof message.content !== 'string') break;
    instructionParts.push(message.content);
  }

  const items: Item[] = [];
  for (const message of messages.slice(index)) {
    if (!hasOnlyKnownKeys(message)) {
      items.push(rawInput(message));
      continue;
    }
    const id = (typeof message.id === 'string' && message.id ? message.id : randomUUID()) as ItemId;

    if (message.role === 'user') {
      const content = chatContentToParts(message.content);
      items.push(content ? { type: 'user_message', id, content } : rawInput(message));
      continue;
    }

    if (message.role === 'tool') {
      if (typeof message.tool_call_id !== 'string' || typeof message.content !== 'string') {
        items.push(rawInput(message));
        continue;
      }
      items.push({
        type: 'tool_result',
        id,
        callId: message.tool_call_id as ToolCallId,
        output: message.content,
        isError: false,
      });
      continue;
    }

    // assistant
    const content = chatContentToParts(message.content);
    if (!content) {
      items.push(rawInput(message));
      continue;
    }
    if (Array.isArray(message.reasoning_details) && message.reasoning_details.length > 0) {
      items.push({
        type: 'reasoning',
        id: newItemId(),
        summary: '',
        providerMetadata: { reasoning_details: message.reasoning_details },
      });
    }
    if (content.length > 0 || !message.tool_calls?.length) items.push({ type: 'assistant_message', id, content });
    for (const call of message.tool_calls ?? []) {
      items.push({
        type: 'tool_call',
        id: newItemId(),
        callId: call.id as ToolCallId,
        toolName: call.function.name,
        input: parseArguments(call.function.arguments),
        rawArguments: call.function.arguments,
        ...(call.gemini_thought_signature
          ? { providerMetadata: { gemini_thought_signature: call.gemini_thought_signature } }
          : {}),
      });
    }
  }

  return { instructions: instructionParts.join('\n\n'), items };
}
