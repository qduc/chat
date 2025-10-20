/**
 * Test for token expiry handling and automatic login form display
 */

import { render, screen, waitFor } from '@testing-library/react';
import { AuthProvider } from '../contexts/AuthContext';
import { ProtectedRoute } from '../components/auth/ProtectedRoute';
import { AuthGate } from '../components/auth/AuthGate';
import { clearTokens, onTokensCleared } from '../lib/storage';

// Mock the storage functions
jest.mock('../lib/storage', () => ({
  ...jest.requireActual('../lib/storage'),
  getToken: jest.fn(() => null),
  getRefreshToken: jest.fn(() => null),
  clearTokens: jest.fn(),
  onTokensCleared: jest.fn((callback) => {
    // Store the callback for manual triggering in tests
    (global as any).__tokensClearedCallback = callback;
    return () => {}; // unsubscribe function
  }),
  getUserFromToken: jest.fn(() => null),
  waitForAuthReady: jest.fn(() => Promise.resolve()),
  markAuthReady: jest.fn(),
  resetAuthReady: jest.fn(),
}));

// Mock the auth API
jest.mock('../lib/api', () => ({
  auth: {
    verifySession: jest.fn(() => Promise.resolve({ valid: false, reason: 'missing-token' })),
  },
}));

describe('Token Expiry Handling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete (global as any).__tokensClearedCallback;
  });

  it('should show login form when tokens are cleared due to refresh failure', async () => {
    const TestComponent = () => (
      <AuthProvider>
        <ProtectedRoute requireAuth fallback={<AuthGate />}>
          <div>Protected Content</div>
        </ProtectedRoute>
      </AuthProvider>
    );

    render(<TestComponent />);

    // Wait for auth initialization
    await waitFor(() => {
      expect(screen.getByText('Sign in to continue')).toBeInTheDocument();
    });

    // Simulate token clearing (as would happen when refresh token expires)
    const tokensClearedCallback = (global as any).__tokensClearedCallback;
    if (tokensClearedCallback) {
      tokensClearedCallback();
    }

    // Should still show login form
    await waitFor(() => {
      expect(screen.getByText('Sign in to continue')).toBeInTheDocument();
    });
  });

  it('should register tokens cleared listener on mount', () => {
    const TestComponent = () => (
      <AuthProvider>
        <div>Test</div>
      </AuthProvider>
    );

    render(<TestComponent />);

    expect(onTokensCleared).toHaveBeenCalledWith(expect.any(Function));
  });
});
