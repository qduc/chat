/**
 * Conversation management action creators
 *
 * Handles conversation lifecycle including selection, loading, deletion,
 * and pagination. Manages conversation-level settings restoration when
 * selecting existing conversations.
 *
 * @module conversationActions
 */

import type { Role, ConversationManager } from '../../../lib/chat';
import type { QualityLevel } from '../../../components/ui/QualitySlider';
import type { ChatState, ChatAction } from '../types';

/**
 * Props for creating conversation actions
 */
export interface ConversationActionsProps {
  /** Current chat state */
  state: ChatState;
  /** Dispatch function for chat state updates */
  dispatch: React.Dispatch<ChatAction>;
  /** Conversation manager API client */
  conversationManager: ConversationManager;
  /** Function to stop current streaming */
  stopStreaming: () => void;
}

/**
 * Creates conversation action creators
 *
 * @param props - Configuration object
 * @returns Object containing conversation action functions
 *
 * @example
 * ```typescript
 * const conversationActions = createConversationActions({
 *   state,
 *   dispatch,
 *   conversationManager,
 *   stopStreaming
 * });
 *
 * await conversationActions.selectConversation('conv-123');
 * await conversationActions.deleteConversation('conv-456');
 * ```
 */
export function createConversationActions({
  state,
  dispatch,
  conversationManager,
  stopStreaming,
}: ConversationActionsProps) {
  return {
    /**
     * Selects and loads a conversation by ID
     * Stops any ongoing streaming, loads messages and conversation settings
     *
     * @param id - Conversation ID to select
     */
    selectConversation: async (id: string) => {
      if (state.status === 'streaming') {
        stopStreaming();
      }

      dispatch({ type: 'SET_CONVERSATION_ID', payload: id });
      dispatch({ type: 'CLEAR_MESSAGES' });
      dispatch({ type: 'CANCEL_EDIT' });

      try {
        const data = await conversationManager.get(id, { limit: 200 });
        const msgs = data.messages.map(m => ({
          id: String(m.id),
          role: m.role as Role,
          content: m.content || '',
          ...(m.tool_calls && { tool_calls: m.tool_calls }),
          ...(m.tool_outputs && { tool_outputs: m.tool_outputs })
        }));
        dispatch({ type: 'SET_MESSAGES', payload: msgs });

        // Apply conversation-level settings from API response
        if (data.model) {
          dispatch({ type: 'SET_MODEL', payload: data.model });
        }
        if (data.streaming_enabled !== undefined) {
          dispatch({ type: 'SET_SHOULD_STREAM', payload: data.streaming_enabled });
        }
        if (data.tools_enabled !== undefined) {
          dispatch({ type: 'SET_USE_TOOLS', payload: data.tools_enabled });
        }
        const activeTools = Array.isArray((data as any).active_tools)
          ? (data as any).active_tools
          : Array.isArray((data as any).metadata?.active_tools)
            ? (data as any).metadata.active_tools
            : undefined;
        if (Array.isArray(activeTools)) {
          dispatch({ type: 'SET_ENABLED_TOOLS', payload: activeTools });
        } else if (data.tools_enabled === false) {
          dispatch({ type: 'SET_ENABLED_TOOLS', payload: [] });
        }
        if (data.quality_level) {
          dispatch({ type: 'SET_QUALITY_LEVEL', payload: data.quality_level as QualityLevel });
        }
        if (data.reasoning_effort) {
          dispatch({ type: 'SET_REASONING_EFFORT', payload: data.reasoning_effort });
        }
        if (data.verbosity) {
          dispatch({ type: 'SET_VERBOSITY', payload: data.verbosity });
        }
        // Always update system_prompt if present in response (including null)
        if ('system_prompt' in (data as any)) {
          dispatch({ type: 'SET_SYSTEM_PROMPT', payload: (data as any).system_prompt || '' });
        }
        // Always update active_system_prompt_id if present in response (including null)
        if ('active_system_prompt_id' in (data as any)) {
          dispatch({ type: 'SET_ACTIVE_SYSTEM_PROMPT_ID', payload: (data as any).active_system_prompt_id });
        }
        // Set the current conversation title if available
        if (data.title) {
          dispatch({ type: 'SET_CURRENT_CONVERSATION_TITLE', payload: data.title });
        }
      } catch {
        // ignore
      }
    },

    /**
     * Loads more conversations using cursor-based pagination
     * Only loads if there is a next cursor and not already loading
     */
    loadMoreConversations: async () => {
      if (!state.nextCursor || state.loadingConversations) return;

      dispatch({ type: 'LOAD_CONVERSATIONS_START' });
      try {
        const list = await conversationManager.list({ cursor: state.nextCursor, limit: 20 });
        dispatch({
          type: 'LOAD_CONVERSATIONS_SUCCESS',
          payload: { conversations: list.items, nextCursor: list.next_cursor }
        });
      } catch {
        dispatch({ type: 'LOAD_CONVERSATIONS_ERROR' });
      }
    },

    /**
     * Deletes a conversation by ID
     *
     * @param id - Conversation ID to delete
     */
    deleteConversation: async (id: string) => {
      try {
        await conversationManager.delete(id);
        dispatch({ type: 'DELETE_CONVERSATION', payload: id });
      } catch {
        // ignore
      }
    },
  };
}
