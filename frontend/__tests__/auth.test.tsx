/**
 * @jest-environment jsdom
 */

import React from 'react';
import { act, render, screen, fireEvent, waitFor, waitForElementToBeRemoved } from '@testing-library/react';
import '@testing-library/jest-dom';

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

// Mock verification helper
jest.mock('../lib/auth/verification', () => ({
  verifySession: jest.fn(() => Promise.resolve({ valid: false, user: null, reason: 'missing-token' })),
}));

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

// Import components after mocks are set up
import { AuthProvider, useAuth } from '../contexts/AuthContext';
import { AuthButton } from '../components/auth/AuthButton';
import { AuthModal } from '../components/auth/AuthModal';
import { LoginForm } from '../components/auth/LoginForm';
import { RegisterForm } from '../components/auth/RegisterForm';
import { authApi } from '../lib/auth/api';
import { verifySession } from '../lib/auth/verification';

function AuthButtonWithModal() {
  const [open, setOpen] = React.useState(false);
  const [mode, setMode] = React.useState<'login' | 'register'>('login');

  return (
    <>
      <AuthButton
        onShowLogin={() => {
          setMode('login');
          setOpen(true);
        }}
        onShowRegister={() => {
          setMode('register');
          setOpen(true);
        }}
      />
      <AuthModal
        open={open}
        onClose={() => setOpen(false)}
        initialMode={mode}
      />
    </>
  );
}

async function renderWithAuth(children: React.ReactNode) {
  let utils: ReturnType<typeof render>;

  await act(async () => {
    utils = render(
      <AuthProvider>
        {children}
      </AuthProvider>
    );
  });

  const loadingNode = screen.queryByText('Loading...');
  if (loadingNode) {
    await waitForElementToBeRemoved(() => screen.getByText('Loading...'));
  }

  return utils!;
}

// Test component that uses useAuth
function TestAuthComponent() {
  const { user, ready, login, logout } = useAuth();

  if (!ready) return <div>Loading...</div>;

  return (
    <div>
      <div data-testid="user-state">
        {user ? `Logged in as ${user.email}` : 'Not logged in'}
      </div>
      <button
        onClick={() => login('test@example.com', 'password')}
        data-testid="login-btn"
      >
        Login
      </button>
      <button
        onClick={logout}
        data-testid="logout-btn"
      >
        Logout
      </button>
    </div>
  );
}

