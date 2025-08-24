import { useState, useCallback, useEffect } from 'react';
import type { ConversationMeta } from '../lib/chat';
import { listConversationsApi, deleteConversationApi } from '../lib/chat';

export interface UseConversationsReturn {
  conversations: ConversationMeta[];
  nextCursor: string | null;
  loadingConversations: boolean;
  historyEnabled: boolean;
  setHistoryEnabled: (enabled: boolean) => void;
  loadMoreConversations: () => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  addConversation: (conversation: ConversationMeta) => void;
  refreshConversations: () => Promise<void>;
}

export function useConversations(): UseConversationsReturn {
  const [conversations, setConversations] = useState<ConversationMeta[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingConversations, setLoadingConversations] = useState<boolean>(false);
  const [historyEnabled, setHistoryEnabled] = useState<boolean>(true);

  const loadMoreConversations = useCallback(async () => {
    if (!nextCursor || loadingConversations) return;
    setLoadingConversations(true);
    try {
      const list = await listConversationsApi(undefined, { cursor: nextCursor, limit: 20 });
      setConversations(prev => [...prev, ...list.items]);
      setNextCursor(list.next_cursor);
    } catch (e: any) {
      // ignore
    } finally {
      setLoadingConversations(false);
    }
  }, [nextCursor, loadingConversations]);

  const deleteConversation = useCallback(async (id: string) => {
    try {
      await deleteConversationApi(undefined, id);
      setConversations(prev => prev.filter(c => c.id !== id));
    } catch (e: any) {
      // ignore
    }
  }, []);

  const addConversation = useCallback((conversation: ConversationMeta) => {
    setConversations(prev => [conversation, ...prev]);
  }, []);

  const refreshConversations = useCallback(async () => {
    try {
      setLoadingConversations(true);
      const list = await listConversationsApi(undefined, { limit: 20 });
      setConversations(list.items);
      setNextCursor(list.next_cursor);
      setHistoryEnabled(true);
    } catch (e: any) {
      if (e.status === 501) {
        setHistoryEnabled(false);
      }
    } finally {
      setLoadingConversations(false);
    }
  }, []);

  // Load initial conversations to detect history support
  useEffect(() => {
    // Defer to next tick to avoid React act warnings in tests when updating state during mount
    const t = setTimeout(() => {
      refreshConversations();
    }, 0);
    return () => clearTimeout(t);
  }, [refreshConversations]);

  return {
    conversations,
    nextCursor,
    loadingConversations,
    historyEnabled,
    setHistoryEnabled,
    loadMoreConversations,
    deleteConversation,
    addConversation,
    refreshConversations
  };
}