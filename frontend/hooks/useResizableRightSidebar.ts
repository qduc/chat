import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

const DEFAULT_RIGHT_SIDEBAR_WIDTH = 320;
const MIN_RIGHT_SIDEBAR_WIDTH = 260;
const MAX_RIGHT_SIDEBAR_WIDTH = 560;

interface UseResizableRightSidebarOptions {
  collapsed: boolean;
}

interface UseResizableRightSidebarReturn {
  width: number;
  isResizing: boolean;
  handleResizeStart: (event: ReactPointerEvent<HTMLDivElement>) => void;
  handleResizeDoubleClick: () => void;
}

/**
 * Encapsulates right-sidebar drag-to-resize behaviour including pointer
 * tracking, clamping, localStorage persistence, and body cursor overrides.
 */
export function useResizableRightSidebar({
  collapsed,
}: UseResizableRightSidebarOptions): UseResizableRightSidebarReturn {
  const [width, setWidth] = useState(DEFAULT_RIGHT_SIDEBAR_WIDTH);
  const [isResizing, setIsResizing] = useState(false);

  const resizeStateRef = useRef({ startX: 0, startWidth: DEFAULT_RIGHT_SIDEBAR_WIDTH });
  const isResizingRef = useRef(false);
  const nextWidthRef = useRef(DEFAULT_RIGHT_SIDEBAR_WIDTH);
  const frameRef = useRef<number | null>(null);

  // Restore persisted width on mount
  useEffect(() => {
    const storedWidth =
      typeof window !== 'undefined' ? window.localStorage.getItem('rightSidebarWidth') : null;
    if (!storedWidth) return;
    const parsed = Number.parseInt(storedWidth, 10);
    if (Number.isFinite(parsed)) {
      const clamped = Math.min(Math.max(parsed, MIN_RIGHT_SIDEBAR_WIDTH), MAX_RIGHT_SIDEBAR_WIDTH);
      nextWidthRef.current = clamped;
      setWidth(clamped);
    }
  }, []);

  // Persist width to localStorage whenever it changes (unless collapsed)
  useEffect(() => {
    if (collapsed) return;
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('rightSidebarWidth', String(width));
  }, [width, collapsed]);

  const clampWidth = useCallback((value: number) => {
    return Math.min(Math.max(value, MIN_RIGHT_SIDEBAR_WIDTH), MAX_RIGHT_SIDEBAR_WIDTH);
  }, []);

  const stopResizing = useCallback(() => {
    if (!isResizingRef.current) return;
    isResizingRef.current = false;
    setIsResizing(false);
    if (frameRef.current !== null && typeof window !== 'undefined') {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    setWidth(nextWidthRef.current);
  }, []);

  const scheduleWidthUpdate = useCallback(
    (value: number) => {
      const clamped = clampWidth(value);
      nextWidthRef.current = clamped;

      if (typeof window === 'undefined') {
        setWidth(clamped);
        return;
      }

      if (frameRef.current !== null) {
        return;
      }

      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = null;
        setWidth(nextWidthRef.current);
      });
    },
    [clampWidth]
  );

  const handleResizeMove = useCallback(
    (event: PointerEvent) => {
      if (!isResizingRef.current) return;
      const delta = resizeStateRef.current.startX - event.clientX;
      const nextWidth = resizeStateRef.current.startWidth + delta;
      scheduleWidthUpdate(nextWidth);
    },
    [scheduleWidthUpdate]
  );

  // Attach global pointer listeners
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handlePointerMove = (event: PointerEvent) => handleResizeMove(event);
    const handlePointerUp = () => stopResizing();
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [handleResizeMove, stopResizing]);

  const handleResizeStart = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (collapsed) return;
      resizeStateRef.current = {
        startX: event.clientX,
        startWidth: width,
      };
      isResizingRef.current = true;
      setIsResizing(true);
    },
    [width, collapsed]
  );

  const handleResizeDoubleClick = useCallback(() => {
    if (collapsed) return;
    nextWidthRef.current = clampWidth(DEFAULT_RIGHT_SIDEBAR_WIDTH);
    setWidth(nextWidthRef.current);
  }, [clampWidth, collapsed]);

  // Stop resizing when sidebar collapses
  useEffect(() => {
    if (!collapsed) return;
    stopResizing();
  }, [collapsed, stopResizing]);

  // Body cursor override while resizing
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (!isResizing) {
      document.body.style.removeProperty('cursor');
      document.body.style.removeProperty('user-select');
      return;
    }

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };
  }, [isResizing]);

  // Cleanup animation frame on unmount
  useEffect(() => {
    return () => {
      if (frameRef.current !== null && typeof window !== 'undefined') {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, []);

  return { width, isResizing, handleResizeStart, handleResizeDoubleClick };
}
