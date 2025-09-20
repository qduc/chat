import React, { useCallback, useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface RightSidebarProps {
  systemPrompt: string;
  onSystemPromptChange: (v: string) => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

const STORAGE_KEY = 'systemPrompt';

export function RightSidebar({ systemPrompt, onSystemPromptChange, collapsed = false, onToggleCollapse }: RightSidebarProps) {
  // Load saved prompt from localStorage on mount if the prop is empty
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved && !systemPrompt) {
        onSystemPromptChange(saved);
      }
    } catch (e) {
      // ignore localStorage errors (e.g. private mode)
    }
    // we only want to run this on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleChange = useCallback(
    (v: string) => {
      try {
        if (typeof window !== 'undefined') {
          localStorage.setItem(STORAGE_KEY, v);
        }
      } catch (e) {
        // ignore storage errors
      }
      onSystemPromptChange(v);
    },
    [onSystemPromptChange]
  );

  return (
    <aside className={`${collapsed ? 'w-16' : 'w-72'} z-30 p-4 flex flex-col bg-white/60 dark:bg-neutral-900/60 backdrop-blur-sm transition-all duration-300 ease-in-out relative`}>
      {/* Collapse/Expand Button */}
      <button
        className="absolute -left-3 top-6 z-10 w-6 h-6 rounded-full bg-white dark:bg-neutral-800 border border-slate-200 dark:border-neutral-700 shadow-sm hover:shadow-md transition-all duration-200 flex items-center justify-center text-slate-600 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300"
        onClick={onToggleCollapse}
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {collapsed ? <ChevronLeft className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
      </button>

      {collapsed ? (
        // Collapsed state - minimal UI
        <div className="flex flex-col items-center space-y-4">
          <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-neutral-800 border border-slate-200 dark:border-slate-100 text-slate-700 dark:text-slate-300 flex items-center justify-center">
            <span className="text-xs font-semibold">SP</span>
          </div>
        </div>
      ) : (
        // Expanded state - full UI
        <>
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-semibold text-slate-700 dark:text-slate-300">System Prompt</div>
          </div>
          <div className="flex-1">
            <textarea
              className="w-full h-full min-h-[160px] resize-none p-3 rounded-lg border border-slate-200 dark:border-neutral-800 bg-white/70 dark:bg-neutral-900/60 text-sm text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-300"
              value={systemPrompt}
              onChange={e => handleChange(e.target.value)}
              placeholder="Enter a system prompt to guide the model (will be prepended to messages)">
            </textarea>
          </div>
          <div className="mt-3 text-xs text-slate-500 dark:text-slate-400">This prompt will be available to the model for the current session.</div>
        </>
      )}
    </aside>
  );
}
