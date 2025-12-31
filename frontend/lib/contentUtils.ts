/**
 * Message content transformation utilities
 * Handles text, image, and file content in messages
 */

import type { MessageContent, TextContent, ImageContent, FileContent } from './types';

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
      return true; // Keep all image items
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
