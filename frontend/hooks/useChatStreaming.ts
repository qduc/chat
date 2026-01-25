import { useState, useCallback, useRef } from 'react';
import { chat } from '../lib';
import type { Status, PendingState } from '../lib';

/**
 * Hook for managing chat streaming state and abort controls.
 *
 * Handles:
 * - Streaming status (idle, streaming)
 * - Abort controller for cancelling in-flight requests
 * - Token statistics tracking for real-time display
 * - Pending state with error tracking
 *
 * @returns Streaming state and controls:
 * - `status` / `setStatus`: Current streaming status
 * - `pending` / `setPending`: Pending state with error info
 * - `abortControllerRef`: Ref to current AbortController
 * - `currentRequestIdRef`: Ref to current request ID for abort API
 * - `tokenStatsRef`: Ref to live token statistics
 * - `stopStreaming()`: Abort current stream and notify backend
 * - `resetStreaming()`: Reset all streaming state
 */
export function useChatStreaming() {
  const [status, setStatus] = useState<Status>('idle');
  const [pending, setPending] = useState<PendingState>({
    streaming: false,
    error: undefined,
    abort: null,
  });

  const abortControllerRef = useRef<AbortController | null>(null);
  const currentRequestIdRef = useRef<string | null>(null);

  // Token streaming stats ref to avoid re-renders on every token
  const tokenStatsRef = useRef<{
    count: number;
    charCount: number;
    startTime: number;
    messageId: string;
    lastUpdated: number;
    provider?: string;
    isEstimate: boolean;
  } | null>(null);

  const stopStreaming = useCallback(() => {
    const requestId = currentRequestIdRef.current;
    if (requestId) {
      void chat.stopMessage({ requestId });
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setStatus('idle');
    setPending((prev) => ({ ...prev, streaming: false, abort: null }));
  }, []);

  const resetStreaming = useCallback(() => {
    setStatus('idle');
    setPending({
      streaming: false,
      error: undefined,
      abort: null,
    });
    abortControllerRef.current = null;
    currentRequestIdRef.current = null;
    tokenStatsRef.current = null;
  }, []);

  return {
    status,
    setStatus,
    pending,
    setPending,
    abortControllerRef,
    currentRequestIdRef,
    tokenStatsRef,
    stopStreaming,
    resetStreaming,
  };
}
