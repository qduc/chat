/**
 * Message content transformation utilities
 * Handles text, image, and file content in messages
 */

import type {
  MessageContent,
  TextContent,
  ImageContent,
  FileContent,
  InputAudioContent,
} from './types';

/**
 * Extract text content from MessageContent (string or mixed content array)
 */
export function extractTextFromContent(content: MessageContent): string {
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .filter((item): item is TextContent => item.type === 'text')
      .map((item) => item.text)
      .join('');
  }

  return '';
}

/**
 * Convert string content to MessageContent format
 */
export function stringToMessageContent(text: string): MessageContent {
  return text;
}

/**
 * Convert mixed content array to MessageContent format
 */
export function arrayToMessageContent(items: Array<TextContent | ImageContent>): MessageContent {
  return items;
}

/**
 * Check if content contains images
 */
export function hasImages(content: MessageContent): boolean {
  if (typeof content === 'string') {
    return false;
  }

  if (Array.isArray(content)) {
    return content.some((item) => item.type === 'image_url');
  }

  return false;
}

/**
 * Check if content contains audio inputs
 */
export function hasAudio(content: MessageContent): boolean {
  if (typeof content === 'string') {
    return false;
  }

  if (Array.isArray(content)) {
    return content.some((item) => (item as any)?.type === 'input_audio');
  }

  return false;
}

/**
 * Extract image content from MessageContent
 */
export function extractImagesFromContent(content: MessageContent): ImageContent[] {
  if (typeof content === 'string') {
    return [];
  }

  if (Array.isArray(content)) {
    return content
      .filter((item): item is ImageContent => item.type === 'image_url')
      .map((item) => ({
        ...item,
        image_url: {
          ...item.image_url,
          // Return URLs as stored in database (base URLs without tokens)
          url: item.image_url.url,
        },
      }));
  }

  return [];
}

/**
 * Extract audio content parts from MessageContent
 */
export function extractAudioFromContent(content: MessageContent): InputAudioContent[] {
  if (typeof content === 'string') {
    return [];
  }

  if (Array.isArray(content)) {
    return content.filter(
      (item): item is InputAudioContent => (item as any)?.type === 'input_audio'
    );
  }

  return [];
}

/**
 * Create mixed content from text and images
 */
export function createMixedContent(text: string, images: ImageContent[] = []): MessageContent {
  const items: Array<TextContent | ImageContent> = [];

  if (text.trim()) {
    items.push({
      type: 'text',
      text: text,
    });
  }

  items.push(...images);

  // If only text and no images, return string for simplicity
  if (items.length === 1 && items[0].type === 'text') {
    return text;
  }

  // If no content at all, return empty string
  if (items.length === 0) {
    return '';
  }

  return items;
}

/**
 * Normalize MessageContent to ensure consistency
 */
export function normalizeMessageContent(content: MessageContent): MessageContent {
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    // Filter out empty text items
    const filtered = content.filter((item) => {
      if (item.type === 'text') {
        return item.text.trim().length > 0;
      }
      return true; // Keep all non-text items (images/audio/etc)
    });

    // If only one text item remains, convert to string
    if (filtered.length === 1 && filtered[0].type === 'text') {
      return filtered[0].text;
    }

    // If no items remain, return empty string
    if (filtered.length === 0) {
      return '';
    }

    return filtered;
  }

  return '';
}

// ============================================================================
// File Content Utilities
// ============================================================================

/**
 * Regex to match file blocks in message text.
 * Matches: File: filename\n```language\n...content...\n```
 * - Uses \r?\n to handle both Unix and Windows line endings
 * - Allows optional whitespace after "File:"
 * - Content capture is non-greedy to handle multiple file blocks
 */
const FILE_BLOCK_REGEX = /File:\s*(.+?)\r?\n```(\w*)\r?\n([\s\S]*?)```/g;

/**
 * Check if text contains file attachments
 */
export function hasFileAttachments(text: string): boolean {
  const regex = /File:\s*(.+?)\r?\n```(\w*)\r?\n([\s\S]*?)```/;
  return regex.test(text);
}

/**
 * Extract file attachments from text content
 */
