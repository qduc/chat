import React, { useReducer, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';

// Import from refactored modules
import type { ChatState, ChatAction, PendingState, ToolSpec } from './useChatState/types';
import { initialState } from './useChatState/initialState';
import { chatReducer } from './useChatState/reducer';
import {
  createAuthActions,
  createUiActions,
  createSettingsActions,
  createChatActions,
  createConversationActions,
  createEditActions,
} from './useChatState/actions';
import {
  useRefSync,
  useModelLoader,
  useConversationLoader,
  useStreamHandlers,
  useChatHelpers,
  useInitialization,
} from './useChatState/hooks';

// Re-export types for backwards compatibility
export type { PendingState, ChatState, ChatAction, ToolSpec };

// Note: ChatState, ChatAction, initialState, chatReducer, and utilities are now imported from ./useChatState/

export function useChatState() {
  const { user, ready: authReady } = useAuth();
  const [state, dispatch] = useReducer(chatReducer, initialState);

  // Use extracted hooks
  const refs = useRefSync(state);
  const { loadProvidersAndModels } = useModelLoader({ authReady, user, modelRef: refs.modelRef, dispatch });
  const { conversationManager, refreshConversations } = useConversationLoader({ authReady, user, dispatch });
  const { assistantMsgRef, throttleTimerRef, handleStreamToken, handleStreamEvent } = useStreamHandlers({ dispatch });
  const { inFlightRef, buildSendChatConfig, runSend } = useChatHelpers({
    state,
    dispatch,
    refs,
    assistantMsgRef,
    throttleTimerRef,
    conversationManager,
    handleStreamEvent,
    handleStreamToken,
    refreshConversations,
  });

  // Initialize state from localStorage and auth context
  useInitialization({ dispatch, authReady, user });

  // Actions
  const actions = useMemo(() => {
    // Create action objects using the extracted action creators
    const authActions = createAuthActions({ dispatch });
    const uiActions = createUiActions({ dispatch });
    const settingsActions = createSettingsActions({
      dispatch,
      modelRef: refs.modelRef,
      providerRef: refs.providerRef,
      systemPromptRef: refs.systemPromptRef,
      inlineSystemPromptRef: refs.inlineSystemPromptRef,
      activeSystemPromptIdRef: refs.activeSystemPromptIdRef,
      shouldStreamRef: refs.shouldStreamRef,
      reasoningEffortRef: refs.reasoningEffortRef,
      verbosityRef: refs.verbosityRef,
      qualityLevelRef: refs.qualityLevelRef,
      loadProvidersAndModels,
    });

    // Create a stopStreaming function for use by chat and conversation actions
    const stopStreaming = () => {
      // Flush any pending throttled updates
      if (throttleTimerRef.current) {
        clearTimeout(throttleTimerRef.current);
        throttleTimerRef.current = null;
      }
      try { state.abort?.abort(); } catch {}
      inFlightRef.current = false;
      dispatch({ type: 'STOP_STREAMING' });
    };

    const chatActions = createChatActions({
      state,
      dispatch,
      inFlightRef,
      assistantMsgRef,
      throttleTimerRef,
      buildSendChatConfig,
      runSend,
    });

    // Override chatActions' stopStreaming and newChat with stable versions
    const stableChatActions = {
      ...chatActions,
      stopStreaming,
      newChat: async () => {
        if (state.status === 'streaming') {
          stopStreaming();
        }
        dispatch({ type: 'NEW_CHAT' });
      },
    };

    const conversationActions = createConversationActions({
      state,
      dispatch,
      conversationManager,
      stopStreaming,
    });

    const editActions = createEditActions({
      state,
      dispatch,
    });

    return {
      ...authActions,
      ...uiActions,
      ...settingsActions,
      ...stableChatActions,
      ...conversationActions,
      ...editActions,
      refreshConversations,
      loadProvidersAndModels,
    };
  }, [
    dispatch,
    refs,
    loadProvidersAndModels,
    state,
    inFlightRef,
    assistantMsgRef,
    throttleTimerRef,
    buildSendChatConfig,
    runSend,
    conversationManager,
    refreshConversations,
  ]);

  return { state, actions };
}
