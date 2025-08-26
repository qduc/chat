import { MessageCircle, Plus, Square } from 'lucide-react';

interface ChatHeaderProps {
  model: string;
  useTools: boolean;
  shouldStream: boolean;
  researchMode: boolean;
  isStreaming: boolean;
  onModelChange: (model: string) => void;
  onUseToolsChange: (useTools: boolean) => void;
  onShouldStreamChange: (val: boolean) => void;
  onResearchModeChange: (val: boolean) => void;
  onNewChat: () => void;
  onStop: () => void;
}

export function ChatHeader({
  model,
  useTools,
  shouldStream,
  researchMode,
  isStreaming,
  onModelChange,
  onUseToolsChange,
  onShouldStreamChange,
  onResearchModeChange,
  onNewChat,
  onStop
}: ChatHeaderProps) {
  return (
    <header className="sticky top-0 z-10 border-b border-slate-200/60 dark:border-neutral-800/60 bg-white/80 dark:bg-neutral-950/80 backdrop-blur-md supports-[backdrop-filter]:bg-white/70 dark:supports-[backdrop-filter]:bg-neutral-950/70 shadow-sm">
      <div className="mx-auto max-w-4xl px-6 py-4 flex items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-slate-200 dark:bg-neutral-800 flex items-center justify-center shadow-sm">
            <MessageCircle className="w-4 h-4 text-slate-700 dark:text-slate-200" />
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
              <option value="gpt-5-mini">GPT-5 Mini</option>
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
            Enable Tools
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400 select-none">
            <input
              type="checkbox"
              className="rounded border-slate-300 dark:border-neutral-700 text-blue-600 focus:ring-blue-500"
              checked={shouldStream}
              onChange={e => onShouldStreamChange(e.target.checked)}
            />
            Stream Responses
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400 select-none">
            <input
              type="checkbox"
              className="rounded border-slate-300 dark:border-neutral-700 text-orange-600 focus:ring-orange-500"
              checked={researchMode}
              onChange={e => onResearchModeChange(e.target.checked)}
              disabled={!useTools}
            />
            <span className={useTools ? "" : "opacity-50"}>Research Mode</span>
          </label>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <button
            type="button"
            onClick={onNewChat}
            className="flex items-center gap-2 text-sm px-4 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-neutral-800 dark:hover:bg-neutral-700 text-slate-700 dark:text-slate-300 transition-all duration-200 hover:shadow-sm"
          >
            <Plus className="w-4 h-4" />
            New Chat
          </button>
          {isStreaming ? (
            <button
              type="button"
              className="flex items-center gap-2 text-sm px-4 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-neutral-800 dark:text-slate-300 dark:hover:bg-neutral-700/60 transition-all duration-200 shadow-sm"
              onClick={onStop}
            >
              <Square className="w-4 h-4" fill="currentColor" />
              Stop
            </button>
          ) : null}
        </div>
      </div>
    </header>
  );
}
