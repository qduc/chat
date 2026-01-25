import { useState, useRef, useEffect } from 'react';
import type { Evaluation, EvaluationDraft } from '../lib';

/**
 * Hook for managing comparison mode state and evaluations.
 *
 * Provides state for:
 * - `compareModels`: List of model IDs being compared against primary
 * - `linkedConversations`: Map of model ID to linked conversation ID
 * - `evaluations`: Completed judge evaluations
 * - `evaluationDrafts`: In-progress streaming evaluations
 *
 * Note: Judge orchestration logic (judgeComparison, deleteJudgeResponse) lives in
 * useChat since it requires access to conversation context and message refs.
 */
export function useCompareMode() {
  const [compareModels, setCompareModels] = useState<string[]>([]);
  const [linkedConversations, setLinkedConversations] = useState<Record<string, string>>({});
  const linkedConversationsRef = useRef<Record<string, string>>({});

  useEffect(() => {
    linkedConversationsRef.current = linkedConversations;
  }, [linkedConversations]);

  const [evaluations, setEvaluations] = useState<Evaluation[]>([]);
  const [evaluationDrafts, setEvaluationDrafts] = useState<EvaluationDraft[]>([]);

  return {
    compareModels,
    setCompareModels,
    linkedConversations,
    setLinkedConversations,
    linkedConversationsRef,
    evaluations,
    setEvaluations,
    evaluationDrafts,
    setEvaluationDrafts,
  };
}
