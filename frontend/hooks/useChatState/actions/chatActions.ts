/**
 * Chat operation action creators
 *
 * Handles core chat operations including sending messages, regenerating responses,
 * and managing streaming state. These actions coordinate with the backend chat API
 * and handle streaming events.
 *
 * @module chatActions
 */

import type { ChatMessage } from '../../../lib/chat';
import { sendChat } from '../../../lib/chat';
import { createMixedContent } from '../../../lib/chat/content-utils';
import { imagesClient } from '../../../lib/chat/images';
import type { ChatState, ChatAction } from '../types';

/**
 * Props for creating chat actions
 */
export interface ChatActionsProps {
  /** Current chat state */
  state: ChatState;
  /** Dispatch function for chat state updates */
  dispatch: React.Dispatch<ChatAction>;
  /** Ref to track if a chat request is in flight */
  inFlightRef: React.MutableRefObject<boolean>;
  /** Ref to current assistant message being streamed */
  assistantMsgRef: React.MutableRefObject<ChatMessage | null>;
  /** Ref to throttle timer for streaming updates */
  throttleTimerRef: React.MutableRefObject<NodeJS.Timeout | null>;
  /** Ref tracking tool-call assistant message id */
  toolCallMessageIdRef: React.MutableRefObject<string | null>;
  /** Ref tracking tool-call assistant content length */
  toolCallContentLengthRef: React.MutableRefObject<number>;
  /** Ref tracking last usage to deduplicate events */
  lastUsageRef: React.MutableRefObject<string | null>;
  /** Function to build chat configuration */
  buildSendChatConfig: (messages: ChatMessage[], signal: AbortSignal) => any;
  /** Function to execute the chat request */
  runSend: (config: Parameters<typeof sendChat>[0]) => Promise<void>;
}

/**
 * Creates chat action creators
 *
 * @param props - Configuration object
 * @returns Object containing chat action functions
 *
 * @example
 * ```typescript
 * const chatActions = createChatActions({
 *   state,
 *   dispatch,
 *   inFlightRef,
 *   assistantMsgRef,
 *   throttleTimerRef,
 *   buildSendChatConfig,
 *   runSend
 * });
 *
 * await chatActions.sendMessage();
 * await chatActions.regenerate(messages);
 * chatActions.stopStreaming();
 * ```
 */
export function createChatActions({
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
}: ChatActionsProps) {
  return {
    /**
     * Sends a new message to the chat
     * Handles both text and image attachments, creates mixed content,
     * initiates streaming, and coordinates with the backend
     */
    sendMessage: async () => {
      const input = state.input.trim();
      const images = state.images;

      // Check if we have either text or images
      if ((!input && images.length === 0) || state.status === 'streaming' || inFlightRef.current) return;

      inFlightRef.current = true;
      const abort = new AbortController();

      // Create mixed content from text and images
      let messageContent;
      if (images.length > 0) {
        // Convert ImageAttachment to ImageContent
        const imageContents = images.map(img => imagesClient.attachmentToImageContent(img));
        messageContent = createMixedContent(input, imageContents);
      } else {
        messageContent = input;
      }

      // DEBUG: Check state messages before sending
      console.log('[DEBUG] State messages before send:', state.messages.map(m => ({
        id: m.id,
        role: m.role,
        seq: m.seq,
        hasSeq: m.seq !== undefined
      })));

      const userMsg: ChatMessage = { id: crypto.randomUUID(), role: 'user', content: messageContent };
      const assistantMsg: ChatMessage = { id: crypto.randomUUID(), role: 'assistant', content: '' };
      assistantMsgRef.current = assistantMsg;
      toolCallMessageIdRef.current = null;
      toolCallContentLengthRef.current = 0;
      lastUsageRef.current = null;

      dispatch({
        type: 'START_STREAMING',
        payload: { abort, userMessage: userMsg, assistantMessage: assistantMsg }
      });

      // Ensure the START_STREAMING state is applied before streaming events arrive
      await new Promise(resolve => setTimeout(resolve, 0));

      const config = buildSendChatConfig([...state.messages, userMsg], abort.signal);
      await runSend(config);
    },

    /**
     * Regenerates the last assistant response
     *
     * @param baseMessages - Messages to use as context for regeneration
     */
    regenerate: async (baseMessages: ChatMessage[]) => {
      if (state.status === 'streaming' || inFlightRef.current) return;

      inFlightRef.current = true;
      const abort = new AbortController();
      const assistantMsg: ChatMessage = { id: crypto.randomUUID(), role: 'assistant', content: '' };
      assistantMsgRef.current = assistantMsg;
      toolCallMessageIdRef.current = null;
      toolCallContentLengthRef.current = 0;
      lastUsageRef.current = null;

      dispatch({
        type: 'REGENERATE_START',
        payload: { abort, baseMessages, assistantMessage: assistantMsg }
      });

      // Ensure state commit before events arrive
      await new Promise(resolve => setTimeout(resolve, 0));

      const config = buildSendChatConfig(baseMessages, abort.signal);
      await runSend(config);
    },

    /**
     * Stops the current streaming operation
     * Flushes pending throttled updates and aborts the request
     */
    stopStreaming: () => {
      // Flush any pending throttled updates
      if (throttleTimerRef.current) {
        clearTimeout(throttleTimerRef.current);
        throttleTimerRef.current = null;
      }
      try { state.abort?.abort(); } catch {}
      inFlightRef.current = false;
      dispatch({ type: 'STOP_STREAMING' });
    },

    /**
     * Starts a new chat conversation
     * Stops any ongoing streaming and clears the current state
     *
     * @param stopStreaming - Function to stop current streaming
     */
    newChat: async (stopStreaming: () => void) => {
      if (state.status === 'streaming') {
        stopStreaming();
      }

      // Align with v1 behavior: don't pre-create; first send will autocreate
      // and the sidebar will refresh on `_conversation` signal.
      dispatch({ type: 'NEW_CHAT' });
    },

    /**
     * Directly sets the message history
     * Used when loading conversations or editing messages
     *
     * @param messages - Array of chat messages
     */
    setMessages: (messages: ChatMessage[]) => {
      dispatch({ type: 'SET_MESSAGES', payload: messages });
    },
  };
}
