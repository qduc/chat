import { useState, useCallback } from 'react';
import type { ChatMessage } from '../lib/chat';
import { editMessageApi, getConversationApi } from '../lib/chat';

export interface UseMessageEditingReturn {
  editingMessageId: string | null;
  editingContent: string;
  setEditingContent: (content: string) => void;
  handleEditMessage: (messageId: string, content: string) => void;
  handleCancelEdit: () => void;
  handleSaveEdit: (
    conversationId: string,
    onConversationSwitch: (newConversationId: string) => void,
    onMessagesUpdate: React.Dispatch<React.SetStateAction<ChatMessage[]>>,
    onConversationAdd: (conversation: { id: string; title: string; model: string; created_at: string }) => void
  ) => Promise<void>;
}

export function useMessageEditing(): UseMessageEditingReturn {
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState<string>('');

  const handleEditMessage = useCallback((messageId: string, content: string) => {
    setEditingMessageId(messageId);
    setEditingContent(content);
  }, []);

  const handleCancelEdit = useCallback(() => {
    setEditingMessageId(null);
    setEditingContent('');
  }, []);

  const handleSaveEdit = useCallback(async (
    conversationId: string,
    onConversationSwitch: (newConversationId: string) => void,
    onMessagesUpdate: React.Dispatch<React.SetStateAction<ChatMessage[]>>,
    onConversationAdd: (conversation: { id: string; title: string; model: string; created_at: string }) => void
  ) => {
    if (!editingMessageId || !conversationId || !editingContent.trim()) return;
    // Keep local copies so we can restore if the API call fails
    const messageId = editingMessageId;
    const newContent = editingContent.trim();
    let prevSnapshot: ChatMessage[] = [];

    // Optimistically update the message immediately for snappy UI
    onMessagesUpdate(prev => {
      prevSnapshot = prev.slice();
      return prev.map(m => m.id === messageId ? { ...m, content: newContent } : m);
    });

    // Clear editing UI immediately (optimistic)
    setEditingMessageId(null);
    setEditingContent('');

    // Optimistically switch to a temporary forked conversation so the UI feels immediate
    const tempConvoId = `pending-fork-${crypto.randomUUID()}`;
    onConversationSwitch(tempConvoId);
    onConversationAdd({ id: tempConvoId, title: 'Edited (saving...)', model: 'gpt-4o', created_at: new Date().toISOString() });

    try {
      const result = await editMessageApi(undefined, conversationId, messageId, newContent);

      // Switch to the real new forked conversation
      onConversationSwitch(result.new_conversation_id);

      // Fetch the full new conversation messages and replace local messages to stay consistent
      try {
        const newConvo = await getConversationApi(undefined, result.new_conversation_id, { limit: 200 });
        const msgs = newConvo.messages.map(m => ({ id: String(m.id), role: m.role as any, content: m.content || '' }));
        onMessagesUpdate(() => msgs as ChatMessage[]);
        onConversationAdd({
          id: result.new_conversation_id,
          title: newConvo.title || 'Edited conversation',
          model: newConvo.model || 'gpt-4o',
          created_at: newConvo.created_at
        });
      } catch (e) {
        // If fetching the forked conversation fails, keep optimistic update and still add conversation metadata
        onConversationAdd({ id: result.new_conversation_id, title: 'Edited conversation', model: 'gpt-4o', created_at: new Date().toISOString() });
      }
    } catch (e: any) {
      // Revert optimistic update on error and restore editing UI so user can retry; also switch back to original conversation
      console.error('Failed to edit message:', e);
      onMessagesUpdate(() => prevSnapshot);
      onConversationSwitch(conversationId);
      setEditingMessageId(messageId);
      setEditingContent(newContent);
    }
  }, [editingMessageId, editingContent]);

  return {
    editingMessageId,
    editingContent,
    setEditingContent,
    handleEditMessage,
    handleCancelEdit,
    handleSaveEdit
  };
}