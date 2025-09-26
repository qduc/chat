'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { User, authApi } from '../lib/auth/api';
import { getToken, isAuthenticated, getUserFromToken, clearTokens } from '../lib/auth/tokens';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName?: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

interface AuthProviderProps {
  children: React.ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // Initialize auth state
  useEffect(() => {
    initializeAuth();
  }, []);

  const initializeAuth = useCallback(async () => {
    try {
      if (isAuthenticated()) {
        const token = getToken();
        if (token) {
          // Try to get user from token first (faster)
          const userFromToken = getUserFromToken(token);
          if (userFromToken) {
            setUser(userFromToken);
          }

          // Then fetch fresh profile from server
          try {
            const profile = await authApi.getProfile();
            setUser(profile);
          } catch (error) {
            // If profile fetch fails, fall back to token data or clear auth
            console.warn('Failed to fetch user profile:', error);
            if (!userFromToken) {
              clearTokens();
              setUser(null);
            }
          }
        }
      }
    } catch (error) {
      console.error('Failed to initialize auth:', error);
      clearTokens();
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    try {
      setLoading(true);
      const response = await authApi.login(email, password);
      setUser(response.user);
    } catch (error) {
      setUser(null);
      throw error;
    } finally {
      setLoading(false);
    }
  }, []);

  const register = useCallback(async (email: string, password: string, displayName?: string) => {
    try {
      setLoading(true);
      const response = await authApi.register(email, password, displayName);
      setUser(response.user);
    } catch (error) {
      setUser(null);
      throw error;
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      setLoading(true);
      await authApi.logout();
    } catch (error) {
      console.warn('Logout request failed:', error);
    } finally {
      setUser(null);
      setLoading(false);
    }
  }, []);

  const refreshUser = useCallback(async () => {
    if (!isAuthenticated()) {
      setUser(null);
      return;
    }

    try {
      const profile = await authApi.getProfile();
      setUser(profile);
    } catch (error) {
      console.error('Failed to refresh user:', error);
      setUser(null);
      clearTokens();
    }
  }, []);

  const value: AuthContextType = {
    user,
    loading,
    login,
    register,
    logout,
    refreshUser,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}