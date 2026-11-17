import { useCallback, useState } from 'react';

export type DetailsSectionId = 'prompt' | 'chat' | 'usage' | 'sources' | 'files' | 'memory';

export type DetailsSectionsState = Record<DetailsSectionId, boolean>;

export const DETAILS_SECTIONS_STORAGE_KEY = 'chatDetailsSections';

export const DEFAULT_DETAILS_SECTIONS: DetailsSectionsState = {
  prompt: true,
  chat: true,
  usage: true,
  sources: true,
  files: false,
  memory: false,
};

function readStored(): DetailsSectionsState {
  try {
    const raw = window.localStorage.getItem(DETAILS_SECTIONS_STORAGE_KEY);
    if (!raw) return DEFAULT_DETAILS_SECTIONS;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return DEFAULT_DETAILS_SECTIONS;
    const next = { ...DEFAULT_DETAILS_SECTIONS };
    for (const key of Object.keys(next) as DetailsSectionId[]) {
      if (typeof parsed[key] === 'boolean') next[key] = parsed[key];
    }
    return next;
  } catch {
    return DEFAULT_DETAILS_SECTIONS;
  }
}

/** Which chat-details sections are expanded, remembered in localStorage. */
export function useDetailsSections() {
  const [open, setOpen] = useState<DetailsSectionsState>(() =>
    typeof window === 'undefined' ? DEFAULT_DETAILS_SECTIONS : readStored()
  );

  const toggle = useCallback((id: DetailsSectionId) => {
    setOpen((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try {
        window.localStorage.setItem(DETAILS_SECTIONS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Storage can be unavailable (private mode, quota); the state still updates.
      }
      return next;
    });
  }, []);

  return { open, toggle };
}
