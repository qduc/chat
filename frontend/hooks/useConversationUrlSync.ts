import { useCallback, useEffect, useRef } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

interface UseConversationUrlSyncOptions {
  conversationId: string | null;
  selectConversation: (id: string) => Promise<void>;
  newChat: () => void;
  refreshConversations: () => void;
}

interface UseConversationUrlSyncReturn {
  /**
   * Whether a conversation is currently being loaded (e.g. from URL or sidebar click).
   * Consumers may use this to trigger scroll-to-bottom after render.
   */
  isLoadingConversation: boolean;
  /** Mark the loading flag (e.g. when the user clicks a sidebar item). */
  markLoadingConversation: () => void;
  /** Clear the loading flag (e.g. after scroll-to-bottom completes). */
  clearLoadingConversation: () => void;
}

/**
 * Keeps the browser URL in sync with the active conversation and handles
 * initial hydration from the URL on first mount plus history
 * back/forward navigation.
 */
export function useConversationUrlSync({
  conversationId,
  selectConversation,
  newChat,
  refreshConversations,
}: UseConversationUrlSyncOptions): UseConversationUrlSyncReturn {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchKey = searchParams?.toString();

  const initCheckedRef = useRef(false);
  const initLoadingRef = useRef(false);
  const isLoadingConversationRef = useRef(false);

  // Load conversations and hydrate from URL on first load
  useEffect(() => {
    if (initCheckedRef.current) return;
    initCheckedRef.current = true;

    // Load conversation list
    refreshConversations();

    const cid = searchParams?.get('c');
    if (cid && !conversationId) {
      initLoadingRef.current = true;
      isLoadingConversationRef.current = true;
      (async () => {
        try {
          await selectConversation(cid);
        } finally {
          initLoadingRef.current = false;
        }
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Respond to URL changes (e.g., back/forward) to drive state
  useEffect(() => {
    if (!searchParams) return;
    if (initLoadingRef.current) return;
    const cid = searchParams.get('c');
    if (cid && cid !== conversationId) {
      isLoadingConversationRef.current = true;
      void selectConversation(cid);
    } else if (!cid && conversationId) {
      newChat();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchKey]);

  // Keep URL in sync with selected conversation
  useEffect(() => {
    if (!initCheckedRef.current || initLoadingRef.current) return;
    const params = new URLSearchParams(searchParams?.toString());
    if (conversationId) {
      if (params.get('c') !== conversationId) {
        params.set('c', conversationId);
        router.push(`${pathname}?${params.toString()}`);
      }
    } else {
      if (params.has('c')) {
        params.delete('c');
        const q = params.toString();
        router.push(q ? `${pathname}?${q}` : pathname);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  const markLoadingConversation = useCallback(() => {
    isLoadingConversationRef.current = true;
  }, []);

  const clearLoadingConversation = useCallback(() => {
    isLoadingConversationRef.current = false;
  }, []);

  return {
    get isLoadingConversation() {
      return isLoadingConversationRef.current;
    },
    markLoadingConversation,
    clearLoadingConversation,
  };
}
