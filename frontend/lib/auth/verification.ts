import { authApi, type User } from './api';
import { clearTokens, getToken } from './tokens';

export type VerifySessionReason =
  | 'missing-token'
  | 'expired'
  | 'invalid'
  | 'network'
  | 'unknown';

export interface VerifySessionResult {
  valid: boolean;
  user: User | null;
  reason?: VerifySessionReason;
  error?: unknown;
}

function shouldClearTokens(reason?: VerifySessionReason) {
  return reason === 'expired' || reason === 'invalid';
}

export async function verifySession(): Promise<VerifySessionResult> {
  const token = getToken();
  if (!token) {
    return {
      valid: false,
      user: null,
      reason: 'missing-token',
    };
  }

  try {
    const user = await authApi.getProfile();
    return {
      valid: true,
      user,
    };
  } catch (error) {
    let reason: VerifySessionReason = 'unknown';

    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      if (message.includes('expired') || message.includes('not authenticated')) {
        reason = 'expired';
      } else if (message.includes('invalid')) {
        reason = 'invalid';
      } else if (message.includes('network') || message.includes('fetch')) {
        reason = 'network';
      }
    }

    if (shouldClearTokens(reason)) {
      clearTokens();
    }

    return {
      valid: false,
      user: null,
      reason,
      error,
    };
  }
}
