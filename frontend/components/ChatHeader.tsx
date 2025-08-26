import { MessageCircle, Plus, Square } from 'lucide-react';
import { useChatContext } from '../contexts/ChatContext';

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
  const {
    reasoningEffort,
    setReasoningEffort,
    verbosity,
    setVerbosity,
  } = useChatContext();

  return (
    <header className="sticky top-0 z-10 border-b border-slate-200/60 dark:border-neutral-800/60 bg-white/80 dark:bg-neutral-950/80 backdrop-blur-md supports-[backdrop-filter]:bg-white/70 dark:supports-[backdrop-filter]:bg-neutral-950/70 shadow-sm">
      <div className="mx-auto max-w-4xl px-6 py-4 flex items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-slate-200 dark:bg-neutral-800 flex items-center justify-center shadow-sm">
            <MessageCircle className="w-4 h-4 text-slate-700 dark:text-slate-200" />
          </div>
          <h1 className="font-semibold text-xl text-slate-800 dark:text-slate-200">Chat</h1>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400" title="Model">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.25 3v1.5M4.5 8.25H3m18 0h-1.5M4.5 12H3m18 0h-1.5m-15 3.75H3m18 0h-1.5M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-5.25 5.25l-2.25-2.25" /></svg>
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
          <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400" title="Reasoning Effort">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            <select
              className="rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-neutral-900 border border-slate-200 dark:border-neutral-700 text-slate-700 dark:text-slate-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200"
              value={reasoningEffort}
              onChange={e => setReasoningEffort(e.target.value)}
            >
              <option value="minimal">Minimal</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </div>
          <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400" title="Verbosity">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 8h10M7 12h4m-4 4h10" /></svg>
            <select
              className="rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-neutral-900 border border-slate-200 dark:border-neutral-700 text-slate-700 dark:text-slate-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200"
              value={verbosity}
              onChange={e => setVerbosity(e.target.value)}
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400 select-none" title="Enable Tools">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg>
            <input
              type="checkbox"
              className="rounded border-slate-300 dark:border-neutral-700 text-blue-600 focus:ring-blue-500"
              checked={useTools}
              onChange={e => onUseToolsChange(e.target.checked)}
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400 select-none" title="Stream Responses">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
            <input
              type="checkbox"
              className="rounded border-slate-300 dark:border-neutral-700 text-blue-600 focus:ring-blue-500"
              checked={shouldStream}
              onChange={e => onShouldStreamChange(e.target.checked)}
            />
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
