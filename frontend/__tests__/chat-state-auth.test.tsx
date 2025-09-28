/**
 * @jest-environment jsdom
 */

import React from 'react';
import { render, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { AuthProvider } from '../contexts/AuthContext';
import { useChatState } from '../hooks/useChatState';

// Mock the auth API
jest.mock('../lib/auth/api', () => ({
  authApi: {
    login: jest.fn(),
    register: jest.fn(),
    logout: jest.fn(),
    refreshToken: jest.fn(),
    getProfile: jest.fn(),
  },
}));

// Mock token functions
jest.mock('../lib/auth/tokens', () => ({
  getToken: jest.fn(() => null),
  setToken: jest.fn(),
  setRefreshToken: jest.fn(),
  clearTokens: jest.fn(),
  removeToken: jest.fn(),
  removeRefreshToken: jest.fn(),
  isTokenExpired: jest.fn(() => false),
  getUserFromToken: jest.fn(() => null),
}));

jest.mock('../lib/auth/verification', () => ({
  verifySession: jest.fn(() => Promise.resolve({ valid: false, user: null, reason: 'missing-token' })),
}));

// Mock chat API functions
jest.mock('../lib/chat', () => ({
  sendChat: jest.fn(),
  getConversationApi: jest.fn(),
  listConversationsApi: jest.fn().mockRejectedValue(new Error('Not implemented')),
  deleteConversationApi: jest.fn(),
  editMessageApi: jest.fn(),
}));

// Test component that uses useChatState
function TestChatStateComponent() {
  const { state, actions } = useChatState();

  return (
    <div>
      <div data-testid="user-state">
        {state.user ? `User: ${state.user.email}` : 'No user'}
      </div>
      <div data-testid="auth-state">
        {state.isAuthenticated ? 'Authenticated' : 'Not authenticated'}
      </div>
      <button
        onClick={() => actions.setUser({
          id: '1',
          email: 'test@example.com',
          displayName: 'Test User',
          createdAt: '2023-01-01',
          updatedAt: '2023-01-01'
        })}
        data-testid="set-user-btn"
      >
        Set User
      </button>
      <button
        onClick={() => actions.setUser(null)}
        data-testid="clear-user-btn"
      >
        Clear User
      </button>
    </div>
  );
}

describe('ChatState Authentication Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Mock localStorage
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: jest.fn(() => null),
        setItem: jest.fn(() => null),
        removeItem: jest.fn(() => null),
      },
      writable: true,
    });
  });

  it('initializes with no user and not authenticated', () => {
    const { getByTestId } = render(
      <AuthProvider>
        <TestChatStateComponent />
      </AuthProvider>
    );

    expect(getByTestId('user-state')).toHaveTextContent('No user');
    expect(getByTestId('auth-state')).toHaveTextContent('Not authenticated');
  });

  it('updates authentication state when user is set', async () => {
    const { getByTestId } = render(
      <AuthProvider>
        <TestChatStateComponent />
      </AuthProvider>
    );

    // Initially not authenticated
    expect(getByTestId('auth-state')).toHaveTextContent('Not authenticated');

    // Set a user
    await act(async () => {
      getByTestId('set-user-btn').click();
    });

    // Should now be authenticated
    expect(getByTestId('user-state')).toHaveTextContent('User: test@example.com');
    expect(getByTestId('auth-state')).toHaveTextContent('Authenticated');
  });

  it('updates authentication state when user is cleared', async () => {
    const { getByTestId } = render(
      <AuthProvider>
        <TestChatStateComponent />
      </AuthProvider>
    );

    // Set a user first
    await act(async () => {
      getByTestId('set-user-btn').click();
    });

    expect(getByTestId('auth-state')).toHaveTextContent('Authenticated');

    // Clear the user
    await act(async () => {
      getByTestId('clear-user-btn').click();
    });

    // Should now be not authenticated
    expect(getByTestId('user-state')).toHaveTextContent('No user');
    expect(getByTestId('auth-state')).toHaveTextContent('Not authenticated');
  });

  it('provides authentication actions', () => {
    const TestComponent = () => {
      const { actions } = useChatState();

      return (
        <div>
          <div data-testid="has-set-user">
            {typeof actions.setUser === 'function' ? 'true' : 'false'}
          </div>
          <div data-testid="has-set-authenticated">
            {typeof actions.setAuthenticated === 'function' ? 'true' : 'false'}
          </div>
        </div>
      );
    };

    const { getByTestId } = render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>
    );

    expect(getByTestId('has-set-user')).toHaveTextContent('true');
    expect(getByTestId('has-set-authenticated')).toHaveTextContent('true');
  });
});