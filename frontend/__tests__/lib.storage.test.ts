/**
 * Tests for storage utilities
 * @jest-environment jsdom
 */

import {
  getToken,
  setToken,
  removeToken,
  getRefreshToken,
  setRefreshToken,
  removeRefreshToken,
  clearTokens,
  isTokenExpired,
  getUserFromToken,
  isAuthenticated,
  waitForAuthReady,
  setAuthReady,
  isAuthReady,
  onTokensCleared,
  getDraft,
  setDraft,
  clearDraft,
  clearAllDrafts,
} from '../lib/storage';

// Mock localStorage
const mockLocalStorage = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: jest.fn((key: string) => store[key] ?? null),
    setItem: jest.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: jest.fn((key: string) => {
      delete store[key];
    }),
    clear: jest.fn(() => {
      store = {};
    }),
    key: jest.fn((index: number) => Object.keys(store)[index] ?? null),
    get length() {
      return Object.keys(store).length;
    },
    _getStore: () => store,
    _setStore: (newStore: Record<string, string>) => {
      store = newStore;
    },
  };
})();

Object.defineProperty(window, 'localStorage', {
  value: mockLocalStorage,
  writable: true,
});

// Helper to create a valid JWT token
function createJWT(payload: Record<string, unknown>): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodePart = (obj: Record<string, unknown>) =>
    btoa(JSON.stringify(obj)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${encodePart(header)}.${encodePart(payload)}.signature`;
}

describe('storage utilities', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLocalStorage.clear();
    mockLocalStorage._setStore({});
    // Reset auth ready state
    setAuthReady(true);
  });

  describe('Token management', () => {
    describe('getToken', () => {
      it('returns null when no token exists', () => {
        expect(getToken()).toBeNull();
      });

      it('returns the stored token', () => {
        mockLocalStorage._setStore({ chatforge_auth_token: 'test-token' });
        expect(getToken()).toBe('test-token');
      });
    });

    describe('setToken', () => {
      it('stores the token in localStorage', () => {
        setToken('new-token');
        expect(mockLocalStorage.setItem).toHaveBeenCalledWith('chatforge_auth_token', 'new-token');
      });
    });

    describe('removeToken', () => {
      it('removes the token from localStorage', () => {
        mockLocalStorage._setStore({ chatforge_auth_token: 'test-token' });
        removeToken();
        expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('chatforge_auth_token');
      });
    });

    describe('getRefreshToken', () => {
      it('returns null when no refresh token exists', () => {
        expect(getRefreshToken()).toBeNull();
      });

      it('returns the stored refresh token', () => {
        mockLocalStorage._setStore({ chatforge_refresh_token: 'refresh-token' });
        expect(getRefreshToken()).toBe('refresh-token');
      });
    });

    describe('setRefreshToken', () => {
      it('stores the refresh token in localStorage', () => {
        setRefreshToken('new-refresh-token');
        expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
          'chatforge_refresh_token',
          'new-refresh-token'
        );
      });
    });

    describe('removeRefreshToken', () => {
      it('removes the refresh token from localStorage', () => {
        mockLocalStorage._setStore({ chatforge_refresh_token: 'refresh-token' });
        removeRefreshToken();
        expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('chatforge_refresh_token');
      });
    });

    describe('clearTokens', () => {
      it('removes both tokens and notifies listeners', () => {
        const listener = jest.fn();
        const unsubscribe = onTokensCleared(listener);

        mockLocalStorage._setStore({
          chatforge_auth_token: 'token',
          chatforge_refresh_token: 'refresh',
        });

        clearTokens();

        expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('chatforge_auth_token');
        expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('chatforge_refresh_token');
        expect(listener).toHaveBeenCalled();

        unsubscribe();
      });
    });
  });

  describe('JWT utilities', () => {
    describe('isTokenExpired', () => {
      it('returns true for invalid token format', () => {
        expect(isTokenExpired('invalid')).toBe(true);
        expect(isTokenExpired('a.b')).toBe(true);
        expect(isTokenExpired('')).toBe(true);
      });

      it('returns true for expired token', () => {
        const expiredPayload = { exp: Math.floor(Date.now() / 1000) - 3600 }; // 1 hour ago
        const token = createJWT(expiredPayload);
        expect(isTokenExpired(token)).toBe(true);
      });

      it('returns false for valid non-expired token', () => {
        const validPayload = { exp: Math.floor(Date.now() / 1000) + 3600 }; // 1 hour from now
        const token = createJWT(validPayload);
        expect(isTokenExpired(token)).toBe(false);
      });

      it('returns false when token has no expiration', () => {
        const noExpPayload = { sub: 'user-123' };
        const token = createJWT(noExpPayload);
        expect(isTokenExpired(token)).toBe(false);
      });
    });

    describe('getUserFromToken', () => {
      it('returns null for invalid token', () => {
        expect(getUserFromToken('invalid')).toBeNull();
      });

      it('extracts user info from valid token', () => {
        const payload = {
          sub: 'user-123',
          email: 'test@example.com',
          displayName: 'Test User',
        };
        const token = createJWT(payload);
        const user = getUserFromToken(token);

        expect(user).toEqual({
          id: 'user-123',
          email: 'test@example.com',
          displayName: 'Test User',
        });
      });

      it('handles token with userId instead of sub', () => {
        const payload = {
          userId: 'user-456',
          email: 'alt@example.com',
        };
        const token = createJWT(payload);
        const user = getUserFromToken(token);

        expect(user?.id).toBe('user-456');
        expect(user?.email).toBe('alt@example.com');
      });

      it('returns null when no identifying info', () => {
        const payload = { foo: 'bar' };
        const token = createJWT(payload);
        expect(getUserFromToken(token)).toBeNull();
      });
    });

    describe('isAuthenticated', () => {
      it('returns false when no token exists', () => {
        expect(isAuthenticated()).toBe(false);
      });

      it('returns false when token is expired', () => {
        const expiredPayload = { exp: Math.floor(Date.now() / 1000) - 3600 };
        const token = createJWT(expiredPayload);
        mockLocalStorage._setStore({ chatforge_auth_token: token });

        expect(isAuthenticated()).toBe(false);
      });

      it('returns true when valid non-expired token exists', () => {
        const validPayload = { exp: Math.floor(Date.now() / 1000) + 3600 };
        const token = createJWT(validPayload);
        mockLocalStorage._setStore({ chatforge_auth_token: token });

        expect(isAuthenticated()).toBe(true);
      });
    });
  });

  describe('Auth ready state', () => {
    describe('waitForAuthReady', () => {
      it('resolves immediately when auth is ready', async () => {
        setAuthReady(true);
        await expect(waitForAuthReady()).resolves.toBeUndefined();
      });

      it('waits when auth is not ready', async () => {
        setAuthReady(false);

        let resolved = false;
        const promise = waitForAuthReady().then(() => {
          resolved = true;
        });

        // Should not be resolved yet
        await Promise.resolve();
        expect(resolved).toBe(false);

        // Now mark as ready
        setAuthReady(true);
        await promise;
        expect(resolved).toBe(true);
      });
    });

    describe('isAuthReady', () => {
      it('returns current auth ready state', () => {
        setAuthReady(true);
        expect(isAuthReady()).toBe(true);

        setAuthReady(false);
        expect(isAuthReady()).toBe(false);
      });
    });
  });

  describe('Token cleared listeners', () => {
    it('notifies listeners when tokens are cleared', () => {
      const listener1 = jest.fn();
      const listener2 = jest.fn();

      const unsub1 = onTokensCleared(listener1);
      const unsub2 = onTokensCleared(listener2);

      clearTokens();

      expect(listener1).toHaveBeenCalledTimes(1);
      expect(listener2).toHaveBeenCalledTimes(1);

      unsub1();
      unsub2();
    });

    it('unsubscribe removes listener', () => {
      const listener = jest.fn();
      const unsub = onTokensCleared(listener);

      unsub();
      clearTokens();

      expect(listener).not.toHaveBeenCalled();
    });

    it('handles listener errors gracefully', () => {
      const errorListener = jest.fn(() => {
        throw new Error('Listener error');
      });
      const normalListener = jest.fn();

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      const unsub1 = onTokensCleared(errorListener);
      const unsub2 = onTokensCleared(normalListener);

      clearTokens();

      // Both listeners should be called, error should be caught
      expect(errorListener).toHaveBeenCalled();
      expect(normalListener).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
      unsub1();
      unsub2();
    });
  });

  describe('Draft message persistence', () => {
    const userId = 'user-123';
    const convId = 'conv-456';

    describe('getDraft', () => {
      it('returns null when no draft exists', () => {
        expect(getDraft(userId, convId)).toBeNull();
      });

      it('returns null for empty userId', () => {
        expect(getDraft('', convId)).toBeNull();
      });

      it('returns stored draft', () => {
        mockLocalStorage._setStore({
          [`chatforge_draft_${userId}_${convId}`]: 'Hello world',
        });
        expect(getDraft(userId, convId)).toBe('Hello world');
      });

      it('handles null conversationId (new chat)', () => {
        mockLocalStorage._setStore({
          [`chatforge_draft_${userId}_new`]: 'New message',
        });
        expect(getDraft(userId, null)).toBe('New message');
      });
    });

    describe('setDraft', () => {
      it('stores draft in localStorage', () => {
        setDraft(userId, convId, 'Draft message');
        expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
          `chatforge_draft_${userId}_${convId}`,
          'Draft message'
        );
      });

      it('removes draft when text is empty', () => {
        setDraft(userId, convId, '   ');
        expect(mockLocalStorage.removeItem).toHaveBeenCalledWith(
          `chatforge_draft_${userId}_${convId}`
        );
      });

      it('does nothing for empty userId', () => {
        setDraft('', convId, 'Draft');
        expect(mockLocalStorage.setItem).not.toHaveBeenCalled();
      });

      it('handles null conversationId (new chat)', () => {
        setDraft(userId, null, 'New draft');
        expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
          `chatforge_draft_${userId}_new`,
          'New draft'
        );
      });
    });

    describe('clearDraft', () => {
      it('removes draft from localStorage', () => {
        clearDraft(userId, convId);
        expect(mockLocalStorage.removeItem).toHaveBeenCalledWith(
          `chatforge_draft_${userId}_${convId}`
        );
      });

      it('does nothing for empty userId', () => {
        clearDraft('', convId);
        expect(mockLocalStorage.removeItem).not.toHaveBeenCalled();
      });
    });

    describe('clearAllDrafts', () => {
      it('removes all drafts for a user', () => {
        mockLocalStorage._setStore({
          [`chatforge_draft_${userId}_conv1`]: 'Draft 1',
          [`chatforge_draft_${userId}_conv2`]: 'Draft 2',
          [`chatforge_draft_other-user_conv1`]: 'Other draft',
          chatforge_auth_token: 'token',
        });

        clearAllDrafts(userId);

        // Should have removed both user drafts
        expect(mockLocalStorage.removeItem).toHaveBeenCalledWith(`chatforge_draft_${userId}_conv1`);
        expect(mockLocalStorage.removeItem).toHaveBeenCalledWith(`chatforge_draft_${userId}_conv2`);
        expect(mockLocalStorage.removeItem).toHaveBeenCalledTimes(2);
      });

      it('does nothing for empty userId', () => {
        clearAllDrafts('');
        expect(mockLocalStorage.removeItem).not.toHaveBeenCalled();
      });
    });
  });
});
