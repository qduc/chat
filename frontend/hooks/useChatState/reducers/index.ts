/**
 * Combined reducer index
 * Orchestrates all domain-specific sub-reducers
 */

import type { ChatState, ChatAction } from '../types';
import { authReducer } from './authReducer';
import { uiReducer } from './uiReducer';
import { settingsReducer } from './settingsReducer';
import { conversationReducer } from './conversationReducer';
import { streamReducer } from './streamReducer';
import { editReducer } from './editReducer';

/**
 * Main reducer that delegates to domain-specific sub-reducers
 * Each sub-reducer returns null if it doesn't handle the action
 */
export function combinedReducer(state: ChatState, action: ChatAction): ChatState {
  // Try each sub-reducer in sequence
  // The first one to return a non-null value wins
  let result: ChatState | null;

  result = authReducer(state, action);
  if (result !== null) return result;

  result = uiReducer(state, action);
  if (result !== null) return result;

  result = settingsReducer(state, action);
  if (result !== null) return result;

  result = conversationReducer(state, action);
  if (result !== null) return result;

  result = streamReducer(state, action);
  if (result !== null) return result;

  result = editReducer(state, action);
  if (result !== null) return result;

  // If no reducer handled the action, return state unchanged
  return state;
}

// Re-export for convenience
export { authReducer } from './authReducer';
export { uiReducer } from './uiReducer';
export { settingsReducer } from './settingsReducer';
export { conversationReducer } from './conversationReducer';
export { streamReducer } from './streamReducer';
export { editReducer } from './editReducer';
