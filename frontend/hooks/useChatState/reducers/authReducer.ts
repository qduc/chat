/**
 * Authentication-related reducer
 * Handles user authentication state
 */

import type { ChatState, ChatAction } from '../types';

export function authReducer(state: ChatState, action: ChatAction): ChatState | null {
  switch (action.type) {
    case 'SET_USER':
      return {
        ...state,
        user: action.payload,
        isAuthenticated: action.payload !== null
      };

    case 'SET_AUTHENTICATED':
      return { ...state, isAuthenticated: action.payload };

    default:
      return null; // Not handled by this reducer
  }
}