export function extractFilesFromText(text: string): FileContent[] {
  const files: FileContent[] = [];
  const regex = /File:\s*(.+?)\r?\n```(\w*)\r?\n([\s\S]*?)```/g;

  let match;
  while ((match = regex.exec(text)) !== null) {
    files.push({
      type: 'file',
      name: match[1].trim(),
      language: match[2] || 'text',
      content: match[3],
    });
  }

  return files;
}

/**
 * Remove file blocks from text, returning the remaining user message
 */
export function removeFileBlocksFromText(text: string): string {
  const regex = /File:\s*(.+?)\r?\n```(\w*)\r?\n([\s\S]*?)```/g;
  return text.replace(regex, '').trim();
}

/**
 * Extract files and remaining text from message content
 */
export function extractFilesAndText(content: MessageContent): {
  text: string;
  files: FileContent[];
} {
  const textContent = extractTextFromContent(content);
  const files = extractFilesFromText(textContent);
  const remainingText = removeFileBlocksFromText(textContent);

  return {
    text: remainingText,
    files,
  };
}

/**
 * Extract reasoning from partial JSON string (used for streaming judge results)
 */
export function extractReasoningFromPartialJson(partialJson: string | null | undefined): string {
  if (!partialJson || !partialJson.trim()) return '';

  const trimmed = partialJson.trim();

  // If it doesn't look like JSON (starts with {), just return it as is
  if (!trimmed.startsWith('{')) {
    return trimmed;
  }

  // Matches "reasoning": " followed by any characters until the end OR an unescaped double quote
  // The ([^"\\]*(?:\\.[^"\\]*)*) part matches a string with escapes
  const regex = /"reasoning"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"?/;
  const match = partialJson.match(regex);
  if (match) {
    return (match[1] || '')
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  }

  // If we found the "reasoning" key but no value yet, return empty
  if (partialJson.includes('"reasoning"')) {
    return '';
  }

  // Otherwise return empty as we are likely still in other fields
  return '';
}

// ============================================================================
// Message Display Utilities
// ============================================================================

import type { ChatMessage } from './types';

// Tool output type alias
type ToolOutput = NonNullable<ChatMessage['tool_outputs']>[number];

// Segment types for rendering assistant messages
export type AssistantSegment =
  | { kind: 'text'; text: string }
  | { kind: 'tool_call'; toolCall: any; outputs: ToolOutput[] }
  | { kind: 'images'; images: ImageContent[] };

/**
 * Format usage label from token usage data
 */
export function formatUsageLabel(usage?: ChatMessage['usage']): string | null {
  if (!usage) return null;
  const prompt = usage.prompt_tokens;
  const completion = usage.completion_tokens;
  const total = usage.total_tokens;

  const hasPrompt = Number.isFinite(prompt);
  const hasCompletion = Number.isFinite(completion);
  const hasTotal = Number.isFinite(total);

  if (!hasPrompt && !hasCompletion && !hasTotal) return null;

  if (hasPrompt || hasCompletion) {
    const parts: string[] = [];
    if (hasPrompt) parts.push(`↑ ${prompt}`);
    if (hasCompletion) parts.push(`↓ ${completion}`);
    if (hasTotal && !(hasPrompt && hasCompletion && prompt! + completion! === total)) {
      parts.push(`⇅ ${total}`);
    }
    return parts.join(' · ');
  }

  return `⇅ ${total}`;
}

/**
 * Build assistant message segments for rendering
 * Handles interleaved text, tool calls, reasoning, and images
 */
