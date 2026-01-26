/**
 * Authentication API module
 */

import { httpClient, HttpError } from '../http';
import { getToken, setToken, setRefreshToken, clearTokens, getRefreshToken } from '../storage';
import type {
  User,
  LoginResponse,
  RegisterResponse,
  VerifySessionReason,
  VerifySessionResult,
} from '../types';

async function refreshToken(): Promise<void> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) {
    throw new Error('No refresh token available');
  }

  try {
    const response = await httpClient.post<{ accessToken: string }>(
      '/v1/auth/refresh',
      { refreshToken },
      { skipAuth: true, skipRetry: true }
    );

    // Store new access token (refresh token remains the same)
    setToken(response.data.accessToken);
  } catch (error) {
    // Clear tokens if refresh fails
    clearTokens();
    throw error instanceof HttpError
      ? new Error(error.data?.message || 'Token refresh failed')
      : error;
  }
}

// Register the refresh function with httpClient
httpClient.setRefreshTokenFn(refreshToken);

export const auth = {
  async register(email: string, password: string, displayName?: string): Promise<RegisterResponse> {
    try {
      const response = await httpClient.post<RegisterResponse>(
        '/v1/auth/register',
        { email, password, displayName },
        { skipAuth: true }
      );

      // Store tokens
      setToken(response.data.tokens.accessToken);
      setRefreshToken(response.data.tokens.refreshToken);

      return response.data;
    } catch (error) {
      throw error instanceof HttpError
        ? new Error(error.data?.message || 'Registration failed')
        : error;
    }
  },

  async login(email: string, password: string): Promise<LoginResponse> {
    try {
      const response = await httpClient.post<LoginResponse>(
        '/v1/auth/login',
        { email, password },
        { skipAuth: true }
      );

      // Store tokens
      setToken(response.data.tokens.accessToken);
      setRefreshToken(response.data.tokens.refreshToken);

      return response.data;
    } catch (error) {
      throw error instanceof HttpError ? new Error(error.data?.message || 'Login failed') : error;
    }
  },

  async electronLogin(): Promise<LoginResponse> {
    try {
      const response = await httpClient.post<LoginResponse>(
        '/v1/auth/electron',
        {},
        { skipAuth: true }
      );

      // Store tokens
      setToken(response.data.tokens.accessToken);
      setRefreshToken(response.data.tokens.refreshToken);

      return response.data;
    } catch (error) {
      throw error instanceof HttpError
        ? new Error(error.data?.message || 'Electron login failed')
        : error;
    }
  },

  async logout(): Promise<void> {
    const token = getToken();
    const refreshTokenValue = getRefreshToken();

    // Clear tokens immediately
    clearTokens();

    // Attempt to notify server (fire and forget)
    try {
      await httpClient.post(
        '/v1/auth/logout',
        { refreshToken: refreshTokenValue },
        { skipAuth: true, headers: token ? { Authorization: `Bearer ${token}` } : {} }
      );
    } catch (error) {
      // Ignore network errors during logout
      console.warn('Failed to notify server of logout:', error);
    }
  },

  async getProfile(): Promise<User> {
    try {
      const response = await httpClient.get<{ user: User }>('/v1/auth/me');
      return response.data.user;
    } catch (error) {
      throw error instanceof HttpError
        ? new Error(error.data?.message || 'Failed to fetch profile')
        : error;
    }
  },

  async verifySession(): Promise<VerifySessionResult> {
    const token = getToken();
    if (!token) {
      return {
        valid: false,
        user: null,
        reason: 'missing-token',
      };
    }

    try {
      const user = await this.getProfile();
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

      if (reason === 'expired' || reason === 'invalid') {
        clearTokens();
      }

      return {
        valid: false,
        user: null,
        reason,
        error,
      };
    }
  },
};
