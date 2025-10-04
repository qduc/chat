/**
 * Settings action creators
 *
 * Manages all configuration settings including model selection, provider configuration,
 * tool settings, reasoning controls, and system prompts. These actions handle both
 * state updates and ref synchronization for immediate effect.
 *
 * @module settingsActions
 */

import type { QualityLevel } from '../../../components/ui/QualitySlider';
import type { ChatAction } from '../types';

/**
 * Props for creating settings actions
 */
export interface SettingsActionsProps {
  /** Dispatch function for chat state updates */
  dispatch: React.Dispatch<ChatAction>;
  /** Ref to current model for synchronous access */
  modelRef: React.MutableRefObject<string>;
  /** Ref to current provider ID for synchronous access */
  providerRef: React.MutableRefObject<string | null>;
  /** Ref to system prompt for synchronous access */
  systemPromptRef: React.MutableRefObject<string>;
  /** Ref to inline system prompt override for synchronous access */
  inlineSystemPromptRef: React.MutableRefObject<string>;
  /** Ref to active system prompt ID for synchronous access */
  activeSystemPromptIdRef: React.MutableRefObject<string | null>;
  /** Ref to streaming preference for synchronous access */
  shouldStreamRef: React.MutableRefObject<boolean>;
  /** Ref to reasoning effort level for synchronous access */
  reasoningEffortRef: React.MutableRefObject<string>;
  /** Ref to verbosity level for synchronous access */
  verbosityRef: React.MutableRefObject<string>;
  /** Ref to quality level for synchronous access */
  qualityLevelRef: React.MutableRefObject<QualityLevel>;
  /** Function to reload providers and models from backend */
  loadProvidersAndModels: () => Promise<void>;
}

/**
 * Creates settings action creators
 *
 * @param props - Configuration object with dispatch, refs, and dependencies
 * @returns Object containing settings action functions
 *
 * @example
 * ```typescript
 * const settingsActions = createSettingsActions({
 *   dispatch,
 *   modelRef,
 *   providerRef,
 *   // ... other refs
 *   loadProvidersAndModels
 * });
 *
 * settingsActions.setModel('gpt-4');
 * settingsActions.setQualityLevel('thorough');
 * await settingsActions.refreshModelList();
 * ```
 */
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
    /**
     * Sets the active model and persists to localStorage
     * Updates both state and ref for immediate synchronous access
     *
     * @param model - Model identifier (e.g., 'gpt-4', 'claude-3-opus')
     */
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

    /**
     * Sets the active provider ID
     *
     * @param providerId - Provider identifier or null for default
     */
    setProviderId: (providerId: string | null) => {
      providerRef.current = providerId;
      dispatch({ type: 'SET_PROVIDER_ID', payload: providerId });
    },

    /**
     * Toggles tool usage on or off
     *
     * @param useTools - Whether tools should be enabled
     */
    setUseTools: (useTools: boolean) => {
      dispatch({ type: 'SET_USE_TOOLS', payload: useTools });
    },

    /**
     * Sets whether responses should stream or return all at once
     *
     * @param shouldStream - Whether to use streaming mode
     */
    setShouldStream: (shouldStream: boolean) => {
      shouldStreamRef.current = shouldStream;
      dispatch({ type: 'SET_SHOULD_STREAM', payload: shouldStream });
    },

    /**
     * Sets the reasoning effort level for model responses
     *
     * @param effort - Reasoning effort level ('minimal', 'medium', 'high')
     */
    setReasoningEffort: (effort: string) => {
      reasoningEffortRef.current = effort;
      dispatch({ type: 'SET_REASONING_EFFORT', payload: effort });
    },

    /**
     * Sets the verbosity level for model responses
     *
     * @param verbosity - Verbosity level ('low', 'medium', 'high')
     */
    setVerbosity: (verbosity: string) => {
      verbosityRef.current = verbosity;
      dispatch({ type: 'SET_VERBOSITY', payload: verbosity });
    },

    /**
     * Sets the quality level preset, which automatically configures
     * reasoning effort and verbosity
     *
     * @param level - Quality preset ('quick', 'balanced', 'thorough')
     */
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

    /**
     * Sets the system prompt for the chat session
     *
     * @param prompt - System prompt text
     */
    setSystemPrompt: (prompt: string) => {
      // Update ref synchronously so immediate send/regenerate uses new prompt
      systemPromptRef.current = prompt;
      dispatch({ type: 'SET_SYSTEM_PROMPT', payload: prompt });
    },

    /**
     * Sets an inline system prompt override from the prompt manager
     * This updates both the inline override and the active system prompt
     *
     * @param prompt - Override system prompt text
     */
    setInlineSystemPromptOverride: (prompt: string) => {
      if (
        inlineSystemPromptRef.current === prompt &&
        systemPromptRef.current === prompt
      ) {
        return;
      }
      // Update both refs synchronously to ensure immediate use by send/regenerate
      inlineSystemPromptRef.current = prompt;
      systemPromptRef.current = prompt;
      dispatch({ type: 'SET_INLINE_SYSTEM_PROMPT_OVERRIDE', payload: prompt });
      dispatch({ type: 'SET_SYSTEM_PROMPT', payload: prompt });
    },

    /**
     * Sets the ID of the active system prompt from the prompt manager
     *
     * @param id - System prompt ID or null for none
     */
    setActiveSystemPromptId: (id: string | null) => {
      activeSystemPromptIdRef.current = id;
      dispatch({ type: 'SET_ACTIVE_SYSTEM_PROMPT_ID', payload: id });
    },

    /**
     * Sets the list of enabled tool identifiers
     *
     * @param list - Array of enabled tool names
     */
    setEnabledTools: (list: string[]) => {
      dispatch({ type: 'SET_ENABLED_TOOLS', payload: list });
    },

    /**
     * Refreshes the model list from the backend
     * Fetches latest available models and providers
     */
    refreshModelList: async () => {
      await loadProvidersAndModels();
    },
  };
}
