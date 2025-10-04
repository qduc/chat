/**
 * Chat helpers hook
 *
 * Provides core chat functionality including configuration building and
 * send operation execution. Handles conversation management, streaming,
 * tool integration, and response processing.
 *
 * @module useChatHelpers
 */

import { useCallback, useRef } from 'react';
import type { ChatMessage, Role } from '../../../lib/chat';
import type { ChatState, ChatAction } from '../types';
import { sendChat } from '../../../lib/chat';
import { extractTextFromContent } from '../../../lib/chat/content-utils';

/**
 * Props for the useChatHelpers hook
 */
export interface UseChatHelpersProps {
  /** Current chat state */
  state: ChatState;
  /** Dispatch function for chat state updates */
  dispatch: React.Dispatch<ChatAction>;
  /** Object containing all state refs for synchronous access */
  refs: {
    modelRef: React.RefObject<string>;
    providerRef: React.RefObject<string | null>;
    systemPromptRef: React.RefObject<string>;
    inlineSystemPromptRef: React.RefObject<string>;
    activeSystemPromptIdRef: React.RefObject<string | null>;
    shouldStreamRef: React.RefObject<boolean>;
    reasoningEffortRef: React.RefObject<string>;
    verbosityRef: React.RefObject<string>;
    qualityLevelRef: React.RefObject<string>;
  };
  /** Ref to current assistant message being streamed */
  assistantMsgRef: React.RefObject<ChatMessage | null>;
  /** Ref to throttle timer for streaming updates */
  throttleTimerRef: React.RefObject<NodeJS.Timeout | null>;
  /** Conversation manager API client */
  conversationManager: any;
  /** Handler for streaming events */
  handleStreamEvent: (event: any) => void;
  /** Handler for streaming tokens */
  handleStreamToken: (token: string) => void;
  /** Function to refresh conversation list */
  refreshConversations: () => Promise<void>;
}

/**
 * Hook for chat helper functions
 *
 * Handles building chat configuration and executing send operations.
 *
 * @param props - Configuration object
 * @returns Object containing in-flight ref, config builder, and send function
 *
 * @example
 * ```typescript
 * const { inFlightRef, buildSendChatConfig, runSend } = useChatHelpers({
 *   state,
 *   dispatch,
 *   refs,
 *   assistantMsgRef,
 *   throttleTimerRef,
 *   conversationManager,
 *   handleStreamEvent,
 *   handleStreamToken,
 *   refreshConversations
 * });
 *
 * const config = buildSendChatConfig(messages, signal);
 * await runSend(config);
 * ```
 */
