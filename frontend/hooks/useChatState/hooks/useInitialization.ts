import { useEffect } from 'react';
import type { ChatAction } from '../types';

export interface UseInitializationProps {
  dispatch: React.Dispatch<ChatAction>;
  authReady: boolean;
  user: any;
}

/**
 * Hook for initializing state from localStorage and auth context
 *
 * Handles loading sidebar state, selected model, and syncing auth state.
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
