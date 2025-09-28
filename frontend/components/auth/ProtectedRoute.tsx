'use client';

import React from 'react';
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
  requireAuth = false
}: ProtectedRouteProps) {
  const { user, ready } = useAuth();

  // Show loading state while checking authentication
  if (!ready) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
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