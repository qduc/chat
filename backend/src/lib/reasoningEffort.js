/**
 * Incoming reasoning-effort normalization shared by the chat proxy and the
 * tool harness. Adapters do their own mapping; this helper does not.
 *
 * Allowed values are the five UI levels plus legacy `minimal`, which passes
 * through unchanged. `max` is rewritten to `xhigh` before the allow-list check.
 */
export const REASONING_EFFORTS = Object.freeze([
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
]);

export function normalizeReasoningEffort(value) {
  if (typeof value !== 'string') return value;
  const lowered = value.trim().toLowerCase();
  if (!lowered) return value;
  if (lowered === 'max') return 'xhigh';
  return lowered;
}
