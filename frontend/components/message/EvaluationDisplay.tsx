/**
 * EvaluationDisplay - Judge results display
 * Shows evaluation drafts (streaming) and completed evaluations
 */

import React from 'react';
import { Scale, Trophy, Trash } from 'lucide-react';
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

  return (
    <div className="mt-3 space-y-3">
      {evaluationDrafts.map((draft) => {
        const modelLabels = draft.selectedModelIds
          .map((modelId) => (modelId === 'primary' ? primaryLabel : resolveModelLabel(modelId)))
          .join(' vs ');
        return (
          <div
            key={draft.id}
            className="border border-amber-200/70 dark:border-amber-900/50 bg-amber-50/70 dark:bg-amber-950/30 rounded-xl px-4 py-3"
          >
            <div className="flex items-center justify-between text-xs text-amber-700 dark:text-amber-300">
              <div className="flex items-center gap-2">
                <Scale className="w-3.5 h-3.5" />
                <span>Judging: {modelLabels}</span>
              </div>
              <span className="uppercase tracking-wide">
                {draft.status === 'error' ? 'Failed' : 'Working'}
              </span>
            </div>
            <div className="mt-2 text-sm text-amber-900 dark:text-amber-100">
              {draft.status === 'error' ? (
                <div className="text-red-600 dark:text-red-300">{draft.error}</div>
              ) : (
                <Markdown
                  text={extractReasoningFromPartialJson(draft.content) || 'Analyzing...'}
                  isStreaming={draft.status === 'streaming'}
                  className="md-compact !text-amber-900 dark:!text-amber-100"
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
          <div
            key={evaluation.id}
            className="border border-emerald-200/70 dark:border-emerald-900/50 bg-emerald-50/70 dark:bg-emerald-950/30 rounded-xl px-4 py-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-emerald-700 dark:text-emerald-300">
              <div className="flex items-center gap-2">
                <Trophy className="w-3.5 h-3.5" />
                <span>Winner: {winnerLabel}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400">
                  <span>Judge: {judgeLabel}</span>
                  {evaluation.criteria ? <span>• {evaluation.criteria}</span> : null}
                </div>
                <button
                  onClick={() => onDeleteJudgeResponse(evaluation.id)}
                  title="Delete judge response"
                  className="p-1 rounded hover:bg-emerald-100 dark:hover:bg-emerald-900/50 text-emerald-600 dark:text-emerald-400 transition-colors"
                >
                  <Trash className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            <div className="mt-2 grid grid-cols-1 sm:grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-2 text-xs text-emerald-800 dark:text-emerald-100">
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
                    className={`flex items-center justify-between rounded-lg px-2.5 py-1.5 ${
                      isWinner
                        ? 'bg-yellow-100 dark:bg-yellow-950/40 border border-yellow-300 dark:border-yellow-700'
                        : 'bg-white/60 dark:bg-emerald-950/40'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {isWinner && (
                        <Trophy className="w-3 h-3 text-yellow-600 dark:text-yellow-400" />
                      )}
                      <span className={isWinner ? 'font-semibold' : ''}>{label}</span>
                    </div>
                    <span className={isWinner ? 'font-semibold' : ''}>{model.score ?? '—'}</span>
                  </div>
                );
              })}
            </div>
            {evaluation.reasoning && (
              <div className="mt-2 text-base leading-relaxed text-emerald-900 dark:text-emerald-100">
                <Markdown text={evaluation.reasoning} className="md-compact" />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
