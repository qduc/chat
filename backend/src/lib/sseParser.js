/**
 * Parse SSE stream chunks and extract data payloads
 * Preserves original edge-case behavior from streamingHandler.js
 *
 * - Accepts Buffer or string chunks
 * - Carries over incomplete frames via leftover return value
 * - Iterates "data:" lines within SSE events
 * - Invokes onDone() when payload is "[DONE]" (breaks inner line loop only)
 * - Attempts JSON.parse on payloads and calls onDataChunk with the object
 * - If JSON parsing fails, invokes onError(error, payload) when provided
 *
 * @param {Buffer|string} chunk - Raw chunk data from stream
 * @param {string} leftover - Incomplete data from previous chunk
 * @param {Function} onDataChunk - Callback for parsed JSON objects
 * @param {Function} onDone - Callback when [DONE] is received
 * @param {Function} onError - Optional callback for JSON parsing errors
 * @returns {string} New leftover data for next chunk
 */
export function parseSSEStream(chunk, leftover, onDataChunk, onDone, onError) {
  const s = String(chunk);
  const data = leftover + s;
  const parts = data.split(/\r?\n\r?\n/);
  const newLeftover = parts.pop() || '';

  for (const part of parts) {
    const lines = part.split(/\r?\n/);
    for (const line of lines) {
      const m = line.match(/^data:\s*(.*)$/);
      if (!m) continue;

      const payload = m[1];
      if (payload === '[DONE]') {
        onDone();
        break; // intentionally only breaks inner loop to preserve original behavior
      }

      try {
        const obj = JSON.parse(payload);
        onDataChunk(obj);
      } catch (e) {
        if (onError) onError(e, payload);
      }
    }
  }

  return newLeftover;
}

