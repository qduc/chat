import React, { useEffect, useRef, useState } from 'react';
import { Brain, ChevronDown } from 'lucide-react';

interface ReasoningBlockProps {
  text: string;
  isStreaming?: boolean;
}

export const ReasoningBlock: React.FC<ReasoningBlockProps> = ({ text, isStreaming = false }) => {
  const [isExpanded, setIsExpanded] = useState(isStreaming);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const prevIsStreamingRef = useRef(isStreaming);

  useEffect(() => {
    if (!prevIsStreamingRef.current && isStreaming) {
      setIsExpanded(true);
    } else if (prevIsStreamingRef.current && !isStreaming) {
      setIsExpanded(false);
    }

    prevIsStreamingRef.current = isStreaming;
  }, [isStreaming]);

  useEffect(() => {
    if (!isStreaming || !isExpanded) return;

    const contentEl = contentRef.current;
    if (!contentEl) return;

    contentEl.scrollTop = contentEl.scrollHeight;
  }, [text, isExpanded, isStreaming]);

  if (!text) return null;

  return (
    <div className="my-3 rounded-xl border border-zinc-200/60 dark:border-zinc-800/60 bg-white dark:bg-zinc-900/40 overflow-hidden shadow-sm">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        aria-expanded={isExpanded}
        className="w-full flex items-center gap-2.5 px-4 py-3 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-colors select-none group/think-btn"
      >
        <Brain
          size={13}
          strokeWidth={1.5}
          className={`shrink-0 transition-colors ${
            isStreaming
              ? 'text-amber-500/80 dark:text-amber-400/80 animate-pulse'
              : 'text-zinc-400 dark:text-zinc-500 group-hover/think-btn:text-zinc-600 dark:group-hover/think-btn:text-zinc-300'
          }`}
        />
        <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
          Thought Process
        </span>
        <div className="ml-auto flex items-center gap-2">
          <ChevronDown
            size={13}
            className={`transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''} text-zinc-400 dark:text-zinc-500`}
          />
        </div>
      </button>

      {isExpanded && (
        <div className="border-t border-zinc-100 dark:border-zinc-800 bg-zinc-50/30 dark:bg-[#0a0a0a]/20">
          <div
            ref={contentRef}
            data-testid="reasoning-block-content"
            className={`px-3 py-3 text-[13px] leading-relaxed text-zinc-600 dark:text-zinc-400 whitespace-pre-wrap ${
              isStreaming ? 'max-h-32 overflow-y-auto' : ''
            }`}
          >
            {text}
          </div>
        </div>
      )}
    </div>
  );
};
