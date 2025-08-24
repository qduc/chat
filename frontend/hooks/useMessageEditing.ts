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
    
    try {
      const result = await editMessageApi(undefined, conversationId, editingMessageId, editingContent.trim());
      
      // Update the message in the current conversation
      onMessagesUpdate(prev => prev.map(m => 
        m.id === editingMessageId ? { ...m, content: editingContent.trim() } : m
      ));
      
      // Switch to the new forked conversation
      onConversationSwitch(result.new_conversation_id);
      
      // Add the new conversation to the list at the top
      const newConvo = await getConversationApi(undefined, result.new_conversation_id, { limit: 1 });
      onConversationAdd({ 
        id: result.new_conversation_id, 
        title: newConvo.title || 'Edited conversation', 
        model: newConvo.model || 'gpt-4o', 
        created_at: newConvo.created_at 
      });
      
      setEditingMessageId(null);
      setEditingContent('');
    } catch (e: any) {
      console.error('Failed to edit message:', e);
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