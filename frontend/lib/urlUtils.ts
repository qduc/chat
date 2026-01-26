/**
 * URL utilities for API responses
 */

/**
 * Converts a relative URL to an absolute URL using the provided API base.
 * Returns undefined for null/undefined inputs.
 * Returns the URL unchanged if it's already absolute (starts with http:// or https://).
 *
 * @param value - The URL to convert (can be relative or absolute)
 * @param apiBase - The base URL to prepend for relative paths
 * @returns The absolute URL, or undefined if value is falsy
 */
export function toAbsoluteUrl(
  value: string | null | undefined,
  apiBase: string
): string | undefined {
  if (!value) return undefined;
  if (/^https?:\/\//i.test(value)) {
    return value;
  }
  const normalized = value.startsWith('/') ? value : `/${value}`;
  return `${apiBase}${normalized}`;
}

/**
 * Resolves the API base URL for the current environment.
 * In browser: uses window.location.origin + /api
 * In SSR/Node: uses NEXT_PUBLIC_API_BASE env var or falls back to backend URL
 */
export function resolveApiBase(): string {
  if (typeof window !== 'undefined') {
    return `${window.location.origin}/api`;
  }
  return process.env.NEXT_PUBLIC_API_BASE || 'http://backend:3001/api';
}
