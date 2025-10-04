/**
 * Settings reducer
 * Handles model, provider, tools, and chat parameter settings
 */

import type { ChatState, ChatAction } from '../types';
import { getQualityMapping } from '../utils/qualityMapping';

export function settingsReducer(state: ChatState, action: ChatAction): ChatState | null {
  switch (action.type) {
    case 'SET_MODEL':
      return { ...state, model: action.payload };

    case 'SET_PROVIDER_ID':
      return { ...state, providerId: action.payload };

    case 'SET_USE_TOOLS':
      return { ...state, useTools: action.payload };

    case 'SET_SHOULD_STREAM':
      return { ...state, shouldStream: action.payload };

    case 'SET_REASONING_EFFORT':
      return { ...state, reasoningEffort: action.payload };

    case 'SET_VERBOSITY':
      return { ...state, verbosity: action.payload };

    case 'SET_QUALITY_LEVEL': {
      const derived = getQualityMapping(action.payload);
      return {
        ...state,
        qualityLevel: action.payload,
        reasoningEffort: derived.reasoningEffort,
        verbosity: derived.verbosity,
      };
    }

    case 'SET_SYSTEM_PROMPT':
      return { ...state, systemPrompt: action.payload };

    case 'SET_INLINE_SYSTEM_PROMPT_OVERRIDE':
      return { ...state, inlineSystemPromptOverride: action.payload };

    case 'SET_ACTIVE_SYSTEM_PROMPT_ID':
      return { ...state, activeSystemPromptId: action.payload };

    case 'SET_ENABLED_TOOLS':
      return { ...state, enabledTools: action.payload };

    case 'SET_MODEL_LIST':
      return {
        ...state,
        modelGroups: action.payload.groups,
        modelOptions: action.payload.options,
        modelToProvider: action.payload.modelToProvider || {},
        modelCapabilities: action.payload.modelCapabilities || {}
      };

    case 'SET_LOADING_MODELS':
      return { ...state, isLoadingModels: action.payload };

    default:
      return null; // Not handled by this reducer
  }
}
