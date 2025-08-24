interface ChatHeaderProps {
  model: string;
  useTools: boolean;
  isStreaming: boolean;
  onModelChange: (model: string) => void;
  onUseToolsChange: (useTools: boolean) => void;
  onNewChat: () => void;
  onStop: () => void;
}

export function ChatHeader({
  model,
  useTools,
  isStreaming,
  onModelChange,
  onUseToolsChange,
  onNewChat,
  onStop
}: ChatHeaderProps) {
  return (
    <header className="sticky top-0 z-10 border-b border-slate-200/60 dark:border-neutral-800/60 bg-white/80 dark:bg-neutral-950/80 backdrop-blur-md supports-[backdrop-filter]:bg-white/70 dark:supports-[backdrop-filter]:bg-neutral-950/70 shadow-sm">
      <div className="mx-auto max-w-4xl px-6 py-4 flex items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-slate-200 dark:bg-neutral-800 flex items-center justify-center shadow-sm">
            <svg className="w-4 h-4 text-slate-700 dark:text-slate-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
          </div>
          <h1 className="font-semibold text-xl text-slate-800 dark:text-slate-200">Chat</h1>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
            <span>Model:</span>
            <select 
              className="rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-neutral-900 border border-slate-200 dark:border-neutral-700 text-slate-700 dark:text-slate-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200" 
              value={model} 
              onChange={e => onModelChange(e.target.value)}
            >
              <option value="gpt-4.1-mini">GPT-4.1 Mini</option>
              <option value="gpt-4o-mini">GPT-4o Mini</option>
              <option value="gpt-4o">GPT-4o</option>
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400 select-none">
            <input 
              type="checkbox" 
              className="rounded border-slate-300 dark:border-neutral-700 text-blue-600 focus:ring-blue-500" 
              checked={useTools} 
              onChange={e => onUseToolsChange(e.target.checked)} 
            />
            Enable get_time tool
          </label>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <button 
            type="button" 
            onClick={onNewChat} 
            className="flex items-center gap-2 text-sm px-4 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-neutral-800 dark:hover:bg-neutral-700 text-slate-700 dark:text-slate-300 transition-all duration-200 hover:shadow-sm"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            New Chat
          </button>
          {isStreaming ? (
            <button 
              type="button" 
              className="flex items-center gap-2 text-sm px-4 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-neutral-800 dark:text-slate-300 dark:hover:bg-neutral-700/60 transition-all duration-200 shadow-sm" 
              onClick={onStop}
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
              Stop
            </button>
          ) : null}
        </div>
      </div>
    </header>
  );
}