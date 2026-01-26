/**
 * ModelResponseColumn - Single model response column
 * Renders segments, stats row, and toolbar for one model
 */

import React from 'react';
import { AlertCircle } from 'lucide-react';
import Markdown from '../Markdown';
import { MessageContentRenderer } from '../ui/MessageContentRenderer';
import { ToolSegment } from './ToolSegment';
import { MessageToolbar } from './MessageToolbar';
import { formatUsageLabel } from '../../lib';
import { extractTextFromContent } from '../../lib/contentUtils';
import type { ModelDisplayData, ToolOutput } from './types';
import type { PendingState } from '../../hooks/useChat';

interface ModelResponseColumnProps {
  data: ModelDisplayData;
  messageId: string;
  isMultiColumn: boolean;
  isEditing: boolean;
  isUser: boolean;
  hasComparison: boolean;
  pending: PendingState;
  streamingStats: { tokensPerSecond: number; isEstimate?: boolean } | null;
  collapsedToolOutputs: Record<string, boolean>;
  copiedMessageId: string | null;
  actionsDisabled: boolean;
  onToggleToolOutput: (key: string) => void;
  onCopy: (messageId: string, text: string) => void;
  onFork?: (messageId: string, modelId: string) => void;
  onRetryMessage?: (messageId: string) => void;
  onRetryComparisonModel?: (messageId: string, modelId: string) => void;
  getModelDisplayName: (modelId: string) => string;
}

export function ModelResponseColumn({
  data,
  messageId,
  isMultiColumn,
  isEditing,
  isUser,
  hasComparison,
  pending,
  streamingStats,
  collapsedToolOutputs,
  copiedMessageId,
  actionsDisabled,
  onToggleToolOutput,
  onCopy,
  onFork,
  onRetryMessage,
  onRetryComparisonModel,
}: ModelResponseColumnProps) {
  const {
    modelId,
    displayMessage: dm,
    isModelStreaming,
    isModelError,
    error: modelError,
    assistantSegments: segments,
  } = data;

  const getModelDisplayName = (id: string) => {
    if (id === 'primary') {
      return 'Primary';
    }
    return id.includes('::') ? id.split('::')[1] : id;
  };

  const renderToolSegment = (
    segment: { kind: 'tool_call'; toolCall: any; outputs: ToolOutput[] },
    segmentIndex: number
  ) => {
    const toggleKey = `${messageId}-${modelId}-${segment.toolCall.id ?? segmentIndex}`;
    const isCollapsed = collapsedToolOutputs[toggleKey] ?? true;

    return (
      <ToolSegment
        key={`tool-${modelId}-${segmentIndex}`}
        messageId={messageId}
        modelId={modelId}
        segmentIndex={segmentIndex}
        toolCall={segment.toolCall}
        outputs={segment.outputs}
        isCollapsed={isCollapsed}
        onToggle={() => onToggleToolOutput(toggleKey)}
      />
    );
  };

  return (
    <div key={modelId} className={`space-y-3 max-w-3xl ${isMultiColumn ? 'flex-1 min-w-0' : ''}`}>
      {isMultiColumn && (
        <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400 pb-1 border-b border-zinc-100 dark:border-zinc-800">
          {getModelDisplayName(modelId)}
        </div>
      )}
      {segments.length === 0 ? (
        <div className="text-base leading-relaxed text-zinc-800 dark:text-zinc-200">
          {(isModelStreaming || pending.abort) && !isModelError && !pending.error ? (
            <span className="inline-flex items-center gap-1 text-zinc-500 dark:text-zinc-400">
              <span
                className="w-1.5 h-1.5 rounded-full bg-current animate-bounce"
                style={{ animationDelay: '0ms' }}
              />
              <span
                className="w-1.5 h-1.5 rounded-full bg-current animate-bounce"
                style={{ animationDelay: '150ms' }}
              />
              <span
                className="w-1.5 h-1.5 rounded-full bg-current animate-bounce"
                style={{ animationDelay: '300ms' }}
              />
            </span>
          ) : isModelError && modelError && isMultiColumn ? (
            <div className="flex items-start gap-2 text-red-500 dark:text-red-400 text-sm bg-red-50/50 dark:bg-red-950/20 rounded-lg px-3 py-2 border border-red-100 dark:border-red-900/30">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{modelError}</span>
            </div>
          ) : (
            <span className="text-zinc-500 dark:text-zinc-400 italic">No response content</span>
          )}
        </div>
      ) : (
        segments.map((segment, segmentIndex) => {
          if (segment.kind === 'text') {
            if (!segment.text) return null;
            return (
              <div
                key={`text-${modelId}-${segmentIndex}`}
                className="text-base leading-relaxed text-zinc-900 dark:text-zinc-200"
              >
                <Markdown text={segment.text} isStreaming={isModelStreaming} />
              </div>
            );
          }
          if (segment.kind === 'images') {
            if (!segment.images || segment.images.length === 0) return null;
            return (
              <div key={`images-${modelId}-${segmentIndex}`} className="mt-3">
                <MessageContentRenderer
                  content={segment.images}
                  isStreaming={false}
                  role="assistant"
                />
              </div>
            );
          }
          return renderToolSegment(segment, segmentIndex);
        })
      )}

      {/* Stats row for this model */}
      {!isEditing && (dm.content || !isUser) && (
        <div className="mt-2 flex items-center justify-between opacity-70 group-hover:opacity-100 transition-opacity text-xs border-t border-zinc-100 dark:border-zinc-800/50 pt-2">
          <div className="flex items-center gap-2 overflow-hidden mr-2">
            {streamingStats &&
              streamingStats.tokensPerSecond > 0 &&
              modelId === 'primary' &&
              !isMultiColumn && (
                <div className="px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-500 text-[10px] font-mono whitespace-nowrap">
                  {streamingStats.isEstimate ? '~' : ''}
                  {streamingStats.tokensPerSecond.toFixed(1)} t/s
                </div>
              )}
            {(() => {
              const usageLabel = formatUsageLabel(dm.usage);
              if (!usageLabel) return null;
              return (
                <div className="px-1.5 py-0.5 rounded bg-zinc-50 dark:bg-zinc-800/50 text-slate-500 dark:text-slate-500 text-[10px] font-mono whitespace-nowrap">
                  {usageLabel} tokens
                </div>
              );
            })()}
            {dm.provider && (
              <div className="px-1.5 py-0.5 rounded bg-zinc-50 dark:bg-zinc-800/50 text-slate-500 dark:text-slate-500 text-[10px] font-mono whitespace-nowrap">
                {dm.provider}
              </div>
            )}
          </div>
          <MessageToolbar
            messageId={messageId}
            modelId={modelId}
            hasContent={!!dm.content}
            copiedMessageId={copiedMessageId}
            actionsDisabled={actionsDisabled}
            isStreaming={pending.streaming}
            hasComparison={hasComparison}
            isUser={isUser}
            onCopy={onCopy}
            onFork={onFork}
            onRetry={onRetryMessage}
            onRetryModel={onRetryComparisonModel}
            contentText={extractTextFromContent(dm.content)}
          />
        </div>
      )}
    </div>
  );
}
