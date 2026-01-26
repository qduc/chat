import { useState, useCallback, useRef, useEffect } from 'react';
import { conversations as conversationsApi } from '../lib';
import { convertConversationMeta } from '../lib';
import type { Conversation } from '../lib';

/**
 * Hook for managing the conversations list and selection.
 *
 * Handles:
 * - Fetching and caching conversation list with pagination
 * - Conversation CRUD operations
 * - Current conversation ID tracking
 *
 * @returns Conversation state and actions:
 * - `conversations` / `setConversations`: List of conversation metadata
 * - `conversationId` / `setConversationId`: Currently selected conversation
 * - `conversationIdRef`: Ref for accessing ID in callbacks
 * - `currentConversationTitle`: Title of selected conversation
 * - `nextCursor`: Pagination cursor for loading more
 * - `loadingConversations`: Loading state flag
 * - `refreshConversations()`: Reload the conversation list
 * - `loadMoreConversations()`: Load next page of conversations
 * - `deleteConversation(id)`: Delete a conversation
 *
 * Note: Initial load is handled by the consuming component (ChatV2)
 * to avoid double-fetching when composed with useChat.
 */
export function useConversations() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const conversationIdRef = useRef<string | null>(null);

  useEffect(() => {
    conversationIdRef.current = conversationId;
  }, [conversationId]);

  const [currentConversationTitle, setCurrentConversationTitle] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingConversations, setLoadingConversations] = useState(false);

  const refreshConversations = useCallback(async () => {
    try {
      setLoadingConversations(true);
      const data = await conversationsApi.list();
      setConversations(data.items.map(convertConversationMeta));
      setNextCursor(data.next_cursor);
    } catch (err) {
      console.error('Failed to refresh conversations:', err);
    } finally {
      setLoadingConversations(false);
    }
  }, []);

  const loadMoreConversations = useCallback(async () => {
    if (!nextCursor || loadingConversations) return;
    try {
      setLoadingConversations(true);
      const data = await conversationsApi.list({ cursor: nextCursor, limit: 20 });
      setConversations((prev) => [...prev, ...data.items.map(convertConversationMeta)]);
      setNextCursor(data.next_cursor);
    } catch (err) {
      console.error('Failed to load conversations:', err);
    } finally {
      setLoadingConversations(false);
    }
  }, [nextCursor, loadingConversations]);

  const deleteConversation = useCallback(async (id: string) => {
    try {
      await conversationsApi.delete(id);
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (conversationIdRef.current === id) {
        setConversationId(null);
        setCurrentConversationTitle(null);
      }
    } catch (err) {
      console.error('Failed to delete conversation:', err);
      throw err;
    }
  }, []);

  // NOTE: Initial load is handled by the consuming component (ChatV2)
  // to avoid double-fetching when composed with useChat

  return {
    conversations,
    setConversations,
    conversationId,
    setConversationId,
    conversationIdRef,
    currentConversationTitle,
    setCurrentConversationTitle,
    nextCursor,
    loadingConversations,
    refreshConversations,
    loadMoreConversations,
    deleteConversation,
  };
}
