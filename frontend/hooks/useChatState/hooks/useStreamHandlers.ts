/**
 * Stream handlers hook
 *
 * Manages streaming event processing for chat completions including
 * token updates, tool calls, tool outputs, and usage metadata.
 * Implements throttling for performance optimization.
 *
 * @module useStreamHandlers
 */

import { useCallback, useRef } from 'react';
import type { ChatMessage } from '../../../lib/chat';
import type { ChatAction } from '../types';
import { extractTextFromContent, stringToMessageContent } from '../../../lib/chat/content-utils';

/**
 * Props for the useStreamHandlers hook
 */
export interface UseStreamHandlersProps {
  /** Dispatch function for chat state updates */
  dispatch: React.Dispatch<ChatAction>;
}

/**
 * Hook for handling streaming events
 *
 * Manages stream token updates and stream events (tool calls, tool outputs, usage)
 * with throttling for performance.
 *
 * @param props - Configuration object
 * @returns Object containing refs and handler functions
 *
 * @example
 * ```typescript
 * const { assistantMsgRef, throttleTimerRef, handleStreamToken, handleStreamEvent } = useStreamHandlers({
 *   dispatch
 * });
 *
 * handleStreamToken('Hello');
 * handleStreamEvent({ type: 'tool_call', data: {...} });
 * ```
 */
export function useStreamHandlers({ dispatch }: UseStreamHandlersProps) {
  const assistantMsgRef = useRef<ChatMessage | null>(null);
  const throttleTimerRef = useRef<NodeJS.Timeout | null>(null);
  const toolCallMessageIdRef = useRef<string | null>(null);
  const toolCallContentLengthRef = useRef<number>(0);

  const handleStreamToken = useCallback((token: string) => {
    if (!token) return;
    const current = assistantMsgRef.current;
    if (!current) return;
    const assistantId = current.id;

    // Immediately update the ref (keeps tokens flowing)
    const currentText = extractTextFromContent(current.content);
    const nextContent = stringToMessageContent(currentText + token);
    const updated = { ...current, content: nextContent };
    assistantMsgRef.current = updated;

    if (!toolCallMessageIdRef.current) {
      toolCallContentLengthRef.current = extractTextFromContent(updated.content).length;
    }

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
    const currentAssistantId = assistantMsgRef.current?.id;
    if (!currentAssistantId) return;

    if (event.type === 'text' || event.type === 'reasoning' || event.type === 'final') {
      return;
    }

    if (event.type === 'tool_call') {
      const toolMessageId = toolCallMessageIdRef.current ?? currentAssistantId;
      const currentContentLength = toolCallMessageIdRef.current
        ? toolCallContentLengthRef.current
        : extractTextFromContent(assistantMsgRef.current?.content || '').length;
      const toolCallValue = event.value && typeof event.value === 'object'
        ? {
            ...event.value,
            ...(event.value.function ? { function: { ...event.value.function } } : {}),
            textOffset: currentContentLength,
          }
        : event.value;

      toolCallContentLengthRef.current = currentContentLength;

      // Let reducer manage tool_calls to avoid duplicates from local snapshot
      dispatch({ type: 'STREAM_TOOL_CALL', payload: { messageId: toolMessageId, toolCall: toolCallValue } });

      if (!toolCallMessageIdRef.current) {
        toolCallMessageIdRef.current = toolMessageId;
        const finalAssistantMessage: ChatMessage = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: '',
        };
        assistantMsgRef.current = finalAssistantMessage;
        dispatch({ type: 'APPEND_MESSAGE', payload: finalAssistantMessage });
      }
    } else if (event.type === 'tool_output') {
      const output = event.value || {};
      const outputContent = output.output;
      let normalizedContent: string;
      if (typeof outputContent === 'string') {
        normalizedContent = outputContent;
      } else if (outputContent !== undefined) {
        normalizedContent = JSON.stringify(outputContent);
      } else {
        normalizedContent = '';
      }

      const toolMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'tool',
        content: normalizedContent,
        tool_call_id: output.tool_call_id,
      };

      if (output.status) {
        (toolMessage as any).status = output.status;
      }

      dispatch({ type: 'STREAM_TOOL_OUTPUT', payload: { toolMessage } });
    } else if (event.type === 'usage') {
      // Store usage metadata in the assistant message
      dispatch({ type: 'STREAM_USAGE', payload: { messageId: currentAssistantId, usage: event.value } });
    }
  }, [dispatch]);

  return {
    assistantMsgRef,
    throttleTimerRef,
    toolCallMessageIdRef,
    toolCallContentLengthRef,
    handleStreamToken,
    handleStreamEvent,
  };
}
