import { useRef, useEffect } from 'react';
import { getDraft, setDraft } from '../lib';

/** Debounce delay (ms) before persisting a draft to localStorage. */
const DRAFT_SAVE_DEBOUNCE_MS = 1000;

/**
 * Encapsulates draft-message persistence (restore on conversation change,
 * debounced save to localStorage).
 *
 * Behavior contract (must match prior inline implementation in useChat):
 *
 * **Restore**
 *  - When `conversationId` changes (including initial mount), the saved draft
 *    for that conversation is loaded via `getDraft`.
 *  - On the *very first* restoration (app boot) we only overwrite `input` if
 *    the current input is empty — this avoids clobbering a value that was
 *    already set by URL-based hydration or another initialiser.
 *  - On subsequent conversation switches, the draft always wins: if one exists
 *    we `setInput(saved)`, otherwise we clear the input.
 *
 * **Save**
 *  - While the user types, the draft is persisted after a 1 s debounce.
 *  - Empty input immediately clears the stored draft (no debounce needed).
 *
 * **New-chat**
 *  - Starting a new chat sets `conversationId` to `null`.  The draft for the
 *    *previous* conversation was already saved by the save effect, so it
 *    survives the switch.  We intentionally do *not* clear the old draft here.
 */
export function useDraftPersistence(
  userId: string | undefined,
  conversationId: string | null,
  input: string,
  setInput: (val: string) => void
): void {
  // Track the last conversation id for which we restored a draft so we only
  // restore once per conversation switch.
  const lastRestoredIdRef = useRef<string | null | undefined>(undefined);

  // --- Restore draft on conversation change ---
  useEffect(() => {
    if (!userId) return;
    if (lastRestoredIdRef.current === conversationId) return;

    const isFirstRestoration = lastRestoredIdRef.current === undefined;
    const saved = getDraft(userId, conversationId || '');
    if (saved) {
      if (!isFirstRestoration || input === '') {
        setInput(saved);
      }
    } else if (!isFirstRestoration && input !== '') {
      setInput('');
    }
    lastRestoredIdRef.current = conversationId;
  }, [userId, conversationId, setInput, input]);

  // --- Debounced save ---
  useEffect(() => {
    if (userId) {
      const currentConvId = conversationId || '';
      if (input === '') {
        setDraft(userId, currentConvId, '');
        return;
      }
      const t = setTimeout(() => {
        setDraft(userId, currentConvId, input);
      }, DRAFT_SAVE_DEBOUNCE_MS);
      return () => clearTimeout(t);
    }
  }, [input, userId, conversationId]);
}
