/**
 * Chat state management hook - refactored structure
 *
 * Phase 1 complete:
 * - Types extracted to types.ts
 * - Initial state extracted to initialState.ts
 * - Reducer extracted to reducer.ts
 * - Utilities extracted to utils/
 *
 * Future phases will extract:
 * - Actions into separate files by domain
 * - Custom hooks for complex logic
 */

// Re-export types for external consumers
export type { ChatState, ChatAction, PendingState, ToolSpec } from './types';

// Re-export the main hook (still in original file during migration)
export { useChatState } from '../useChatState';
