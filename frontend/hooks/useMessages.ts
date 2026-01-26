import { useState, useCallback, useRef, useEffect } from 'react';
import type { Message, MessageContent } from '../lib';
import { conversations as conversationsApi } from '../lib';

/**
 * Hook for managing message state and editing.
 *
 * @returns Message state and editing controls:
 * - `messages` / `setMessages`: The message array state
 * - `messagesRef`: Ref for accessing messages in callbacks without stale closures
 * - `editingMessageId` / `editingContent`: Current editing state
 * - `startEdit(id, content)`: Begin editing a message
 * - `cancelEdit()`: Cancel current edit
 * - `updateEditContent(content)`: Update the editing buffer
 *
 * Note: `saveEdit` is orchestrated in useChat because it has complex side effects
 * affecting conversationId and compareMode state.
 */
export function useMessages() {
  const [messages, setMessages] = useState<Message[]>([]);
  const messagesRef = useRef<Message[]>([]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState<string>('');

  const startEdit = useCallback((messageId: string, content: MessageContent) => {
    setEditingMessageId(messageId);
    // Convert MessageContent to string for editing
    const contentStr =
      typeof content === 'string'
        ? content
        : content
            .map((c: any) => {
              if (c?.type === 'text') return c.text;
              if (c?.type === 'image_url') return '[Image]';
              if (c?.type === 'input_audio') return '[Audio]';
              return '[Attachment]';
            })
            .join('\n');
    setEditingContent(contentStr);
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingMessageId(null);
    setEditingContent('');
  }, []);

  const updateEditContent = useCallback((content: string) => {
    setEditingContent(content);
  }, []);

  // Note: saveEdit is orchestrated in useChat because it has complex side effects
  // affecting conversationId and compareMode state.

  return {
    // State
    messages,
    messagesRef,
    editingMessageId,
    editingContent,

    // Setters
    setMessages,
    setEditingMessageId,
    setEditingContent,

    // Actions
    startEdit,
    cancelEdit,
    updateEditContent,
  };
}
