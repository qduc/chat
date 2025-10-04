/**
 * Initialization hook
 *
 * Handles application state initialization from localStorage and authentication context.
 * Syncs sidebar state, model selection, and user authentication on app startup.
 *
 * @module useInitialization
 */

import { useEffect } from 'react';
import type { ChatAction } from '../types';

/**
 * Props for the useInitialization hook
 */
export interface UseInitializationProps {
  /** Dispatch function for chat state updates */
  dispatch: React.Dispatch<ChatAction>;
  /** Whether authentication is ready */
  authReady: boolean;
  /** Current authenticated user */
  user: any;
}

/**
 * Hook for initializing state from localStorage and auth context
 *
 * Handles loading sidebar state, selected model, and syncing auth state.
 *
 * @param props - Configuration object
 *
 * @example
 * ```typescript
 * useInitialization({
 *   dispatch,
 *   authReady,
 *   user
 * });
 * ```
 */
export function useInitialization({ dispatch, authReady, user }: UseInitializationProps) {
  // Sync authentication state from AuthContext
  useEffect(() => {
    if (authReady) {
      dispatch({ type: 'SET_USER', payload: user });
    }
  }, [user, authReady, dispatch]);

  // Load sidebar collapsed state from localStorage on mount
  useEffect(() => {
    try {
      if (typeof window !== 'undefined') {
        const collapsed = localStorage.getItem('sidebarCollapsed') === 'true';
        dispatch({ type: 'SET_SIDEBAR_COLLAPSED', payload: collapsed });
        const rightCollapsed = localStorage.getItem('rightSidebarCollapsed') === 'true';
        dispatch({ type: 'SET_RIGHT_SIDEBAR_COLLAPSED', payload: rightCollapsed });
        // Load saved model from localStorage
        const savedModel = localStorage.getItem('selectedModel');
        if (savedModel) {
          dispatch({ type: 'SET_MODEL', payload: savedModel });
        }
      }
    } catch {
      // ignore storage errors
    }
  }, [dispatch]);
}