export function useChatHelpers({
  state,
  dispatch,
  refs,
  assistantMsgRef,
  throttleTimerRef,
  conversationManager,
  handleStreamEvent,
  handleStreamToken,
  refreshConversations,
}: UseChatHelpersProps) {
  const inFlightRef = useRef<boolean>(false);

  const buildSendChatConfig = useCallback(
    (messages: ChatMessage[], signal: AbortSignal) => {
      // Use inline override if available, otherwise fall back to system prompt.
      // Read from refs so callers (send/regenerate) get the most recent
      // value immediately even if React state hasn't committed yet.
      const effectiveSystemPrompt = ((refs.inlineSystemPromptRef.current || refs.systemPromptRef.current) || '').trim();

      const outgoing = effectiveSystemPrompt
        ? ([{ role: 'system', content: effectiveSystemPrompt } as any, ...messages])
        : messages;

      const config: any = {
        messages: outgoing.map(m => ({ role: m.role as Role, content: m.content })),
        // Prefer the synchronous ref which is updated immediately when the user
        // selects a model. This avoids a race where a model change dispatch
        // hasn't flushed to React state yet but an immediate regenerate/send
        // should use the newly selected model.
        model: refs.modelRef.current || state.model,
        signal,
        conversationId: state.conversationId || undefined,
        responseId: state.previousResponseId || undefined,
        systemPrompt: effectiveSystemPrompt || undefined,
        activeSystemPromptId: refs.activeSystemPromptIdRef.current || undefined,
        // Use refs for chat parameters to ensure immediate updates are used
        shouldStream: refs.shouldStreamRef.current ?? state.shouldStream,
        reasoningEffort: refs.reasoningEffortRef.current || state.reasoningEffort,
        verbosity: refs.verbosityRef.current ?? state.verbosity,
        qualityLevel: refs.qualityLevelRef.current || state.qualityLevel,
        modelCapabilities: state.modelCapabilities,
        onEvent: handleStreamEvent,
        onToken: handleStreamToken,
      };

      // Only add providerId if it's not null
      if (state.providerId) {
        config.providerId = refs.providerRef.current || state.providerId;
      }

      // Add tools if enabled
      if (state.useTools && state.enabledTools.length > 0) {
        config.tools = state.enabledTools;
        config.tool_choice = 'auto';
      }

      return config;
    },
    [state, refs, handleStreamEvent, handleStreamToken]
  );

  const runSend = useCallback(
    async (config: Parameters<typeof sendChat>[0]) => {
      try {
        const result = await sendChat(config);
        // For non-streaming requests, ensure the assistant message is populated
        // since there are no incremental text events to update content.
        if (config.shouldStream === false && result?.content) {
          const assistantId = assistantMsgRef.current?.id;
          if (assistantId) {
            dispatch({
              type: 'STREAM_TOKEN',
              payload: { messageId: assistantId, token: result.content },
            });
            // Also store usage data from the result for non-streaming responses
            if (result.usage) {
              dispatch({
                type: 'STREAM_USAGE',
                payload: { messageId: assistantId, usage: result.usage },
              });
            }
          }
        }
        // If backend auto-created a conversation, set id and refresh history
        if (result.conversation) {
          dispatch({ type: 'SET_CONVERSATION_ID', payload: result.conversation.id });
          // Clear cached list and refresh to reflect server ordering/title rather than optimistic add
          try {
            // Invalidate any cached conversation list in the manager so list() makes a real network request
            (conversationManager as any)?.clearListCache?.();
          } catch {}
          void refreshConversations();
        }
        // Sync the assistant message from the latest snapshot and the final content
        if (assistantMsgRef.current) {
          const merged = { ...assistantMsgRef.current };
          if (result?.content) merged.content = result.content;
          dispatch({ type: 'SYNC_ASSISTANT', payload: merged });
        }
        // Flush any pending throttled updates before completing
        if (throttleTimerRef.current) {
          clearTimeout(throttleTimerRef.current);
          throttleTimerRef.current = null;
          // Final sync with accumulated content
          if (assistantMsgRef.current) {
            dispatch({
              type: 'STREAM_TOKEN',
              payload: {
                messageId: assistantMsgRef.current.id,
                token: '',
                fullContent: extractTextFromContent(assistantMsgRef.current.content)
              }
            });
          }
        }
        dispatch({
          type: 'STREAM_COMPLETE',
          payload: { responseId: result.responseId },
        });
      } catch (e: any) {
        let displayError = 'An unexpected error occurred.';

        // Duck-typing for APIError
        if (e && typeof e.status === 'number' && e.body) {
          if (e.body && typeof e.body === 'object') {
            let detail = e.body.error?.message || e.body.message;
            if (e.body.error?.metadata?.raw) {
              try {
                const rawError = JSON.parse(e.body.error.metadata.raw);
                detail = rawError.error?.message || detail;
              } catch {
                // Failed to parse raw error metadata
              }
            }
            displayError = `HTTP ${e.status}: ${detail || 'An unknown error occurred.'}`;
          } else {
            displayError = e.message;
          }
        } else if (e instanceof Error) {
          displayError = e.message;
        } else {
          displayError = String(e);
        }

        // Append error message to the assistant bubble for visibility
        const assistantId = assistantMsgRef.current?.id;
        if (assistantId) {
          dispatch({ type: 'STREAM_TOKEN', payload: { messageId: assistantId, token: `\n[error: ${displayError}]` } });
        }
        dispatch({ type: 'STREAM_ERROR', payload: displayError });
      } finally {
        inFlightRef.current = false;
      }
    },
    [dispatch, assistantMsgRef, throttleTimerRef, conversationManager, refreshConversations]
  );

  return {
    inFlightRef,
    buildSendChatConfig,
    runSend,
  };
}
