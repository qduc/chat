/**
 * Storage utilities for tokens and application data
 * Consolidates localStorage access with SSR-safe guards
 */

const TOKEN_KEY = 'chatforge_auth_token';
const REFRESH_TOKEN_KEY = 'chatforge_refresh_token';

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  if (typeof window === 'undefined') return null;

  const parts = token.split('.');
  if (parts.length !== 3) {
    return null;
  }

  try {
    const base64Url = parts[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const padding = (4 - (base64.length % 4)) % 4;
    const padded = padding ? `${base64}${'='.repeat(padding)}` : base64;
    const decoded = window.atob(padded);
    return JSON.parse(decoded);
  } catch (_error) {
    return null;
  }
}

/**
 * Get the access token from localStorage
 */
export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

/**
 * Set the access token in localStorage
 */
export function setToken(token: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(TOKEN_KEY, token);
}

/**
 * Remove the access token from localStorage
 */
export function removeToken(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(TOKEN_KEY);
}

/**
 * Get the refresh token from localStorage
 */
export function getRefreshToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(REFRESH_TOKEN_KEY);
}

/**
 * Set the refresh token in localStorage
 */
export function setRefreshToken(token: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(REFRESH_TOKEN_KEY, token);
}

/**
 * Remove the refresh token from localStorage
 */
export function removeRefreshToken(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(REFRESH_TOKEN_KEY);
}

/**
 * Clear all authentication tokens
 */
export function clearTokens(): void {
  removeToken();
  removeRefreshToken();
}

/**
 * Check if a JWT token is expired
 * @param token - The JWT token to check
 * @returns true if the token is expired or invalid
 */
export function isTokenExpired(token: string): boolean {
  const payload = decodeJwtPayload(token);

  if (!payload) {
    if (typeof window !== 'undefined') {
      removeToken();
    }
    return true;
  }

  const expiresAt = typeof payload.exp === 'number' ? payload.exp : null;
  if (!expiresAt) {
    return false;
  }

  const currentTime = Math.floor(Date.now() / 1000);
  return expiresAt < currentTime;
}

/**
 * Extract user information from JWT token
 * @param token - The JWT token
 * @returns User info or null if invalid
 */
export function getUserFromToken(token: string): any | null {
  const payload = decodeJwtPayload(token);
  if (!payload) {
    return null;
  }

  const { sub, userId, email, displayName } = payload as Record<string, unknown>;
  const id = typeof sub === 'string' ? sub : typeof userId === 'string' ? userId : null;
  const emailValue = typeof email === 'string' ? email : null;
  const displayNameValue = typeof displayName === 'string' ? displayName : undefined;

  if (!id && !emailValue && displayNameValue === undefined) {
    return null;
  }

  return {
    id: id ?? undefined,
    email: emailValue ?? undefined,
    displayName: displayNameValue,
  };
}

/**
 * Check if user is authenticated with valid token
 */
export function isAuthenticated(): boolean {
  const token = getToken();
  return token !== null && !isTokenExpired(token);
}

/**
 * Auth ready state management
 * Used to coordinate authentication state during token refresh
 */
let authReady = true;
let resolver: (() => void) | null = null;
let readyPromise: Promise<void> | null = null;

function ensurePromise() {
  if (!readyPromise) {
    readyPromise = new Promise<void>((resolve) => {
      resolver = resolve;
    });
  }
}

export function waitForAuthReady(): Promise<void> {
  if (authReady) {
    return Promise.resolve();
  }

  ensurePromise();
  return readyPromise as Promise<void>;
}

export function markAuthReady() {
  authReady = true;
  resolver?.();
  resolver = null;
}

export function resetAuthReady() {
  authReady = false;
  readyPromise = null;
  resolver = null;
  ensurePromise();
}

export function setAuthReady(value: boolean) {
  if (value) {
    markAuthReady();
  } else {
    resetAuthReady();
  }
}

export function isAuthReady() {
  return authReady;
}
