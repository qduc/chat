/**
 * Authentication API client for user registration, login, and token refresh
 */

import { getToken, setToken, setRefreshToken, clearTokens, getRefreshToken } from './tokens';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:3001';

export interface User {
  id: string;
  email: string;
  displayName?: string;
  createdAt: string;
  updatedAt: string;
}

export interface LoginResponse {
  tokens: {
    accessToken: string;
    refreshToken: string;
  };
  user: User;
}

export interface RegisterResponse {
  tokens: {
    accessToken: string;
    refreshToken: string;
  };
  user: User;
}

export interface AuthApiClient {
  register: (email: string, password: string, displayName?: string) => Promise<RegisterResponse>;
  login: (email: string, password: string) => Promise<LoginResponse>;
  logout: () => Promise<void>;
  refreshToken: () => Promise<{ accessToken: string }>;
  getProfile: () => Promise<User>;
}

class AuthApiClientImpl implements AuthApiClient {
  async register(email: string, password: string, displayName?: string): Promise<RegisterResponse> {
    const response = await fetch(`${API_BASE}/v1/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({
        email,
        password,
        displayName,
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Registration failed' }));
      throw new Error(error.message || 'Registration failed');
    }

    const data = await response.json();

    // Store tokens
    setToken(data.tokens.accessToken);
    setRefreshToken(data.tokens.refreshToken);

    return data;
  }

  async login(email: string, password: string): Promise<LoginResponse> {
    const response = await fetch(`${API_BASE}/v1/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({
        email,
        password,
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Login failed' }));
      throw new Error(error.message || 'Login failed');
    }

    const data = await response.json();

    // Store tokens
    setToken(data.tokens.accessToken);
    setRefreshToken(data.tokens.refreshToken);

    return data;
  }

  async logout(): Promise<void> {
    const token = getToken();
    const refreshToken = getRefreshToken();

    // Clear tokens immediately
    clearTokens();

    // Attempt to notify server (fire and forget)
    try {
      await fetch(`${API_BASE}/v1/auth/logout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token && { 'Authorization': `Bearer ${token}` }),
        },
        credentials: 'include',
        body: JSON.stringify({ refreshToken }),
      });
    } catch (error) {
      // Ignore network errors during logout
      console.warn('Failed to notify server of logout:', error);
    }
  }

  async refreshToken(): Promise<{ accessToken: string }> {
    const refreshToken = getRefreshToken();
    if (!refreshToken) {
      throw new Error('No refresh token available');
    }

    const response = await fetch(`${API_BASE}/v1/auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({ refreshToken }),
    });

    if (!response.ok) {
      // Clear tokens if refresh fails
      clearTokens();
      const error = await response.json().catch(() => ({ message: 'Token refresh failed' }));
      throw new Error(error.message || 'Token refresh failed');
    }

    const data = await response.json();

    // Store new access token (refresh token remains the same)
    setToken(data.accessToken);

    return data;
  }

  async getProfile(): Promise<User> {
    const token = getToken();
    if (!token) {
      throw new Error('Not authenticated');
    }

    const response = await fetch(`${API_BASE}/v1/auth/me`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      credentials: 'include',
    });

    if (response.status === 401) {
      // Try to refresh token
      try {
        await this.refreshToken();
        // Retry with new token
        const newToken = getToken();
        const retryResponse = await fetch(`${API_BASE}/v1/auth/me`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${newToken}`,
            'Content-Type': 'application/json',
          },
          credentials: 'include',
        });

        if (!retryResponse.ok) {
          throw new Error('Profile fetch failed after token refresh');
        }

        const retryData = await retryResponse.json();
        return retryData.user;
      } catch (refreshError) {
        clearTokens();
        throw new Error('Authentication expired');
      }
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Failed to fetch profile' }));
      throw new Error(error.message || 'Failed to fetch profile');
    }

    const data = await response.json();
    return data.user;
  }
}

export const authApi = new AuthApiClientImpl();