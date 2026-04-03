import { useCallback, useEffect, useRef, useState } from 'react';

interface ScrollButtonState {
  showTop: boolean;
  showBottom: boolean;
}

interface UseScrollControlsReturn {
  /** Ref to attach to the scrollable message-list container. */
  messageListRef: React.RefObject<HTMLDivElement>;
  /** Whether the scroll-to-top / scroll-to-bottom indicators should render. */
  scrollButtons: ScrollButtonState;
  /** Whether the buttons should be visible (auto-hides after 2 s of idle). */
  showScrollButtons: boolean;
  /** Setter forwarded to MessageList's onScrollStateChange. */
  setScrollButtons: React.Dispatch<React.SetStateAction<ScrollButtonState>>;
  /** Smooth-scroll (or instant) to the bottom of the list. */
  scrollToBottom: (behavior?: 'smooth' | 'auto') => void;
  /** Smooth-scroll to the top of the list. */
  scrollToTop: () => void;
}

/**
 * Manages scroll-button visibility and scroll helpers for the message list.
 *
 * The buttons auto-show on scroll activity and auto-hide after 2 seconds of
 * no scrolling.
 */
export function useScrollControls(): UseScrollControlsReturn {
  const messageListRef = useRef<HTMLDivElement>(null!);
  const [scrollButtons, setScrollButtons] = useState<ScrollButtonState>({
    showTop: false,
    showBottom: false,
  });
  const [showScrollButtons, setShowScrollButtons] = useState(false);
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Show / hide scroll buttons based on scroll activity
  useEffect(() => {
    const container = messageListRef.current;
    if (!container) return;

    const handleScroll = () => {
      setShowScrollButtons(true);

      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }

      scrollTimeoutRef.current = setTimeout(() => {
        setShowScrollButtons(false);
      }, 2000);
    };

    container.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      container.removeEventListener('scroll', handleScroll);
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, []);

  const scrollToTop = useCallback(() => {
    const container = messageListRef.current;
    if (!container) return;
    if (typeof container.scrollTo === 'function') {
      container.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      container.scrollTop = 0;
    }
  }, []);

  const scrollToBottom = useCallback((behavior: 'smooth' | 'auto' = 'smooth') => {
    const container = messageListRef.current;
    if (!container) return;
    if (typeof container.scrollTo === 'function') {
      container.scrollTo({ top: container.scrollHeight, behavior });
    } else {
      container.scrollTop = container.scrollHeight;
    }
  }, []);

  return {
    messageListRef,
    scrollButtons,
    showScrollButtons,
    setScrollButtons,
    scrollToBottom,
    scrollToTop,
  };
}
