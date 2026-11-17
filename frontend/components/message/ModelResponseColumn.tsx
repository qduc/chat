/**
 * ModelResponseColumn - Single model response column
 * Renders segments, stats row, and toolbar for one model
 */

import React from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import Markdown from '../Markdown';
import { MessageContentRenderer } from '../ui/MessageContentRenderer';
import { ToolSegment } from './ToolSegment';
import { ReasoningBlock } from './ReasoningBlock';
import { ThinkingToolGroup } from './ThinkingToolGroup';
import type { GroupedSegmentItem, GroupedSegment } from './ThinkingToolGroup';
import { MessageToolbar } from './MessageToolbar';
import { RevisionNavigation } from './RevisionNavigation';
import { formatUsageLabel } from '../../lib';
import { extractTextFromContent, extractAssistantCopyText } from '../../lib/contentUtils';
import type { ModelDisplayData, ToolOutput, RevisionNavProps } from './types';
import type { PendingState } from '../../hooks/useChat';
import { cn } from '../../lib/cn';

/** Neutral metadata chip: speed, token usage, provider, model. */
const metaChipClasses =
  'inline-flex h-5 items-center rounded-control bg-muted px-2 text-xs whitespace-nowrap text-fg-subtle tabular-nums';

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
  regenRevision?: RevisionNavProps;
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
  getModelDisplayName,
  regenRevision,
}: ModelResponseColumnProps) {
  const {
    modelId,
    displayMessage: dm,
    isModelStreaming,
    isModelError,
    error: modelError,
    assistantSegments: segments,
  } = data;

  const [showingRaw, setShowingRaw] = React.useState(false);
  const toggleRaw = React.useCallback(() => setShowingRaw((prev) => !prev), []);

  const retryStatus = pending.retryStatus;
  const isRetryingThisModel =
    !!retryStatus && (retryStatus.modelId ?? 'primary') === modelId && !isModelError;

  const retryStatusLabel = (() => {
    if (!isRetryingThisModel || !retryStatus) return null;
    const reason =
      retryStatus.source === 'previous_response_id'
        ? 'Retrying with full history after provider rejected cached conversation state'
        : retryStatus.status === 429
          ? 'Retrying after provider rate limit'
          : retryStatus.status && retryStatus.status >= 500
            ? 'Retrying after provider error'
            : 'Retrying after provider error';
    const attempt =
      retryStatus.attempt && retryStatus.maxRetries
        ? `attempt ${retryStatus.attempt}/${retryStatus.maxRetries}`
        : retryStatus.attempt
          ? `attempt ${retryStatus.attempt}`
          : '';
    const wait =
      typeof retryStatus.retryAfterMs === 'number' && retryStatus.retryAfterMs > 0
        ? `waiting ~${Math.max(1, Math.round(retryStatus.retryAfterMs / 1000))}s`
        : '';
    const details = [attempt, wait].filter(Boolean).join(', ');
    return details ? `${reason} (${details})` : reason;
  })();

  const renderToolSegment = (
    segment: { kind: 'tool_call'; toolCall: any; outputs: ToolOutput[] },
    segmentIndex: number,
    nested = false
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
        nested={nested}
      />
    );
  };

  const usageLabel = formatUsageLabel(dm.usage);

  const MIN_GROUP_SIZE = 3;

  // Group consecutive reasoning/tool_call segments together for a combined expandable block.
  // Text and image segments break groups. Groups below MIN_GROUP_SIZE render as individual blocks.
  type SegmentGroup =
    | { kind: 'single'; segment: (typeof segments)[number]; index: number }
    | { kind: 'group'; items: GroupedSegmentItem[] };

  const segmentGroups: SegmentGroup[] = [];
  let currentGroupItems: GroupedSegmentItem[] = [];

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg.kind === 'reasoning' || seg.kind === 'tool_call') {
      currentGroupItems.push({ segment: seg as GroupedSegment, originalIndex: i });
    } else {
      if (currentGroupItems.length > 0) {
        segmentGroups.push({ kind: 'group', items: currentGroupItems });
        currentGroupItems = [];
      }
      segmentGroups.push({ kind: 'single', segment: seg, index: i });
    }
  }
  if (currentGroupItems.length > 0) {
    segmentGroups.push({ kind: 'group', items: currentGroupItems });
  }

  return (
    <div className={cn('max-w-3xl space-y-3', isMultiColumn && 'min-w-0 flex-1')}>
      {isMultiColumn && (
        <div className="border-b border-line pb-1 text-xs font-medium text-fg-muted">
          {getModelDisplayName(modelId)}
        </div>
      )}
      {showingRaw ? (
        <pre
          tabIndex={0}
          aria-label="Raw message text"
          className="max-h-160 overflow-auto rounded-card border border-line bg-muted p-4 font-mono text-sm leading-relaxed whitespace-pre-wrap text-fg focus-ring"
        >
          {extractTextFromContent(dm.content)}
        </pre>
      ) : segments.length === 0 ? (
        <div className="text-base leading-relaxed text-fg">
          {retryStatusLabel ? (
            <span role="status" className="inline-flex items-center gap-2 text-sm text-warning">
              <Loader2 aria-hidden="true" className="size-4 animate-spin" />
              <span>{retryStatusLabel}</span>
            </span>
          ) : (isModelStreaming || pending.abort) && !isModelError && !pending.error ? (
            <span className="inline-flex items-center gap-1 text-fg-subtle">
              {[0, 150, 300].map((delay) => (
                <span
                  key={delay}
                  className="size-1.5 animate-bounce rounded-full bg-current"
                  style={{ animationDelay: `${delay}ms` }}
                />
              ))}
            </span>
          ) : isModelError && modelError ? (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-card bg-danger-subtle px-3 py-2 text-sm text-danger"
            >
              <span className="flex h-5 shrink-0 items-center">
                <AlertCircle aria-hidden="true" className="size-4" />
              </span>
              <div className="min-w-0 flex-1 whitespace-pre-wrap">{modelError}</div>
            </div>
          ) : (
            <span className="text-fg-muted italic">No response content</span>
          )}
        </div>
      ) : (
        <>
          {retryStatusLabel && (
            <div role="status" className="mb-2 inline-flex items-center gap-2 text-sm text-warning">
              <Loader2 aria-hidden="true" className="size-4 animate-spin" />
              <span>{retryStatusLabel}</span>
            </div>
          )}
          {segmentGroups.map((group) => {
            if (group.kind === 'single') {
              const { segment, index } = group;
              if (segment.kind === 'text') {
                if (!segment.text) return null;
                return (
                  <div
                    key={`text-${modelId}-${index}`}
                    className="text-base leading-relaxed text-fg"
                  >
                    <Markdown text={segment.text} isStreaming={isModelStreaming} />
                  </div>
                );
              }
              if (segment.kind === 'reasoning') {
                if (!segment.text) return null;
                return (
                  <ReasoningBlock
                    key={`reasoning-${modelId}-${index}`}
                    text={segment.text}
                    isStreaming={isModelStreaming && index === segments.length - 1}
                  />
                );
              }
              if (segment.kind === 'images') {
                if (!segment.images || segment.images.length === 0) return null;
                return (
                  <div key={`images-${modelId}-${index}`} className="mt-3">
                    <MessageContentRenderer
                      content={segment.images}
                      isStreaming={false}
                      role="assistant"
                    />
                  </div>
                );
              }
              return renderToolSegment(segment, index);
            }

            // Below threshold: render each item individually (no outer wrapper)
            if (group.items.length < MIN_GROUP_SIZE) {
              return (
                <React.Fragment key={`subthreshold-${group.items[0].originalIndex}`}>
                  {group.items.map(({ segment, originalIndex }) => {
                    if (segment.kind === 'reasoning') {
                      if (!segment.text) return null;
                      return (
                        <ReasoningBlock
                          key={`reasoning-${modelId}-${originalIndex}`}
                          text={segment.text}
                          isStreaming={isModelStreaming && originalIndex === segments.length - 1}
                        />
                      );
                    }
                    return renderToolSegment(segment, originalIndex);
                  })}
                </React.Fragment>
              );
            }

            // Group of 2+: combined expandable block
            const lastOriginalIndex = group.items[group.items.length - 1].originalIndex;
            return (
              <ThinkingToolGroup
                key={`group-${modelId}-${group.items[0].originalIndex}`}
                items={group.items}
                messageId={messageId}
                modelId={modelId}
                isStreaming={isModelStreaming && lastOriginalIndex === segments.length - 1}
                collapsedToolOutputs={collapsedToolOutputs}
                onToggleToolOutput={onToggleToolOutput}
              />
            );
          })}
        </>
      )}

      {/* Stats row for this model */}
      {!isEditing && (dm.content || !isUser) && (
        <div className="mt-2 flex items-center justify-between gap-2 border-t border-line pt-2">
          <div className="flex min-w-0 flex-wrap items-center gap-1">
            {streamingStats &&
              streamingStats.tokensPerSecond > 0 &&
              modelId === 'primary' &&
              !isMultiColumn && (
                <span className={metaChipClasses}>
                  {streamingStats.isEstimate ? '~' : ''}
                  {streamingStats.tokensPerSecond.toFixed(1)} t/s
                </span>
              )}
            {usageLabel && <span className={metaChipClasses}>{usageLabel} tokens</span>}
            {dm.provider && <span className={metaChipClasses}>{dm.provider}</span>}
            {dm.model && <span className={metaChipClasses}>{dm.model}</span>}
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
            onToggleRaw={toggleRaw}
            isRaw={showingRaw}
            contentText={
              isUser ? extractTextFromContent(dm.content) : extractAssistantCopyText(segments)
            }
            revisionNavigation={
              regenRevision ? (
                <RevisionNavigation
                  current={regenRevision.slot}
                  total={regenRevision.total}
                  onPrev={regenRevision.onPrev}
                  onNext={regenRevision.onNext}
                  loading={regenRevision.loading}
                  disabled={regenRevision.disabled}
                />
              ) : undefined
            }
          />
        </div>
      )}
    </div>
  );
}
