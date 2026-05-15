import React, { useEffect, useRef, useState } from 'react';
import { Brain, ChevronDown, Zap } from 'lucide-react';
import { ReasoningBlock } from './ReasoningBlock';
import { ToolSegment } from './ToolSegment';
import type { AssistantSegment } from './types';

export type GroupedSegment = Extract<AssistantSegment, { kind: 'reasoning' | 'tool_call' }>;

export interface GroupedSegmentItem {
  segment: GroupedSegment;
  originalIndex: number;
}

interface ThinkingToolGroupProps {
  items: GroupedSegmentItem[];
  messageId: string;
  modelId: string;
  isStreaming: boolean;
  collapsedToolOutputs: Record<string, boolean>;
  onToggleToolOutput: (key: string) => void;
}

function getToolSummaryName(name: string): string {
  switch (name) {
    case 'get_time':
      return 'checked time';
    case 'web_search':
      return 'searched web';
    default:
      return name;
  }
}

export function ThinkingToolGroup({
  items,
  messageId,
  modelId,
  isStreaming,
  collapsedToolOutputs,
  onToggleToolOutput,
}: ThinkingToolGroupProps) {
  const [isExpanded, setIsExpanded] = useState(isStreaming);
  const prevIsStreamingRef = useRef(isStreaming);

  useEffect(() => {
    const wasStreaming = prevIsStreamingRef.current;
    prevIsStreamingRef.current = isStreaming;
    if (!wasStreaming && isStreaming) {
      const t = setTimeout(() => setIsExpanded(true), 0);
      return () => clearTimeout(t);
    } else if (wasStreaming && !isStreaming) {
      const t = setTimeout(() => setIsExpanded(false), 0);
      return () => clearTimeout(t);
    }
  }, [isStreaming]);

  const hasReasoning = items.some((item) => item.segment.kind === 'reasoning');
  const toolItems = items.filter((item) => item.segment.kind === 'tool_call');
  const toolCount = toolItems.length;

  const summaryParts: string[] = [];
  if (hasReasoning) summaryParts.push('Thought');
  if (toolCount === 1) {
    const seg = toolItems[0].segment;
    if (seg.kind === 'tool_call') {
      summaryParts.push(getToolSummaryName(seg.toolCall?.function?.name ?? ''));
    }
  } else if (toolCount > 1) {
    summaryParts.push(`${toolCount} tools used`);
  }

  const lastItemIndex = items[items.length - 1]?.originalIndex ?? -1;

  return (
    <div className="my-3 rounded-xl border border-zinc-200/60 dark:border-zinc-800/60 bg-white dark:bg-zinc-900/40 overflow-hidden shadow-sm">
      <button
        onClick={() => setIsExpanded((v) => !v)}
        aria-expanded={isExpanded}
        className="w-full flex items-center gap-2.5 px-4 py-3 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-colors select-none group/group-btn"
      >
        {hasReasoning ? (
          <Brain
            size={13}
            strokeWidth={1.5}
            className={`shrink-0 transition-colors ${
              isStreaming
                ? 'text-amber-500/80 dark:text-amber-400/80 animate-pulse'
                : 'text-zinc-400 dark:text-zinc-500 group-hover/group-btn:text-zinc-600 dark:group-hover/group-btn:text-zinc-300'
            }`}
          />
        ) : (
          <Zap
            size={13}
            strokeWidth={1.5}
            className="shrink-0 text-zinc-400 dark:text-zinc-500 group-hover/group-btn:text-zinc-600 dark:group-hover/group-btn:text-zinc-300 transition-colors"
          />
        )}
        <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
          {summaryParts.join(' · ')}
        </span>
        <ChevronDown
          size={13}
          className={`ml-auto shrink-0 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''} text-zinc-400 dark:text-zinc-500`}
        />
      </button>

      {isExpanded && (
        <div className="border-t border-zinc-100 dark:border-zinc-800 divide-y divide-zinc-100 dark:divide-zinc-800/50">
          {items.map(({ segment, originalIndex }) => {
            if (segment.kind === 'reasoning') {
              return (
                <ReasoningBlock
                  key={`r-${originalIndex}`}
                  text={segment.text}
                  isStreaming={isStreaming && originalIndex === lastItemIndex}
                  nested
                />
              );
            }
            if (segment.kind === 'tool_call') {
              const toggleKey = `${messageId}-${modelId}-${segment.toolCall.id ?? originalIndex}`;
              return (
                <ToolSegment
                  key={`t-${originalIndex}`}
                  messageId={messageId}
                  modelId={modelId}
                  segmentIndex={originalIndex}
                  toolCall={segment.toolCall}
                  outputs={segment.outputs}
                  isCollapsed={collapsedToolOutputs[toggleKey] ?? true}
                  onToggle={() => onToggleToolOutput(toggleKey)}
                  nested
                />
              );
            }
            return null;
          })}
        </div>
      )}
    </div>
  );
}
