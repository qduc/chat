import { useCallback, useRef } from 'react';
import type { ChatMessage } from '../../../lib/chat';
import type { ChatAction } from '../types';
import { extractTextFromContent, stringToMessageContent } from '../../../lib/chat/content-utils';

export interface UseStreamHandlersProps {
  dispatch: React.Dispatch<ChatAction>;
}

/**
 * Hook for handling streaming events
 *
 * Manages stream token updates and stream events (tool calls, tool outputs, usage)
 * with throttling for performance.
 */
export function useStreamHandlers({ dispatch }: UseStreamHandlersProps) {
  const assistantMsgRef = useRef<ChatMessage | null>(null);
  const throttleTimerRef = useRef<NodeJS.Timeout | null>(null);

  const handleStreamToken = useCallback((token: string) => {
    if (!token) return;
    const current = assistantMsgRef.current;
    if (!current) return;
    const assistantId = current.id;

    // Immediately update the ref (keeps tokens flowing)
    const currentText = extractTextFromContent(current.content);
    const nextContent = stringToMessageContent(currentText + token);
    assistantMsgRef.current = { ...current, content: nextContent };

    // Throttle React state updates to 60fps
    if (!throttleTimerRef.current) {
      throttleTimerRef.current = setTimeout(() => {
        if (assistantMsgRef.current) {
          dispatch({
            type: 'STREAM_TOKEN',
            payload: {
              messageId: assistantId,
              token: '', // Token already in ref
              fullContent: extractTextFromContent(assistantMsgRef.current.content) // Pass full content as string
            }
          });
        }
        throttleTimerRef.current = null;
      }, 16); // ~60fps
    }
  }, [dispatch]);

  const handleStreamEvent = useCallback((event: any) => {
    const assistantId = assistantMsgRef.current?.id;
    if (!assistantId) return;

    if (event.type === 'text' || event.type === 'reasoning' || event.type === 'final') {
      return;
    }

    if (event.type === 'tool_call') {
      const currentContentLength = extractTextFromContent(assistantMsgRef.current?.content || '').length;
      const toolCallValue = event.value && typeof event.value === 'object'
        ? {
            ...event.value,
            ...(event.value.function ? { function: { ...event.value.function } } : {}),
            textOffset: currentContentLength,
          }
        : event.value;

      // Let reducer manage tool_calls to avoid duplicates from local snapshot
      dispatch({ type: 'STREAM_TOOL_CALL', payload: { messageId: assistantId, toolCall: toolCallValue } });
    } else if (event.type === 'tool_output') {
      // Let reducer manage tool_outputs to avoid duplicates from local snapshot
      dispatch({ type: 'STREAM_TOOL_OUTPUT', payload: { messageId: assistantId, toolOutput: event.value } });
    } else if (event.type === 'usage') {
      // Store usage metadata in the assistant message
      dispatch({ type: 'STREAM_USAGE', payload: { messageId: assistantId, usage: event.value } });
    }
  }, [dispatch]);

  return {
    assistantMsgRef,
    throttleTimerRef,
    handleStreamToken,
    handleStreamEvent,
  };
}
