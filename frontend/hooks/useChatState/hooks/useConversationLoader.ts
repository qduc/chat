/**
 * Conversation loader hook
 *
 * Manages conversation list loading, pagination, and state management.
 * Handles both authenticated and unauthenticated states, plus backend
 * conversation history feature detection.
 *
 * @module useConversationLoader
 */

import { useCallback, useEffect, useMemo } from 'react';
import type { ChatAction } from '../types';
import { ConversationManager } from '../../../lib/chat';

/**
 * Props for the useConversationLoader hook
 */
export interface UseConversationLoaderProps {
  /** Whether authentication is ready */
  authReady: boolean;
  /** Current authenticated user */
  user: any;
  /** Dispatch function for chat state updates */
  dispatch: React.Dispatch<ChatAction>;
}

/**
 * Hook for loading and managing conversations
 *
 * Handles fetching conversation list, pagination,
 * and managing conversation state.
 *
 * @param props - Configuration object
 * @returns Object containing conversation manager and refresh function
 *
 * @example
 * ```typescript
 * const { conversationManager, refreshConversations } = useConversationLoader({
 *   authReady,
 *   user,
 *   dispatch
 * });
 *
 * await refreshConversations();
 * const conv = await conversationManager.get('conv-123');
 * ```
 */
export function useConversationLoader({ authReady, user, dispatch }: UseConversationLoaderProps) {
  const conversationManager = useMemo(() => new ConversationManager(), []);

  const refreshConversations = useCallback(async () => {
    if (!authReady) {
      return;
    }

    if (!user) {
      dispatch({
        type: 'LOAD_CONVERSATIONS_SUCCESS',
        payload: { conversations: [], nextCursor: null, replace: true }
      });
      dispatch({ type: 'SET_HISTORY_ENABLED', payload: false });
      return;
    }

    try {
      dispatch({ type: 'LOAD_CONVERSATIONS_START' });
      const list = await conversationManager.list({ limit: 20 });
      dispatch({
        type: 'LOAD_CONVERSATIONS_SUCCESS',
        payload: { conversations: list.items, nextCursor: list.next_cursor, replace: true }
      });
      dispatch({ type: 'SET_HISTORY_ENABLED', payload: true });
    } catch (e: any) {
      if (e.status === 501) {
        dispatch({ type: 'SET_HISTORY_ENABLED', payload: false });
      }
      dispatch({ type: 'LOAD_CONVERSATIONS_ERROR' });
    }
  }, [authReady, user, conversationManager, dispatch]);

  // Initialize conversations on first render
  useEffect(() => {
    if (!authReady) {
      return;
    }
    const timer = setTimeout(() => {
      void refreshConversations();
    }, 0);
    return () => clearTimeout(timer);
  }, [authReady, refreshConversations]);

  return { conversationManager, refreshConversations };
}
