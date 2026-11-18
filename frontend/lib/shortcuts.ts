import { useSyncExternalStore } from 'react';

function isMac(): boolean {
  if (typeof navigator === 'undefined') return false;
  const platform =
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ??
    navigator.platform ??
    '';
  return /mac|iphone|ipad/i.test(platform);
}

const noSubscribe = () => () => {};

/** "⌘" on Apple platforms, "Ctrl" elsewhere ("Ctrl" in the static prerender). */
export function useModKey(): string {
  return useSyncExternalStore(
    noSubscribe,
    () => (isMac() ? '⌘' : 'Ctrl'),
    () => 'Ctrl'
  );
}

/** Shortcut text for the sidebar toggles, matching ChatV2's key handler. */
export function sidebarShortcut(mod: string, panel: 'history' | 'details'): string {
  if (mod === '⌘') return panel === 'history' ? '⌘\\' : '⇧⌘\\';
  return panel === 'history' ? `${mod}+\\` : `${mod}+Shift+\\`;
}
