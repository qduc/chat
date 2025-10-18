import { useEffect, useRef, useState } from 'react';
import type { PendingState } from './useChat';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: any;
}

interface UseStreamingScrollReturn {
  dynamicBottomPadding: string;
  lastUserMessageRef: React.RefObject<HTMLDivElement | null>;
  toolbarRef: React.RefObject<HTMLDivElement | null>;
  bottomRef: React.RefObject<HTMLDivElement | null>;
}

/**
 * Custom hook for managing chat scrolling behavior during streaming responses.
 *
 * This hook implements a context-aware scrolling system optimized for streaming chat UX:
 *
 * 1. Dynamic Bottom Padding:
 *    - Streaming (user → assistant): 80% viewport padding
 *      → Forces user's message to scroll to top
 *      → Leaves 80% of screen available for streaming response
 *    - Not streaming: 20% viewport padding
 *      → Comfortable reading without excessive empty space
 *
 * 2. Auto-Scroll User Message to Top:
 *    - When streaming starts, automatically positions user's question at top
 *    - Assistant's response streams in the visible area below
 *    - Only triggers once when response begins (not on every update)
 *
 * @param messages - Array of chat messages
 * @param pending - Current streaming/pending state
 * @returns Refs and styles for scroll management
 */
export function useStreamingScroll(
  messages: ChatMessage[],
  pending: PendingState
): UseStreamingScrollReturn {
  const lastUserMessageRef = useRef<HTMLDivElement | null>(null);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const prevContentLength = useRef(0);
  const [dynamicBottomPadding, setDynamicBottomPadding] = useState('8rem');

  /**
   * Scrolls the user's message to the top of the viewport via the toolbar ref.
   * We scroll to the toolbar (below the message) rather than the message itself
   * to ensure the full message text is visible and naturally positioned.
   */
  const scrollUserMessageToTop = () => {
    toolbarRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
  };

  // Update dynamic padding based on viewport height and streaming state
  useEffect(() => {
    const updatePadding = () => {
      const viewportHeight = window.innerHeight;

      // If we're streaming, use 80% of viewport height for better UX
      if (pending.streaming && messages.length >= 2) {
        const lastMessage = messages[messages.length - 1];
        const secondLastMessage = messages[messages.length - 2];

        if (secondLastMessage?.role === 'user' && lastMessage?.role === 'assistant') {
          setDynamicBottomPadding(`${Math.round(viewportHeight * 0.8)}px`);
          return;
        }
      }

      // Default padding - enough space for comfortable scrolling
      setDynamicBottomPadding(`${Math.round(viewportHeight * 0.2)}px`);
    };

    updatePadding();
    window.addEventListener('resize', updatePadding);

    return () => window.removeEventListener('resize', updatePadding);
  }, [pending.streaming, messages.length, messages]);

  // Auto-scroll user message to top when streaming starts
  useEffect(() => {
    // If we just started streaming, scroll user message to top for better UX
    if (pending.streaming && messages.length >= 2) {
      const lastMessage = messages[messages.length - 1];
      const secondLastMessage = messages[messages.length - 2];

      // If the pattern is user message followed by assistant message
      if (secondLastMessage?.role === 'user' && lastMessage?.role === 'assistant') {
        const currentLength = lastMessage.content ? lastMessage.content.length : 0;
        // Scroll if content is empty (initial) or just started appearing
        if (currentLength === 0 || (currentLength > 0 && prevContentLength.current === 0)) {
          // Small delay to ensure DOM is updated
          setTimeout(() => scrollUserMessageToTop(), 50);
        }
        prevContentLength.current = currentLength;
        return;
      }
    }
    // Reset when not streaming
    prevContentLength.current = 0;
  }, [messages.length, pending.streaming, pending.abort, messages]);

  return {
    dynamicBottomPadding,
    lastUserMessageRef,
    toolbarRef,
    bottomRef,
  };
}
