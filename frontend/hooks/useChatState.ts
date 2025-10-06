/**
 * useChatState - Main chat state management hook
 *
 * A comprehensive React hook that manages all chat-related state and operations.
 * This hook has been refactored into a modular architecture with clear separation
 * of concerns across multiple sub-modules.
 *
 * ## Architecture
 *
 * The hook is composed of:
 * - **State Management**: useReducer with domain-specific sub-reducers
 * - **Action Creators**: Factory functions for creating action objects
 * - **Custom Hooks**: Specialized hooks for different functionalities
 * - **Utilities**: Helper functions for streaming, config building, etc.
 *
 * ## Key Features
 *
 * - 🔐 **Authentication**: User state and auth-aware operations
 * - 💬 **Chat Operations**: Send, regenerate, streaming support
 * - 📝 **Conversations**: Load, select, delete, pagination
 * - ⚙️ **Settings**: Model, provider, tools, reasoning controls
 * - ✏️ **Editing**: Message edit workflow
 * - 🖼️ **Images**: Multi-image attachment support
 * - 🛠️ **Tools**: Server-side tool orchestration
 *
 * ## Usage
 *
 * ```typescript
 * const { state, actions } = useChatState();
 *
 * // Send a message
 * await actions.sendMessage();
 *
 * // Select a conversation
 * await actions.selectConversation('conv-123');
 *
 * // Update settings
 * actions.setModel('gpt-4');
 * actions.setQualityLevel('thorough');
 * ```
 *
 * ## State Structure
 *
 * See `ChatState` type in `./useChatState/types.ts` for complete state shape.
 *
 * ## Actions
 *
 * All actions are available through the `actions` object returned by the hook.
 * See individual action creator modules for detailed documentation.
 *
 * @module useChatState
 */

import { useReducer, useMemo } from 'react';
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

/**
 * Main chat state management hook
 *
 * @returns Object containing state and actions
 * @returns {ChatState} state - Current chat state
 * @returns {Object} actions - All available actions
 *
 * @example
 * ```typescript
 * function ChatComponent() {
 *   const { state, actions } = useChatState();
 *
 *   return (
 *     <div>
 *       <button onClick={actions.sendMessage}>Send</button>
 *       <div>{state.messages.map(msg => ...)}</div>
 *     </div>
 *   );
 * }
 * ```
 */
export function useChatState() {
  const { user, ready: authReady } = useAuth();
  const [state, dispatch] = useReducer(chatReducer, initialState);

  // Use extracted hooks
  const refs = useRefSync(state);
  const { loadProvidersAndModels } = useModelLoader({ authReady, user, modelRef: refs.modelRef, dispatch });
  const { conversationManager, refreshConversations } = useConversationLoader({ authReady, user, dispatch });
  const {
    assistantMsgRef,
    throttleTimerRef,
    toolCallMessageIdRef,
    toolCallContentLengthRef,
    lastUsageRef,
    handleStreamToken,
    handleStreamEvent,
  } = useStreamHandlers({ dispatch });
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
      assistantMsgRef.current = null;
      toolCallMessageIdRef.current = null;
      toolCallContentLengthRef.current = 0;
      lastUsageRef.current = null;
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
      toolCallMessageIdRef,
      toolCallContentLengthRef,
      lastUsageRef,
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
