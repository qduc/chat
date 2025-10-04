/**
 * UI state reducer
 * Handles input, images, sidebar state
 */

import type { ChatState, ChatAction } from '../types';

export function uiReducer(state: ChatState, action: ChatAction): ChatState | null {
  switch (action.type) {
    case 'SET_INPUT':
      return { ...state, input: action.payload };

    case 'SET_IMAGES':
      return { ...state, images: action.payload };

    case 'TOGGLE_SIDEBAR': {
      const newCollapsed = !state.sidebarCollapsed;
      // Save to localStorage
      try {
        if (typeof window !== 'undefined') {
          localStorage.setItem('sidebarCollapsed', String(newCollapsed));
        }
      } catch {
        // ignore storage errors
      }
      return { ...state, sidebarCollapsed: newCollapsed };
    }

    case 'SET_SIDEBAR_COLLAPSED':
      return { ...state, sidebarCollapsed: action.payload };

    case 'TOGGLE_RIGHT_SIDEBAR': {
      const newCollapsed = !state.rightSidebarCollapsed;
      // Save to localStorage
      try {
        if (typeof window !== 'undefined') {
          localStorage.setItem('rightSidebarCollapsed', String(newCollapsed));
        }
      } catch {
        // ignore storage errors
      }
      return { ...state, rightSidebarCollapsed: newCollapsed };
    }

    case 'SET_RIGHT_SIDEBAR_COLLAPSED':
      return { ...state, rightSidebarCollapsed: action.payload };

    case 'CLEAR_ERROR':
      return { ...state, error: null };

    default:
      return null; // Not handled by this reducer
  }
}
