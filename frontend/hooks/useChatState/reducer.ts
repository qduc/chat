/**
 * Chat state reducer
 *
 * This is now a thin wrapper around the combined reducer system.
 * The actual reducer logic is split into domain-specific sub-reducers
 * in the ./reducers/ directory.
 */

import type { ChatState, ChatAction } from './types';
import { combinedReducer } from './reducers';

/**
 * Main chat reducer
 * Delegates to domain-specific sub-reducers for better organization
 */
export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  return combinedReducer(state, action);
}