describe('Authentication System', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset localStorage
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: jest.fn(() => null),
        setItem: jest.fn(() => null),
        removeItem: jest.fn(() => null),
      },
      writable: true,
    });
  });

  describe('AuthProvider', () => {
    it('provides authentication context to child components', async () => {
      await renderWithAuth(<TestAuthComponent />);

      expect(screen.getByTestId('user-state')).toHaveTextContent('Not logged in');
      expect(screen.getByTestId('login-btn')).toBeInTheDocument();
      expect(screen.getByTestId('logout-btn')).toBeInTheDocument();
    });

    it('verifies session with backend on mount', async () => {
      const tokens = require('../lib/auth/tokens');
      (tokens.getToken as jest.Mock).mockReturnValue('existing-token');

      await renderWithAuth(<TestAuthComponent />);

      await waitFor(() => {
        expect(verifySession).toHaveBeenCalled();
      });
    });

    it('throws error when useAuth is used outside AuthProvider', () => {
      // Mock console.error to avoid error output in tests
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      expect(() => {
        render(<TestAuthComponent />);
      }).toThrow('useAuth must be used within an AuthProvider');

      consoleSpy.mockRestore();
    });

    it('calls login API when login is triggered', async () => {
      (authApi.login as jest.Mock).mockResolvedValue({
        token: 'test-token',
        refreshToken: 'test-refresh-token',
        user: { id: '1', email: 'test@example.com', displayName: 'Test User' }
      });

      await renderWithAuth(<TestAuthComponent />);

      fireEvent.click(screen.getByTestId('login-btn'));

      await waitFor(() => {
        expect(authApi.login).toHaveBeenCalledWith('test@example.com', 'password');
      });
    });
  });

  describe('AuthButton', () => {
    it('renders sign in and sign up buttons when not authenticated', async () => {
      await renderWithAuth(<AuthButtonWithModal />);

      expect(await screen.findByText('Sign in')).toBeInTheDocument();
      expect(screen.getByText('Sign up')).toBeInTheDocument();
    });

    it('opens auth modal when sign in is clicked', async () => {
      await renderWithAuth(<AuthButtonWithModal />);

      fireEvent.click(await screen.findByText('Sign in'));
      expect(await screen.findByText('Sign in to ChatForge')).toBeInTheDocument();
    });

    it('opens auth modal in register mode when sign up is clicked', async () => {
      await renderWithAuth(<AuthButtonWithModal />);

      fireEvent.click(await screen.findByText('Sign up'));
      await waitFor(() => {
        expect(screen.getByText('Create your account')).toBeInTheDocument();
      });
    });
  });

  describe('LoginForm', () => {
    it('renders email and password fields', () => {
      render(
        <AuthProvider>
          <LoginForm />
        </AuthProvider>
      );

      expect(screen.getByLabelText('Email')).toBeInTheDocument();
      expect(screen.getByLabelText('Password')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    });

    it('disables submit button when fields are empty', () => {
      render(
        <AuthProvider>
          <LoginForm />
        </AuthProvider>
      );

      const submitButton = screen.getByRole('button', { name: 'Sign in' });
      expect(submitButton).toBeDisabled();
    });

    it('enables submit button when both fields are filled', () => {
      render(
        <AuthProvider>
          <LoginForm />
        </AuthProvider>
      );

      fireEvent.change(screen.getByLabelText('Email'), {
        target: { value: 'test@example.com' }
      });
      fireEvent.change(screen.getByLabelText('Password'), {
        target: { value: 'password123' }
      });

      const submitButton = screen.getByRole('button', { name: 'Sign in' });
      expect(submitButton).not.toBeDisabled();
    });
  });

  describe('RegisterForm', () => {
    it('renders all required fields', () => {
      render(
        <AuthProvider>
          <RegisterForm />
        </AuthProvider>
      );

      expect(screen.getByLabelText('Display Name (optional)')).toBeInTheDocument();
      expect(screen.getByLabelText('Email')).toBeInTheDocument();
      expect(screen.getByLabelText('Password')).toBeInTheDocument();
      expect(screen.getByLabelText('Confirm Password')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Create account' })).toBeInTheDocument();
    });

    it('shows password mismatch error', async () => {
      await renderWithAuth(<RegisterForm />);

      fireEvent.change(screen.getByLabelText('Email'), {
        target: { value: 'test@example.com' }
      });
      fireEvent.change(screen.getByLabelText('Password'), {
        target: { value: 'password123' }
      });
      fireEvent.change(screen.getByLabelText('Confirm Password'), {
        target: { value: 'different' }
      });

      fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

      await waitFor(() => {
        expect(screen.getByText('Passwords do not match')).toBeInTheDocument();
      });
    });

    it('shows password length error', async () => {
      await renderWithAuth(<RegisterForm />);

      fireEvent.change(screen.getByLabelText('Email'), {
        target: { value: 'test@example.com' }
      });
      fireEvent.change(screen.getByLabelText('Password'), {
        target: { value: 'short' }
      });
      fireEvent.change(screen.getByLabelText('Confirm Password'), {
        target: { value: 'short' }
      });

      fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

      await waitFor(() => {
        expect(screen.getByText('Password must be at least 8 characters long')).toBeInTheDocument();
      });
    });
  });

  describe('AuthModal', () => {
    it('renders login form by default', () => {
      render(
        <AuthProvider>
          <AuthModal open={true} onClose={() => {}} />
        </AuthProvider>
      );

      expect(screen.getByText('Sign in to ChatForge')).toBeInTheDocument();
      expect(screen.getByLabelText('Email')).toBeInTheDocument();
      expect(screen.getByLabelText('Password')).toBeInTheDocument();
    });

    it('renders register form when initialMode is register', () => {
      render(
        <AuthProvider>
          <AuthModal open={true} onClose={() => {}} initialMode="register" />
        </AuthProvider>
      );

      expect(screen.getByText('Create your account')).toBeInTheDocument();
      expect(screen.getByLabelText('Display Name (optional)')).toBeInTheDocument();
    });

    it('switches between login and register modes', () => {
      render(
        <AuthProvider>
          <AuthModal open={true} onClose={() => {}} />
        </AuthProvider>
      );

      expect(screen.getByText('Sign in to ChatForge')).toBeInTheDocument();

      // Switch to register
      fireEvent.click(screen.getByText('Create account'));
      expect(screen.getByText('Create your account')).toBeInTheDocument();

      // Switch back to login
      fireEvent.click(screen.getByText('Sign in'));
      expect(screen.getByText('Sign in to ChatForge')).toBeInTheDocument();
    });

    it('does not render when open is false', () => {
      render(
        <AuthProvider>
          <AuthModal open={false} onClose={() => {}} />
        </AuthProvider>
      );

      expect(screen.queryByText('Sign in to ChatForge')).not.toBeInTheDocument();
    });
  });
});