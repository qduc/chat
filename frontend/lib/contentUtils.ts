/**
 * Message content transformation utilities
 * Handles text and image content in messages
 */

import type { MessageContent, TextContent, ImageContent } from './types';

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
