/**
 * Images and text files attached to (or generated in) a conversation's messages.
 *
 * Data comes from `message.content`:
 *  - images: `{ type: 'image_url', image_url: { url } }` parts (`extractImagesFromContent`)
 *  - files: `File: <name>\n```lang\n...```` blocks in the text (`extractFilesFromText`)
 */
import type { ChatMessage } from './types';
import { extractImagesFromContent, extractFilesAndText } from './contentUtils';

export type ConversationFile =
  | { kind: 'image'; key: string; messageId: string; url: string }
  | {
      kind: 'file';
      key: string;
      messageId: string;
      name: string;
      language: string;
      content: string;
    };

function imageUrlOf(part: unknown): string {
  const imageUrl = (part as { image_url?: unknown })?.image_url;
  if (typeof imageUrl === 'string') return imageUrl;
  if (imageUrl && typeof imageUrl === 'object') {
    const url = (imageUrl as { url?: unknown }).url;
    return typeof url === 'string' ? url : '';
  }
  return '';
}

export function extractFiles(messages: ChatMessage[]): ConversationFile[] {
  const items: ConversationFile[] = [];
  for (const message of messages) {
    if (message.role !== 'user' && message.role !== 'assistant') continue;
    const content = message.content;
    if (!content) continue;

    const { files } = extractFilesAndText(content);
    files.forEach((file, index) => {
      items.push({
        kind: 'file',
        key: `${message.id}:file:${index}`,
        messageId: message.id,
        name: file.name,
        language: file.language,
        content: file.content,
      });
    });

    extractImagesFromContent(content).forEach((part, index) => {
      const url = imageUrlOf(part);
      if (!url) return;
      items.push({
        kind: 'image',
        key: `${message.id}:image:${index}`,
        messageId: message.id,
        url,
      });
    });
  }
  return items;
}
