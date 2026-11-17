import React, { useEffect, useRef, useState } from 'react';
import { Brain, ChevronDown, Zap } from 'lucide-react';
import { ReasoningBlock } from './ReasoningBlock';
import { ToolSegment } from './ToolSegment';
import { cn } from '../../lib/cn';
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
  const LeadIcon = hasReasoning ? Brain : Zap;

  return (
    <div className="my-3 overflow-hidden rounded-card border border-line bg-surface">
      <button
        type="button"
        onClick={() => setIsExpanded((v) => !v)}
        aria-expanded={isExpanded}
        className="flex w-full items-center gap-2 px-4 py-3 text-fg-muted transition-colors select-none hover:bg-muted focus-ring-inset"
      >
        <LeadIcon
          aria-hidden="true"
          className={cn(
            'size-4 shrink-0',
            hasReasoning && isStreaming ? 'animate-pulse text-fg-muted' : 'text-fg-subtle'
          )}
        />
        <span className="text-xs font-medium text-fg-muted">{summaryParts.join(' · ')}</span>
        <ChevronDown
          aria-hidden="true"
          className={cn('ml-auto size-4 shrink-0 text-fg-subtle', isExpanded && 'rotate-180')}
        />
      </button>

      {isExpanded && (
        <div className="divide-y divide-line border-t border-line">
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