export function buildAssistantSegments(message: ChatMessage): AssistantSegment[] {
  if (message.role !== 'assistant') {
    const textContent = extractTextFromContent(message.content);
    if (textContent) {
      return [{ kind: 'text', text: textContent }];
    }
    return [];
  }

  const content = extractTextFromContent(message.content);
  const imageContents = extractImagesFromContent(message.content);
  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  const toolOutputs = Array.isArray(message.tool_outputs) ? message.tool_outputs : [];
  const messageEvents = Array.isArray(message.message_events) ? message.message_events : [];

  // Helper to resolve outputs for a tool call
  const resolveOutputs = (call: any): ToolOutput[] => {
    return toolOutputs.filter((out) => {
      if (!out) return false;
      if (out.tool_call_id && call?.id) return out.tool_call_id === call.id;
      if (out.name && call?.function?.name) return out.name === call.function.name;
      return false;
    });
  };

  // Check if any tool call has a valid textOffset
  const hasValidTextOffset = toolCalls.some(
    (call: any) =>
      typeof call?.textOffset === 'number' &&
      Number.isFinite(call.textOffset) &&
      call.textOffset > 0
  );

  // Helper to append image segment to end if present
  const appendImagesSegment = (segments: AssistantSegment[]): AssistantSegment[] => {
    if (imageContents.length > 0) {
      segments.push({ kind: 'images', images: imageContents });
    }
    return segments;
  };

  if (messageEvents.length > 0) {
    const sortedEvents = [...messageEvents].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
    const segments: AssistantSegment[] = [];

    for (const event of sortedEvents) {
      if (event.type === 'content') {
        const text = typeof event.payload?.text === 'string' ? event.payload.text : '';
        if (text) {
          segments.push({ kind: 'text', text });
        }
        continue;
      }

      if (event.type === 'reasoning') {
        const text = typeof event.payload?.text === 'string' ? event.payload.text : '';
        if (text) {
          segments.push({ kind: 'text', text: `<thinking>${text}</thinking>` });
        }
        continue;
      }

      if (event.type === 'tool_call') {
        const toolCallId = event.payload?.tool_call_id;
        const toolCallIndex = event.payload?.tool_call_index;
        const toolCall =
          (toolCallId ? toolCalls.find((call: any) => call?.id === toolCallId) : undefined) ||
          (typeof toolCallIndex === 'number'
            ? toolCalls.find((call: any) => (call?.index ?? 0) === toolCallIndex)
            : undefined);

        if (toolCall) {
          segments.push({ kind: 'tool_call', toolCall, outputs: resolveOutputs(toolCall) });
        }
      }
    }

    if (segments.length > 0) {
      return appendImagesSegment(segments);
    }
  }

  if (toolCalls.length === 0) {
    const segments: AssistantSegment[] = content ? [{ kind: 'text', text: content }] : [];
    return appendImagesSegment(segments);
  }

  // For loaded conversations (no valid textOffset), show tools first, then content
  if (!hasValidTextOffset) {
    const segments: AssistantSegment[] = [];

    // Add all tool calls at the beginning
    const sortedCalls = toolCalls
      .map((call: any, idx: number) => ({
        idx,
        call,
        order: typeof call?.index === 'number' ? call.index : idx,
      }))
      .sort((a, b) => a.order - b.order);

    for (const entry of sortedCalls) {
      segments.push({
        kind: 'tool_call',
        toolCall: entry.call,
        outputs: resolveOutputs(entry.call),
      });
    }

    // Add content after tool calls
    if (content) {
      segments.push({ kind: 'text', text: content });
    }

    return appendImagesSegment(segments);
  }

  // For streaming messages with textOffset, use position-based rendering
  const sortedCalls = toolCalls
    .map((call: any, idx: number) => {
      const offset =
        typeof call?.textOffset === 'number' && Number.isFinite(call.textOffset)
          ? Math.max(0, Math.min(call.textOffset, content.length))
          : undefined;
      return {
        idx,
        call,
        offset,
        order: typeof call?.index === 'number' ? call.index : idx,
      };
    })
    .sort((a, b) => {
      const aOffset = a.offset ?? content.length;
      const bOffset = b.offset ?? content.length;
      if (aOffset !== bOffset) return aOffset - bOffset;
      return a.order - b.order;
    });

  const segments: AssistantSegment[] = [];
  let cursor = 0;

  for (const entry of sortedCalls) {
    const offset = entry.offset ?? content.length;
    const normalized = Math.max(0, Math.min(offset, content.length));
    const sliceEnd = Math.max(cursor, normalized);

    if (sliceEnd > cursor) {
      const textChunk = content.slice(cursor, sliceEnd);
      if (textChunk) {
        segments.push({ kind: 'text', text: textChunk });
      }
      cursor = sliceEnd;
    }

    segments.push({ kind: 'tool_call', toolCall: entry.call, outputs: resolveOutputs(entry.call) });
    cursor = Math.max(cursor, normalized);
  }

  if (cursor < content.length) {
    const remaining = content.slice(cursor);
    if (remaining) {
      segments.push({ kind: 'text', text: remaining });
    }
  }

  if (segments.length === 0 && content) {
    segments.push({ kind: 'text', text: content });
  }

  return appendImagesSegment(segments);
}
