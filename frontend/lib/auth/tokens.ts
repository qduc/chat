/**
 * Token management utilities for authentication
 */

const TOKEN_KEY = 'chatforge_auth_token';
const REFRESH_TOKEN_KEY = 'chatforge_refresh_token';

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
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    const currentTime = Math.floor(Date.now() / 1000);
    return payload.exp < currentTime;
  } catch (error) {
    // If we can't parse the token, consider it expired
    return true;
  }
}

/**
 * Extract user information from JWT token
 * @param token - The JWT token
 * @returns User info or null if invalid
 */
export function getUserFromToken(token: string): any | null {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return {
      id: payload.sub || payload.userId,
      email: payload.email,
      displayName: payload.displayName,
    };
  } catch (error) {
    return null;
  }
}

/**
 * Check if user is authenticated with valid token
 */
export function isAuthenticated(): boolean {
  const token = getToken();
  return token !== null && !isTokenExpired(token);
}