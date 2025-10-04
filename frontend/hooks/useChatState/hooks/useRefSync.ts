/**
 * Reference synchronization hook
 *
 * Synchronizes critical state values to refs for immediate synchronous access.
 * This prevents race conditions when values are needed before React state commits.
 *
 * @module useRefSync
 */

import { useEffect, useRef } from 'react';
import type { ChatState } from '../types';

/**
 * Synchronizes state values to refs for immediate access
 *
 * This hook keeps refs in sync with React state to avoid race conditions
 * when immediate access to the latest values is needed (e.g., during
 * regenerate/send operations before React state has flushed).
 *
 * @param state - Current chat state
 * @returns Object containing all synchronized refs
 *
 * @example
 * ```typescript
 * const refs = useRefSync(state);
 * // Access current model synchronously
 * const model = refs.modelRef.current;
 * ```
 */
export function useRefSync(state: ChatState) {
  const modelRef = useRef(state.model);
  const providerRef = useRef<string | null>(null);
  const systemPromptRef = useRef(state.systemPrompt);
  const inlineSystemPromptRef = useRef(state.inlineSystemPromptOverride);
  const activeSystemPromptIdRef = useRef(state.activeSystemPromptId);
  const shouldStreamRef = useRef(state.shouldStream);
  const reasoningEffortRef = useRef(state.reasoningEffort);
  const verbosityRef = useRef(state.verbosity);
  const qualityLevelRef = useRef(state.qualityLevel);

  useEffect(() => {
    modelRef.current = state.model;
    systemPromptRef.current = state.systemPrompt;
    inlineSystemPromptRef.current = state.inlineSystemPromptOverride;
    activeSystemPromptIdRef.current = state.activeSystemPromptId;
    shouldStreamRef.current = state.shouldStream;
    reasoningEffortRef.current = state.reasoningEffort;
    verbosityRef.current = state.verbosity;
    qualityLevelRef.current = state.qualityLevel;
  }, [
    state.model,
    state.systemPrompt,
    state.inlineSystemPromptOverride,
    state.activeSystemPromptId,
    state.shouldStream,
    state.reasoningEffort,
    state.verbosity,
    state.qualityLevel,
  ]);

  return {
    modelRef,
    providerRef,
    systemPromptRef,
    inlineSystemPromptRef,
    activeSystemPromptIdRef,
    shouldStreamRef,
    reasoningEffortRef,
    verbosityRef,
    qualityLevelRef,
  };
}
