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
 * - `activeRequestsRef`: In-flight request IDs and their cancellation acknowledgments
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
    retryStatus: null,
  });

  const abortControllerRef = useRef<AbortController | null>(null);
  const activeRequestsRef = useRef(new Map<string, Promise<boolean> | null>());

  // Token streaming stats ref to avoid re-renders on every token
  const tokenStatsRef = useRef<{
    count: number;
    charCount: number;
    startTime: number;
    messageId: string;
    lastUpdated: number;
    provider?: string | null;
    model?: string;
    isEstimate: boolean;
    activeGenerationMs?: number;
    lastActivityStartedAt?: number | null;
    activeToolCalls?: number;
    durationMsOverride?: number;
    baseCompletionTokens?: number;
    baseCompletionMs?: number;
  } | null>(null);

  const stopStreaming = useCallback(async () => {
    const controller = abortControllerRef.current;
    const requests = activeRequestsRef.current;
    const cancellations = Array.from(requests, ([requestId, existing]) => {
      if (existing) return existing;
      const cancellation = chat
        .stopMessage({ requestId })
        .then((response) => response.stopped)
        .catch(() => false);
      requests.set(requestId, cancellation);
      return cancellation;
    });
    // Deliver the server-side stop before closing the streams, so partial replies finalize as cancelled.
    if (cancellations.length) await Promise.all(cancellations);
    if (abortControllerRef.current !== controller) return;
    controller?.abort();
    abortControllerRef.current = null;
    setStatus('idle');
    setPending((prev) => ({ ...prev, streaming: false, abort: null }));
  }, []);

  const resetStreaming = useCallback(() => {
    setStatus('idle');
    setPending({
      streaming: false,
      error: undefined,
      abort: null,
      retryStatus: null,
    });
    abortControllerRef.current = null;
    activeRequestsRef.current = new Map();
    tokenStatsRef.current = null;
  }, []);

  return {
    status,
    setStatus,
    pending,
    setPending,
    abortControllerRef,
    activeRequestsRef,
    tokenStatsRef,
    stopStreaming,
    resetStreaming,
  };
}
