/** Canonical reasoning efforts exposed by the API and the UI. */
export const REASONING_EFFORTS = Object.freeze(['none', 'low', 'medium', 'high', 'xhigh']);

const LEGACY_REASONING_EFFORTS = {
  minimal: 'low',
  max: 'xhigh',
};

/**
 * Map a stored or incoming effort onto the canonical set.
 * `minimal` becomes `low` and `max` becomes `xhigh`. Other strings are
 * trimmed and lowercased so `High` matches the allow-list. Null and
 * non-strings pass through.
 */
export function normalizeReasoningEffort(value) {
  if (typeof value !== 'string') return value;
  const lowered = value.trim().toLowerCase();
  if (!lowered) return value;
  return LEGACY_REASONING_EFFORTS[lowered] || lowered;
}
