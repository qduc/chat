import type { ChatMessage } from '../../../lib/chat';
import { sendChat } from '../../../lib/chat';
import { createMixedContent } from '../../../lib/chat/content-utils';
import { imagesClient } from '../../../lib/chat/images';
import type { ChatState, ChatAction } from '../types';

export interface ChatActionsProps {
  state: ChatState;
  dispatch: React.Dispatch<ChatAction>;
  inFlightRef: React.MutableRefObject<boolean>;
  assistantMsgRef: React.MutableRefObject<ChatMessage | null>;
  throttleTimerRef: React.MutableRefObject<NodeJS.Timeout | null>;
  buildSendChatConfig: (messages: ChatMessage[], signal: AbortSignal) => any;
  runSend: (config: Parameters<typeof sendChat>[0]) => Promise<void>;
}

export function createChatActions({
  state,
  dispatch,
  inFlightRef,
  assistantMsgRef,
  throttleTimerRef,
  buildSendChatConfig,
  runSend,
}: ChatActionsProps) {
  return {
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

      const userMsg: ChatMessage = { id: crypto.randomUUID(), role: 'user', content: messageContent };
      const assistantMsg: ChatMessage = { id: crypto.randomUUID(), role: 'assistant', content: '' };
      assistantMsgRef.current = assistantMsg;

      dispatch({
        type: 'START_STREAMING',
        payload: { abort, userMessage: userMsg, assistantMessage: assistantMsg }
      });

      // Ensure the START_STREAMING state is applied before streaming events arrive
      await new Promise(resolve => setTimeout(resolve, 0));

      const config = buildSendChatConfig([...state.messages, userMsg], abort.signal);
      await runSend(config);
    },

    regenerate: async (baseMessages: ChatMessage[]) => {
      if (state.status === 'streaming' || inFlightRef.current) return;

      inFlightRef.current = true;
      const abort = new AbortController();
      const assistantMsg: ChatMessage = { id: crypto.randomUUID(), role: 'assistant', content: '' };
      assistantMsgRef.current = assistantMsg;

      dispatch({
        type: 'REGENERATE_START',
        payload: { abort, baseMessages, assistantMessage: assistantMsg }
      });

      // Ensure state commit before events arrive
      await new Promise(resolve => setTimeout(resolve, 0));

      const config = buildSendChatConfig(baseMessages, abort.signal);
      await runSend(config);
    },

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

    newChat: async (stopStreaming: () => void) => {
      if (state.status === 'streaming') {
        stopStreaming();
      }

      // Align with v1 behavior: don't pre-create; first send will autocreate
      // and the sidebar will refresh on `_conversation` signal.
      dispatch({ type: 'NEW_CHAT' });
    },

    setMessages: (messages: ChatMessage[]) => {
      dispatch({ type: 'SET_MESSAGES', payload: messages });
    },
  };
}
