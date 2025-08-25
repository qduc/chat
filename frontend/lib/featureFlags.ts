// Feature flags for gradual rollout
export const FEATURE_FLAGS = {
  CHAT_V2: process.env.NEXT_PUBLIC_CHAT_V2 === 'true' || false,
} as const;

export function isFeatureEnabled(flag: keyof typeof FEATURE_FLAGS): boolean {
  return FEATURE_FLAGS[flag];
}