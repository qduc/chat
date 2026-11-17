/**
 * EvaluationDisplay - Judge results display
 * Shows evaluation drafts (streaming) and completed evaluations
 */

import React from 'react';
import { Scale, Trophy, Trash } from 'lucide-react';
import { IconButton } from '../ui/Button';
import { cn } from '../../lib/cn';
import Markdown from '../Markdown';
import { extractReasoningFromPartialJson } from '../../lib';
import type { Evaluation } from '../../lib/types';
import type { EvaluationDraft } from '../../hooks/useChat';

interface EvaluationDisplayProps {
  evaluationDrafts: EvaluationDraft[];
  evaluations: Evaluation[];
  primaryLabel: string;
  linkedConversations: Record<string, string>;
  onDeleteJudgeResponse: (id: string) => Promise<void>;
  resolveModelLabel: (modelId: string | null | undefined) => string;
}

const cardClasses = 'rounded-card border border-line bg-surface px-4 py-3';

export function EvaluationDisplay({
  evaluationDrafts,
  evaluations,
  primaryLabel,
  linkedConversations,
  onDeleteJudgeResponse,
  resolveModelLabel,
}: EvaluationDisplayProps) {
  const resolveComparisonModelId = (conversationId: string | null | undefined) => {
    if (!conversationId) return null;
    const match = Object.entries(linkedConversations).find(
      ([, convoId]) => convoId === conversationId
    );
    return match ? match[0] : null;
  };

  const unmaskReasoning = (text: string, selectedModelIds: string[]) => {
    let result = text;
    selectedModelIds.forEach((modelId, index) => {
      const label = `model_${String.fromCharCode(97 + index)}`;
      const realName = modelId === 'primary' ? primaryLabel : resolveModelLabel(modelId);

      // Replace {{model_a}}
      result = result.replace(new RegExp(`\\{\\{${label}\\}\\}`, 'g'), realName);
      // Replace model_a (word boundary)
      result = result.replace(new RegExp(`\\b${label}\\b`, 'g'), realName);
    });
    return result;
  };

  return (
    <div className="mt-3 space-y-3">
      {evaluationDrafts.map((draft) => {
        const modelLabels = draft.selectedModelIds
          .map((modelId) => (modelId === 'primary' ? primaryLabel : resolveModelLabel(modelId)))
          .join(' vs ');

        const rawReasoning = extractReasoningFromPartialJson(draft.content);
        const reasoning = rawReasoning
          ? unmaskReasoning(rawReasoning, draft.selectedModelIds)
          : 'Analyzing...';

        return (
          <div key={draft.id} className={cardClasses}>
            <div className="flex items-center justify-between gap-2 text-xs text-fg-muted">
              <div className="flex min-w-0 items-center gap-2">
                <Scale aria-hidden="true" className="size-4 shrink-0 text-fg-subtle" />
                <span>Judging: {modelLabels}</span>
              </div>
              <span className={draft.status === 'error' ? 'text-danger' : 'text-fg-subtle'}>
                {draft.status === 'error' ? 'Failed' : 'Working'}
              </span>
            </div>
            <div className="mt-2 text-sm text-fg">
              {draft.status === 'error' ? (
                <div role="alert" className="text-danger">
                  {draft.error}
                </div>
              ) : (
                <Markdown
                  text={reasoning}
                  isStreaming={draft.status === 'streaming'}
                  className="md-compact"
                />
              )}
            </div>
          </div>
        );
      })}

      {evaluations.map((evaluation) => {
        const fallbackComparisonModelId = resolveComparisonModelId(
          evaluation.model_b_conversation_id
        );
        const evaluationModels =
          evaluation.models && evaluation.models.length > 0
            ? evaluation.models
            : [
                {
                  model_id: 'primary',
                  conversation_id: evaluation.model_a_conversation_id,
                  message_id: evaluation.model_a_message_id,
                  score: evaluation.score_a ?? null,
                },
                {
                  model_id: fallbackComparisonModelId ?? null,
                  conversation_id: evaluation.model_b_conversation_id,
                  message_id: evaluation.model_b_message_id,
                  score: evaluation.score_b ?? null,
                },
              ];

        const resolveEvaluationModelLabel = (model: (typeof evaluationModels)[0]) => {
          if (model.model_id === 'primary') return primaryLabel;
          if (model.model_id) return resolveModelLabel(model.model_id);
          if (model.conversation_id === evaluation.model_a_conversation_id) {
            return primaryLabel;
          }
          const comparisonModelId = resolveComparisonModelId(model.conversation_id);
          return resolveModelLabel(comparisonModelId);
        };

        const winnerLabel = (() => {
          if (!evaluation.winner || evaluation.winner === 'tie') return 'Tie';
          if (evaluation.winner === 'model_a' || evaluation.winner === 'primary') {
            return primaryLabel;
          }
          if (evaluation.winner === 'model_b') {
            return resolveModelLabel(fallbackComparisonModelId);
          }
          const winnerModel = evaluationModels.find(
            (model) => model.model_id === evaluation.winner
          );
          return winnerModel ? resolveEvaluationModelLabel(winnerModel) : evaluation.winner;
        })();

        const judgeLabel = resolveModelLabel(evaluation.judge_model_id);

        return (
          <div key={evaluation.id} className={cardClasses}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-medium text-fg">
                <Trophy aria-hidden="true" className="size-4 shrink-0 text-fg-muted" />
                <span>Winner: {winnerLabel}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-2 text-xs text-fg-subtle">
                  <span>Judge: {judgeLabel}</span>
                  {evaluation.criteria ? <span>• {evaluation.criteria}</span> : null}
                </div>
                <IconButton
                  label="Delete judge response"
                  title="Delete judge response"
                  onClick={() => onDeleteJudgeResponse(evaluation.id)}
                  className="size-7 hover:text-danger"
                >
                  <Trash />
                </IconButton>
              </div>
            </div>
            <div className="mt-2 flex flex-col gap-2 text-xs sm:flex-row sm:flex-wrap">
              {evaluationModels.map((model) => {
                const label = resolveEvaluationModelLabel(model);
                const isWinner =
                  evaluation.winner === 'tie' || !evaluation.winner
                    ? false
                    : evaluation.winner === 'model_a'
                      ? model.conversation_id === evaluation.model_a_conversation_id
                      : evaluation.winner === 'model_b'
                        ? model.conversation_id === evaluation.model_b_conversation_id
                        : evaluation.winner === model.model_id;

                return (
                  <div
                    key={`${evaluation.id}-${model.conversation_id}-${model.message_id}`}
                    className={cn(
                      'flex items-center justify-between gap-2 rounded-control border px-3 py-2 sm:min-w-50 sm:flex-1',
                      isWinner
                        ? 'border-line-strong bg-emphasis font-medium text-fg'
                        : 'border-line bg-canvas-subtle text-fg-muted'
                    )}
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      {isWinner && <Trophy aria-label="Winner" className="size-4 shrink-0" />}
                      <span>{label}</span>
                    </div>
                    <span className="tabular-nums">{model.score ?? '—'}</span>
                  </div>
                );
              })}
            </div>
            {evaluation.reasoning && (
              <div className="mt-2 text-base leading-relaxed text-fg">
                <Markdown text={evaluation.reasoning} className="md-compact" />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
