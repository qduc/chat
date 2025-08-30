import React from 'react';

interface RightSidebarProps {
  systemPrompt: string;
  onSystemPromptChange: (v: string) => void;
}

export function RightSidebar({ systemPrompt, onSystemPromptChange }: RightSidebarProps) {
  return (
    <aside className="w-72 p-4 flex flex-col border-l border-slate-200/50 dark:border-neutral-800/50 bg-white/30 dark:bg-neutral-950/30 backdrop-blur-sm shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-semibold text-slate-700 dark:text-slate-300">System Prompt</div>
      </div>
      <div className="flex-1">
        <textarea
          className="w-full h-full min-h-[160px] resize-none p-3 rounded-lg border border-slate-200 dark:border-neutral-800 bg-white/70 dark:bg-neutral-900/60 text-sm text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-300"
          value={systemPrompt}
          onChange={e => onSystemPromptChange(e.target.value)}
          placeholder="Enter a system prompt to guide the model (will be prepended to messages)">
        </textarea>
      </div>
      <div className="mt-3 text-xs text-slate-500 dark:text-slate-400">This prompt will be available to the model for the current session.</div>
    </aside>
  );
}
