'use client';

import React from 'react';
import { Loader2 } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';

interface ProtectedRouteProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  requireAuth?: boolean;
}

/**
 * Component that conditionally renders children based on authentication status
 * By default, it allows both authenticated and anonymous users
 * Set requireAuth=true to require authentication
 */
export function ProtectedRoute({
  children,
  fallback = null,
  requireAuth = false,
}: ProtectedRouteProps) {
  const { user, ready } = useAuth();

  // Show loading state while checking authentication
  if (!ready) {
    return (
      <div role="status" className="flex h-64 items-center justify-center text-fg-muted">
        <Loader2 aria-hidden="true" className="size-6 animate-spin" />
        <span className="sr-only">Loading</span>
      </div>
    );
  }

  // If auth is required but user is not authenticated, show fallback
  if (requireAuth && !user) {
    return <>{fallback}</>;
  }

  // Otherwise, show children (works for both authenticated and anonymous users)
  return <>{children}</>;
}
