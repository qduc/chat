/**
 * AssistantMessage - Assistant message with comparison support
 * Orchestrates ComparisonTabs, ModelResponseColumns, and EvaluationDisplay
 */

import React from 'react';
import { Scale } from 'lucide-react';
import { ComparisonTabs } from './ComparisonTabs';
import { ModelResponseColumn } from './ModelResponseColumn';
import { EvaluationDisplay } from './EvaluationDisplay';
import { buildAssistantSegments } from '../../lib';
import { MAX_COMPARISON_COLUMNS } from './types';
import type { ChatMessage } from '../../lib/types';
import type { PendingState, EvaluationDraft } from '../../hooks/useChat';
import type { Evaluation } from '../../lib/types';

interface AssistantMessageProps {
  message: ChatMessage;
  isStreaming: boolean;
  compareModels: string[];
  primaryModelLabel: string | null;
  linkedConversations: Record<string, string>;
  evaluations: Evaluation[];
  evaluationDrafts: EvaluationDraft[];
  canSend: boolean;
  pending: PendingState;
  streamingStats: { tokensPerSecond: number; isEstimate?: boolean } | null;
  selectedComparisonModels: string[];
  isMobile: boolean;
  showComparisonTabs: boolean;
  collapsedToolOutputs: Record<string, boolean>;
  copiedMessageId: string | null;
  onToggleToolOutput: (key: string) => void;
  onCopy: (messageId: string, text: string) => void;
  onFork?: (messageId: string, modelId: string) => void;
  onRetryMessage?: (messageId: string) => void;
  onRetryComparisonModel?: (messageId: string, modelId: string) => void;
  onToggleComparisonModel: (modelId: string, event?: React.MouseEvent) => void;
  onSelectAllComparisonModels: (models: string[]) => void;
  onOpenJudgeModal?: (messageId: string, comparisonModelIds: string[]) => void;
  onDeleteJudgeResponse: (id: string) => Promise<void>;
  isEditing: boolean;
}

