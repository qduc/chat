const activeStreams = new Map();

export function registerStreamAbort(requestId, { controller, cancelState, userId } = {}) {
  if (!requestId || !controller) return;
  activeStreams.set(requestId, {
    controller,
    cancelState: cancelState || { cancelled: false },
    userId: userId || null,
  });
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
