import React, { useEffect, useRef, useState } from 'react';
import { Brain, ChevronDown } from 'lucide-react';
import { cn } from '../../lib/cn';

interface ReasoningBlockProps {
  text: string;
  isStreaming?: boolean;
  nested?: boolean;
}

export const ReasoningBlock: React.FC<ReasoningBlockProps> = ({
  text,
  isStreaming = false,
  nested = false,
}) => {
  const [isExpanded, setIsExpanded] = useState(isStreaming);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const prevIsStreamingRef = useRef(isStreaming);

  useEffect(() => {
    const wasStreaming = prevIsStreamingRef.current;
    prevIsStreamingRef.current = isStreaming;

    if (!wasStreaming && isStreaming) {
      const timer = setTimeout(() => setIsExpanded(true), 0);
      return () => clearTimeout(timer);
    } else if (wasStreaming && !isStreaming) {
      const timer = setTimeout(() => setIsExpanded(false), 0);
      return () => clearTimeout(timer);
    }
  }, [isStreaming]);

  useEffect(() => {
    if (!isStreaming || !isExpanded) return;

    const contentEl = contentRef.current;
    if (!contentEl) return;

    contentEl.scrollTop = contentEl.scrollHeight;
  }, [text, isExpanded, isStreaming]);

  if (!text) return null;

  return (
    <div
      className={cn(!nested && 'my-3 overflow-hidden rounded-card border border-line bg-surface')}
    >
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        aria-expanded={isExpanded}
        className={cn(
          'flex w-full items-center gap-2 px-4 text-fg-muted transition-colors select-none hover:bg-muted focus-ring-inset',
          nested ? 'py-2' : 'py-3'
        )}
      >
        <Brain
          aria-hidden="true"
          className={cn(
            'size-4 shrink-0',
            isStreaming ? 'animate-pulse text-fg-muted' : 'text-fg-subtle'
          )}
        />
        <span className="text-xs font-medium text-fg-muted">Thought Process</span>
        <ChevronDown
          aria-hidden="true"
          className={cn('ml-auto size-4 shrink-0 text-fg-subtle', isExpanded && 'rotate-180')}
        />
      </button>
      {isExpanded && (
        <div
          ref={contentRef}
          data-testid="reasoning-block-content"
          // While streaming, the content is a scrolling peek: make it keyboard-scrollable.
          tabIndex={isStreaming ? 0 : undefined}
          role={isStreaming ? 'region' : undefined}
          aria-label={isStreaming ? 'Thought process' : undefined}
          className={cn(
            'border-t border-line px-3 py-3 text-sm leading-relaxed whitespace-pre-wrap text-fg-muted',
            isStreaming && 'max-h-32 overflow-y-auto focus-ring-inset'
          )}
        >
          {text}
        </div>
      )}
    </div>
  );
};
