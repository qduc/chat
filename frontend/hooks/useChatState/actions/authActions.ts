import type { User } from '../../../lib/auth/api';
import type { ChatAction } from '../types';

export interface AuthActionsProps {
  dispatch: React.Dispatch<ChatAction>;
}

export function createAuthActions({ dispatch }: AuthActionsProps) {
  return {
    setUser: (user: User | null) => {
      dispatch({ type: 'SET_USER', payload: user });
    },

    setAuthenticated: (authenticated: boolean) => {
      dispatch({ type: 'SET_AUTHENTICATED', payload: authenticated });
    },
  };
}
