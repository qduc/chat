import { useEffect, useRef } from 'react';
import type { PendingState } from '../hooks/useChatStream';

interface MessageInputProps {
  input: string;
  pending: PendingState;
  onInputChange: (value: string) => void;
  onSend: () => void;
}

export function MessageInput({ input, pending, onInputChange, onSend }: MessageInputProps) {
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  // Auto-grow textarea up to ~200px
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const next = Math.min(200, el.scrollHeight);
    el.style.height = `${next}px`;
  }, [input]);

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  return (
    <form 
      className="" 
      onSubmit={e => { e.preventDefault(); onSend(); }}
    >
      <div className="px-2">
        <div className="relative rounded-2xl bg-white/95 dark:bg-neutral-900/95 border border-slate-200 dark:border-neutral-700 shadow-xl backdrop-blur-lg transition-all duration-200">
          <textarea
            ref={inputRef}
            className="w-full resize-none bg-transparent border-0 outline-none p-4 text-sm placeholder-slate-500 dark:placeholder-slate-400 text-slate-800 dark:text-slate-200"
            placeholder="Type your message..."
            value={input}
            onChange={e => onInputChange(e.target.value)}
            onKeyDown={handleKey}
            rows={1}
          />
          <div className="flex items-center justify-between px-4 pb-4">
            <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              <span>Enter to send • Shift+Enter for new line</span>
            </div>
            <button
              type="submit"
              disabled={!input.trim() || pending.streaming}
              className="flex items-center gap-2 px-4 py-2 text-sm rounded-xl bg-slate-800 hover:bg-slate-700 dark:bg-slate-600 dark:hover:bg-slate-500 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200 shadow-md hover:shadow-lg disabled:hover:shadow-md transform hover:scale-[1.02] disabled:hover:scale-100"
            >
              {pending.streaming ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="m4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Sending...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                  </svg>
                  Send
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </form>
  );
}