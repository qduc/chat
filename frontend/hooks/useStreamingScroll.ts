import { useCallback, useEffect, useRef, useState } from 'react';
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
  pending: PendingState,
  containerRef?: React.RefObject<HTMLElement | null>
): UseStreamingScrollReturn {
  const lastUserMessageRef = useRef<HTMLDivElement | null>(null);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const prevContentLength = useRef(0);
  const lastScrolledMessageId = useRef<string | null>(null);
  const [dynamicBottomPadding, setDynamicBottomPadding] = useState('8rem');

  /**
   * Scrolls to show only the last 3 lines of the user's message at the top of viewport.
   * This creates a natural reading flow where the user sees their question's conclusion
   * followed immediately by the streaming assistant response.
   * Accounts for ChatHeader height to position content correctly below the sticky header.
   */
  const scrollUserMessageToTop = useCallback(
    (offset = 0) => {
      console.log('scrollUserMessageToTop called with offset:', offset);
      const element = lastUserMessageRef.current;
      const container = containerRef?.current;
      if (!element || !container) {
        return;
      }

      // Get the element's dimensions
      const elementHeight = element.offsetHeight;
      const lineHeight = parseFloat(getComputedStyle(element).lineHeight) || 24; // fallback to 24px
      const linesToShow = 5;
      const heightToShow = lineHeight * linesToShow;

      // Calculate how much of the message to hide (from the top)
      const hideHeight = Math.max(0, elementHeight - heightToShow);

      // Find ChatHeader height if it exists
      const header = document.querySelector('header');
      const headerHeight = header ? header.offsetHeight : 0;

      // Calculate the target scroll position
      // Element's top relative to container + amount to hide - header height - offset
      const targetScrollTop = element.offsetTop + hideHeight - headerHeight + offset;

      // Single smooth scroll to final position
      // JSDOM in tests doesn't provide element.scrollTo, so fallback to setting scrollTop.
      if (typeof (container as any).scrollTo === 'function') {
        (container as any).scrollTo({ top: targetScrollTop, behavior: 'smooth' });
      } else {
        // Fallback for environments without scrollTo (JSDOM)
        container.scrollTop = targetScrollTop;
      }
    },
    [containerRef]
  );

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
    if (pending.streaming) {
      if (messages.length >= 2) {
        const lastMessage = messages[messages.length - 1];
        const secondLastMessage = messages[messages.length - 2];

        // If the pattern is user message followed by assistant message
        if (secondLastMessage?.role === 'user' && lastMessage?.role === 'assistant') {
          const currentLength = lastMessage.content ? lastMessage.content.length : 0;

          const isNewMessage = lastMessage.id !== lastScrolledMessageId.current;
          if (isNewMessage) {
            lastScrolledMessageId.current = lastMessage.id;
          }

          // Scroll if:
          // 1. It's a brand new message (initial scroll)
          // 2. OR text just started appearing (transition from 0 to >0)
          // This avoids repeated scrolling when tool calls are appended while content is still empty
          if (isNewMessage || (currentLength > 0 && prevContentLength.current === 0)) {
            // Small delay to ensure DOM is updated
            setTimeout(() => scrollUserMessageToTop(60), 50);
          }
          prevContentLength.current = currentLength;
        }
      }
    } else {
      // Reset when not streaming
      prevContentLength.current = 0;
      lastScrolledMessageId.current = null;
    }
  }, [messages.length, pending.streaming, pending.abort, messages, scrollUserMessageToTop]);

  return {
    dynamicBottomPadding,
    lastUserMessageRef,
    toolbarRef,
    bottomRef,
  };
}
