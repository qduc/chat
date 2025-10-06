import { useState, useCallback, useMemo } from 'react';
import type { ChatMessage } from '../lib/chat';
import { ConversationManager } from '../lib/chat';
import { extractImagesFromContent, createMixedContent } from '../lib/chat/content-utils';

export interface UseMessageEditingReturn {
  editingMessageId: string | null;
  editingContent: string;
  setEditingContent: (content: string) => void;
  handleEditMessage: (messageId: string, content: string) => void;
  handleCancelEdit: () => void;
  handleSaveEdit: (
    conversationId: string | null,
    onMessagesUpdate: React.Dispatch<React.SetStateAction<ChatMessage[]>>,
    onAfterSave: (baseMessages: ChatMessage[], newConversationId?: string) => Promise<void> | void
  ) => Promise<void>;
}

export function useMessageEditing(): UseMessageEditingReturn {
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState<string>('');

  // Create conversation manager instance
  const conversationManager = useMemo(() => new ConversationManager(), []);

  const handleEditMessage = useCallback((messageId: string, content: string) => {
    setEditingMessageId(messageId);
    setEditingContent(content);
  }, []);

  const handleCancelEdit = useCallback(() => {
    setEditingMessageId(null);
    setEditingContent('');
  }, []);

  const handleSaveEdit = useCallback(async (
    conversationId: string | null,
    onMessagesUpdate: React.Dispatch<React.SetStateAction<ChatMessage[]>>,
    onAfterSave: (baseMessages: ChatMessage[], newConversationId?: string) => Promise<void> | void
  ) => {
    if (!editingMessageId || !editingContent.trim()) return;

    const messageId = editingMessageId;
    const newTextContent = editingContent.trim();

    // Get the original message to preserve its images and seq
    let originalMessage: ChatMessage | undefined;
    onMessagesUpdate(prev => {
      originalMessage = prev.find(m => m.id === messageId);
      return prev;
    });

    if (!originalMessage) return;

    // Extract existing images from the original message
    const existingImages = extractImagesFromContent(originalMessage.content);

    // Create new content that combines updated text with existing images
    const newContent = existingImages.length > 0
      ? createMixedContent(newTextContent, existingImages)
      : newTextContent;

    // Optimistically exit edit mode and update message immediately
    const oldContent = originalMessage.content;
    onMessagesUpdate(prev => {
      return prev.map(m => m.id === messageId ? { ...m, content: newContent } : m);
    });
    setEditingMessageId(null);
    setEditingContent('');

    // If we have a saved conversation AND the message has a valid seq, persist the edit and then fork/trim server-side
    if (conversationId && originalMessage.seq !== undefined) {
      try {
        // Get the expected seq from the original message (required for intent)
        const expectedSeq = originalMessage.seq;
        const result = await conversationManager.editMessage(conversationId, messageId, newContent, expectedSeq);
        const newId = result?.new_conversation_id;
        // Clear all messages after the edited one locally (server also trims)
        let baseMessages: ChatMessage[] = [];
        onMessagesUpdate(prev => {
          const idx = prev.findIndex(m => m.id === messageId);
          if (idx === -1) { baseMessages = prev; return prev; }
          baseMessages = prev.slice(0, idx + 1);
          return baseMessages;
        });
        // Allow caller to trigger regeneration with the base messages
        await onAfterSave(baseMessages, newId);
      } catch (e: any) {
        // If history/edit endpoint is not available, fallback to local behavior
        if (e?.status === 501) {
          let baseMessages: ChatMessage[] = [];
          onMessagesUpdate(prev => {
            const idx = prev.findIndex(m => m.id === messageId);
            if (idx === -1) { baseMessages = prev; return prev; }
            baseMessages = prev.slice(0, idx + 1);
            return baseMessages;
          });
          await onAfterSave(baseMessages);
        } else {
          // Revert optimistic update and restore edit state
          onMessagesUpdate(prev => prev.map(m => m.id === messageId ? { ...m, content: oldContent } : m));
          setEditingMessageId(messageId);
          setEditingContent(newTextContent);
          console.error('Failed to edit message:', e);
        }
      }
      return;
    }

    // Unsaved (ephemeral) conversation: trim locally and regenerate without persistence
    let baseMessages: ChatMessage[] = [];
    onMessagesUpdate(prev => {
      const idx = prev.findIndex(m => m.id === messageId);
      if (idx === -1) { baseMessages = prev; return prev; }
      baseMessages = prev.slice(0, idx + 1);
      return baseMessages;
    });
    await onAfterSave(baseMessages);
  }, [editingMessageId, editingContent, conversationManager]);

  return {
    editingMessageId,
    editingContent,
    setEditingContent,
    handleEditMessage,
    handleCancelEdit,
    handleSaveEdit
  };
}
