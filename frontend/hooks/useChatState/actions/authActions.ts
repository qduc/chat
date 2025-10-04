/**
 * Authentication action creators
 *
 * Handles user authentication state management including user data and authentication status.
 * These actions are typically triggered by the AuthContext when authentication state changes.
 *
 * @module authActions
 */

import type { User } from '../../../lib/auth/api';
import type { ChatAction } from '../types';

/**
 * Props for creating authentication actions
 */
export interface AuthActionsProps {
  /** Dispatch function for chat state updates */
  dispatch: React.Dispatch<ChatAction>;
}

/**
 * Creates authentication action creators
 *
 * @param props - Configuration object
 * @param props.dispatch - React dispatch function for state updates
 * @returns Object containing authentication action functions
 *
 * @example
 * ```typescript
 * const authActions = createAuthActions({ dispatch });
 * authActions.setUser(user);
 * authActions.setAuthenticated(true);
 * ```
 */
export function createAuthActions({ dispatch }: AuthActionsProps) {
  return {
    /**
     * Updates the current user in state
     *
     * @param user - User object or null if logged out
     */
    setUser: (user: User | null) => {
      dispatch({ type: 'SET_USER', payload: user });
    },

    /**
     * Updates the authentication status
     *
     * @param authenticated - Whether the user is authenticated
     */
    setAuthenticated: (authenticated: boolean) => {
      dispatch({ type: 'SET_AUTHENTICATED', payload: authenticated });
    },
  };
}
