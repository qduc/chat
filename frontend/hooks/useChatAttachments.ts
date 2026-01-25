import { useState, useCallback } from 'react';
import type { AudioAttachment, MessageContent } from '../lib/types';
import { attachmentToInputAudioPart } from '../lib/audioUtils';

/**
 * Hook for managing chat attachments (images, audio, files).
 *
 * Handles:
 * - Image attachments with URL handling
 * - Audio attachments with blob URL management and cleanup
 * - File attachments with content extraction
 * - Building multimodal message content from attachments
 *
 * @returns Attachment state and utilities:
 * - `images` / `setImages`: Image attachment array
 * - `audios` / `setAudios`: Audio attachment array (blob URLs auto-revoked)
 * - `files` / `setFiles`: File attachment array
 * - `clearAttachments()`: Clear all attachments and revoke blob URLs
 * - `buildMessageContent(text)`: Build MessageContent from text + attachments
 */
export function useChatAttachments() {
  const [images, setImages] = useState<any[]>([]);
  const [audios, setAudios] = useState<AudioAttachment[]>([]);
  const [files, setFiles] = useState<any[]>([]);

  const clearAttachments = useCallback(() => {
    setImages([]);
    // Revoke audio blob URLs to avoid leaks
    setAudios((prev) => {
      try {
        prev.forEach((a) => {
          if (a?.url && typeof URL !== 'undefined') URL.revokeObjectURL(a.url);
        });
      } catch {
        // ignore
      }
      return [];
    });
    setFiles([]);
  }, []);

  /**
   * Helper to build message content from text and current attachments
   */
  const buildMessageContent = useCallback(
    async (text: string): Promise<MessageContent> => {
      let finalMessageText = text;

      // Prepend file contents to message text if present
      if (files.length > 0) {
        const fileContexts = files
          .map((f) => {
            const ext = f.name.split('.').pop()?.toLowerCase() || '';
            const langMap: Record<string, string> = {
              js: 'javascript',
              jsx: 'javascript',
              ts: 'typescript',
              tsx: 'typescript',
              py: 'python',
              rb: 'ruby',
              java: 'java',
              cpp: 'cpp',
              c: 'c',
              go: 'go',
              rs: 'rust',
              sh: 'bash',
              bash: 'bash',
              json: 'json',
              xml: 'xml',
              yaml: 'yaml',
              yml: 'yaml',
              md: 'markdown',
              html: 'html',
              css: 'css',
              scss: 'scss',
              sql: 'sql',
              graphql: 'graphql',
            };
            const language = langMap[ext] || ext;
            return `File: ${f.name}\n\`\`\`${language}\n${f.content || ''}\n\`\`\``;
          })
          .join('\n\n');

        finalMessageText = fileContexts + '\n\n' + text;
      }

      // Convert images + audio to content format if present
      if (images.length > 0 || audios.length > 0) {
        const contentParts: any[] = [];
        if (finalMessageText.trim().length > 0) {
          contentParts.push({ type: 'text', text: finalMessageText });
        }

        for (const img of images) {
          contentParts.push({
            type: 'image_url',
            image_url: { url: img.downloadUrl || img.url },
          });
        }

        if (audios.length > 0) {
          const audioParts = await Promise.all(audios.map((a) => attachmentToInputAudioPart(a)));
          contentParts.push(...audioParts);
        }

        return contentParts.length > 0 ? contentParts : '';
      }

      return finalMessageText;
    },
    [images, audios, files]
  );

  return {
    images,
    setImages,
    audios,
    setAudios,
    files,
    setFiles,
    clearAttachments,
    buildMessageContent,
  };
}