export function AssistantMessage({
  message,
  isStreaming,
  compareModels,
  primaryModelLabel,
  linkedConversations,
  evaluations,
  evaluationDrafts,
  canSend,
  pending,
  streamingStats,
  selectedComparisonModels,
  isMobile,
  showComparisonTabs,
  collapsedToolOutputs,
  copiedMessageId,
  onToggleToolOutput,
  onCopy,
  onFork,
  onRetryMessage,
  onRetryComparisonModel,
  onToggleComparisonModel,
  onSelectAllComparisonModels,
  onOpenJudgeModal,
  onDeleteJudgeResponse,
  isEditing,
}: AssistantMessageProps) {
  const actionsDisabled = !canSend;

  // Comparison Logic
  const baseComparisonModels = Object.keys(message.comparisonResults || {});
  const showStreamingTabs = isStreaming && compareModels.length > 0;
  const comparisonModels = showStreamingTabs
    ? Array.from(new Set([...baseComparisonModels, ...compareModels]))
    : baseComparisonModels;
  const hasComparison = comparisonModels.length > 0;

  const comparisonModelIds = Object.keys(message.comparisonResults || {});
  const primaryLabel = primaryModelLabel
    ? primaryModelLabel.includes('::')
      ? primaryModelLabel.split('::')[1]
      : primaryModelLabel
    : 'Primary';

  const resolveModelLabel = (modelId: string | null | undefined) => {
    if (!modelId) return 'Model';
    if (modelId === 'primary') return primaryLabel;
    return modelId.includes('::') ? modelId.split('::')[1] : modelId;
  };

  const evaluationsForMessage = evaluations.filter(
    (evaluation) => evaluation.model_a_message_id === message.id
  );
  const evaluationDraftsForMessage = evaluationDrafts.filter(
    (draft) => draft.messageId === message.id
  );

  // All available models including primary
  const allModels = ['primary', ...comparisonModels];

  // Filter selected models to only valid ones
  const resolvedSelectedModels = selectedComparisonModels.filter(
    (m) => m === 'primary' || comparisonModels.includes(m)
  );
  // Ensure at least primary is selected
  const activeModels = resolvedSelectedModels.length > 0 ? resolvedSelectedModels : ['primary'];

  // Build display data for each selected model
  const modelDisplayData = activeModels.map((modelId) => {
    if (modelId === 'primary') {
      return {
        modelId,
        displayMessage: message,
        isModelStreaming: isStreaming,
        isModelError: !!pending.error,
        error: pending.error,
        assistantSegments: buildAssistantSegments(message),
      };
    }

    const result = message.comparisonResults?.[modelId];
    if (result) {
      const displayMessage = {
        ...message,
        content: result.content,
        tool_calls: result.tool_calls,
        tool_outputs: result.tool_outputs,
        message_events: result.message_events,
        usage: result.usage,
        provider: (result as any).provider,
      };
      return {
        modelId,
        displayMessage,
        isModelStreaming: result.status === 'streaming',
        isModelError: result.status === 'error',
        error: result.error,
        assistantSegments: buildAssistantSegments(displayMessage),
      };
    }

    // Model not yet available (streaming)
    const displayMessage = {
      ...message,
      content: '',
      tool_calls: undefined,
      tool_outputs: undefined,
      message_events: undefined,
      usage: undefined,
    };
    return {
      modelId,
      displayMessage,
      isModelStreaming: pending.streaming,
      isModelError: !!pending.error,
      error: pending.error,
      assistantSegments: [],
    };
  });

  const isMultiColumn = activeModels.length > 1;

  const getModelDisplayName = (modelId: string) => {
    if (modelId === 'primary') {
      return primaryModelLabel
        ? primaryModelLabel.includes('::')
          ? primaryModelLabel.split('::')[1]
          : primaryModelLabel
        : 'Primary';
    }
    return modelId.includes('::') ? modelId.split('::')[1] : modelId;
  };

  return (
    <>
      {hasComparison && showComparisonTabs && (
        <ComparisonTabs
          allModels={allModels}
          activeModels={activeModels}
          primaryModelLabel={primaryModelLabel}
          isMobile={isMobile}
          onToggleModel={onToggleComparisonModel}
          onSelectAll={onSelectAllComparisonModels}
        />
      )}

      {isMultiColumn ? (
        /* Multi-column side-by-side view - stacks on mobile */
        <div className="flex flex-col md:flex-row gap-4">
          {modelDisplayData.map((data) => (
            <ModelResponseColumn
              key={data.modelId}
              data={data}
              messageId={message.id}
              isMultiColumn={isMultiColumn}
              isEditing={isEditing}
              isUser={false}
              hasComparison={hasComparison}
              pending={pending}
              streamingStats={streamingStats}
              collapsedToolOutputs={collapsedToolOutputs}
              copiedMessageId={copiedMessageId}
              actionsDisabled={actionsDisabled}
              onToggleToolOutput={onToggleToolOutput}
              onCopy={onCopy}
              onFork={onFork}
              onRetryMessage={onRetryMessage}
              onRetryComparisonModel={onRetryComparisonModel}
              getModelDisplayName={getModelDisplayName}
            />
          ))}
        </div>
      ) : (
        /* Single column view */
        modelDisplayData.map((data) => (
          <ModelResponseColumn
            key={data.modelId}
            data={data}
            messageId={message.id}
            isMultiColumn={isMultiColumn}
            isEditing={isEditing}
            isUser={false}
            hasComparison={hasComparison}
            pending={pending}
            streamingStats={streamingStats}
            collapsedToolOutputs={collapsedToolOutputs}
            copiedMessageId={copiedMessageId}
            actionsDisabled={actionsDisabled}
            onToggleToolOutput={onToggleToolOutput}
            onCopy={onCopy}
            onFork={onFork}
            onRetryMessage={onRetryMessage}
            onRetryComparisonModel={onRetryComparisonModel}
            getModelDisplayName={getModelDisplayName}
          />
        ))
      )}

      {hasComparison && onOpenJudgeModal && comparisonModelIds.length > 0 && (
        <div className="mt-3 flex justify-center">
          <button
            type="button"
            onClick={() => onOpenJudgeModal(message.id, comparisonModelIds)}
            disabled={actionsDisabled}
            className="flex items-center gap-2 px-3 py-1.5 text-xs rounded-full border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Scale className="w-3.5 h-3.5" aria-hidden="true" />
            Judge
          </button>
        </div>
      )}

      {hasComparison &&
        (evaluationDraftsForMessage.length > 0 || evaluationsForMessage.length > 0) && (
          <EvaluationDisplay
            evaluationDrafts={evaluationDraftsForMessage}
            evaluations={evaluationsForMessage}
            primaryLabel={primaryLabel}
            linkedConversations={linkedConversations}
            onDeleteJudgeResponse={onDeleteJudgeResponse}
            resolveModelLabel={resolveModelLabel}
          />
        )}

      {hasComparison && onRetryMessage && !pending.streaming && (
        <div className="mt-2 flex justify-end">
          <button
            onClick={() => onRetryMessage(message.id)}
            disabled={actionsDisabled}
            className="text-xs text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title="Retry all models"
            type="button"
          >
            Retry all models
          </button>
        </div>
      )}
    </>
  );
}
