const activeStreams = new Map();

/**
 * Register a stream for abort handling.
 * Returns false (without registering) if a stream with the same requestId
 * is already in-flight, preventing duplicate/overlapping requests.
 */
export function registerStreamAbort(requestId, { controller, cancelState, userId } = {}) {
  if (!requestId || !controller) return false;
  if (activeStreams.has(requestId)) return false;
  activeStreams.set(requestId, {
    controller,
    cancelState: cancelState || { cancelled: false },
    userId: userId || null,
  });
  return true;
}

export function unregisterStreamAbort(requestId) {
  if (!requestId) return;
  activeStreams.delete(requestId);
}

export function abortStream(requestId, userId = null) {
  if (!requestId) return false;
  const entry = activeStreams.get(requestId);
  if (!entry) return false;
  if (entry.userId && userId && entry.userId !== userId) return false;

  entry.cancelState.cancelled = true;
  try {
    entry.controller.abort('client_stop');
  } catch {
    // Ignore abort errors
  }
  return true;
}

export function getStreamAbortEntry(requestId) {
  if (!requestId) return null;
  return activeStreams.get(requestId) || null;
}
