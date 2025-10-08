// Backwards-compatible shim for tests and legacy callers that import from
// `../lib/auth/tokens`. The implementation was consolidated into
// `../lib/storage.ts` during the refactor; re-export the token helpers here
// to preserve the old import path used in tests.

export { getToken, setToken, removeToken, getRefreshToken, setRefreshToken, removeRefreshToken, clearTokens, isTokenExpired, getUserFromToken } from '../storage';
