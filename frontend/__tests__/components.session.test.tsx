/**
 * @jest-environment jsdom
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ProtectedRoute } from '../components/auth/ProtectedRoute';

const useAuthMock = jest.fn();

jest.mock('../contexts/AuthContext', () => ({
  useAuth: () => useAuthMock(),
}));

describe('ProtectedRoute (requireAuth)', () => {
  beforeEach(() => {
    useAuthMock.mockReset();
  });

  it('renders a loading indicator while auth state resolves', () => {
    useAuthMock.mockReturnValue({ user: null, loading: true });

    const { container } = render(
      <ProtectedRoute requireAuth fallback={<div data-testid="fallback" />}>
        <div data-testid="protected" />
      </ProtectedRoute>
    );

    expect(container.querySelector('.animate-spin')).toBeTruthy();
    expect(screen.queryByTestId('protected')).not.toBeInTheDocument();
    expect(screen.queryByTestId('fallback')).not.toBeInTheDocument();
  });

  it('shows fallback when authentication is required and user is missing', () => {
    useAuthMock.mockReturnValue({ user: null, loading: false });

    render(
      <ProtectedRoute requireAuth fallback={<div data-testid="fallback">Login required</div>}>
        <div data-testid="protected" />
      </ProtectedRoute>
    );

    expect(screen.getByTestId('fallback')).toHaveTextContent('Login required');
    expect(screen.queryByTestId('protected')).not.toBeInTheDocument();
  });

  it('renders children when user is authenticated', () => {
    useAuthMock.mockReturnValue({ user: { id: '1' }, loading: false });

    render(
      <ProtectedRoute requireAuth fallback={<div data-testid="fallback" />}>
        <div data-testid="protected">Secret</div>
      </ProtectedRoute>
    );

    expect(screen.getByTestId('protected')).toHaveTextContent('Secret');
    expect(screen.queryByTestId('fallback')).not.toBeInTheDocument();
  });
});
