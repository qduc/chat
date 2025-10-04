import type { QualityLevel } from '../../../components/ui/QualitySlider';
import type { ChatAction } from '../types';

export interface SettingsActionsProps {
  dispatch: React.Dispatch<ChatAction>;
  modelRef: React.MutableRefObject<string>;
  providerRef: React.MutableRefObject<string | null>;
  systemPromptRef: React.MutableRefObject<string>;
  inlineSystemPromptRef: React.MutableRefObject<string>;
  activeSystemPromptIdRef: React.MutableRefObject<string | null>;
  shouldStreamRef: React.MutableRefObject<boolean>;
  reasoningEffortRef: React.MutableRefObject<string>;
  verbosityRef: React.MutableRefObject<string>;
  qualityLevelRef: React.MutableRefObject<QualityLevel>;
  loadProvidersAndModels: () => Promise<void>;
}

export function createSettingsActions({
  dispatch,
  modelRef,
  providerRef,
  systemPromptRef,
  inlineSystemPromptRef,
  activeSystemPromptIdRef,
  shouldStreamRef,
  reasoningEffortRef,
  verbosityRef,
  qualityLevelRef,
  loadProvidersAndModels,
}: SettingsActionsProps) {
  return {
    setModel: (model: string) => {
      // Update the ref immediately so subsequent actions (like regenerate)
      // that read modelRef.current will use the newly selected model even if
      // React state hasn't committed yet.
      modelRef.current = model;
      // Save to localStorage
      try {
        if (typeof window !== 'undefined') {
          localStorage.setItem('selectedModel', model);
        }
      } catch {
        // ignore storage errors
      }
      dispatch({ type: 'SET_MODEL', payload: model });
    },

    setProviderId: (providerId: string | null) => {
      providerRef.current = providerId;
      dispatch({ type: 'SET_PROVIDER_ID', payload: providerId });
    },

    setUseTools: (useTools: boolean) => {
      dispatch({ type: 'SET_USE_TOOLS', payload: useTools });
    },

    setShouldStream: (shouldStream: boolean) => {
      shouldStreamRef.current = shouldStream;
      dispatch({ type: 'SET_SHOULD_STREAM', payload: shouldStream });
    },

    setReasoningEffort: (effort: string) => {
      reasoningEffortRef.current = effort;
      dispatch({ type: 'SET_REASONING_EFFORT', payload: effort });
    },

    setVerbosity: (verbosity: string) => {
      verbosityRef.current = verbosity;
      dispatch({ type: 'SET_VERBOSITY', payload: verbosity });
    },

    setQualityLevel: (level: QualityLevel) => {
      // Update refs synchronously for immediate use
      qualityLevelRef.current = level;
      // Also update derived refs based on quality level mapping
      const map: Record<QualityLevel, { reasoningEffort: string; verbosity: string }> = {
        quick: { reasoningEffort: 'minimal', verbosity: 'low' },
        balanced: { reasoningEffort: 'medium', verbosity: 'medium' },
        thorough: { reasoningEffort: 'high', verbosity: 'high' },
      };
      const derived = map[level];
      reasoningEffortRef.current = derived.reasoningEffort;
      verbosityRef.current = derived.verbosity;
      dispatch({ type: 'SET_QUALITY_LEVEL', payload: level });
    },

    setSystemPrompt: (prompt: string) => {
      // Update ref synchronously so immediate send/regenerate uses new prompt
      systemPromptRef.current = prompt;
      dispatch({ type: 'SET_SYSTEM_PROMPT', payload: prompt });
    },

    setInlineSystemPromptOverride: (prompt: string) => {
      // Update both refs synchronously to ensure immediate use by send/regenerate
      inlineSystemPromptRef.current = prompt;
      systemPromptRef.current = prompt;
      dispatch({ type: 'SET_INLINE_SYSTEM_PROMPT_OVERRIDE', payload: prompt });
      dispatch({ type: 'SET_SYSTEM_PROMPT', payload: prompt });
    },

    setActiveSystemPromptId: (id: string | null) => {
      activeSystemPromptIdRef.current = id;
      dispatch({ type: 'SET_ACTIVE_SYSTEM_PROMPT_ID', payload: id });
    },

    setEnabledTools: (list: string[]) => {
      dispatch({ type: 'SET_ENABLED_TOOLS', payload: list });
    },

    // Model list refresh action (triggered by UI or external events)
    refreshModelList: async () => {
      await loadProvidersAndModels();
    },
  };
}
