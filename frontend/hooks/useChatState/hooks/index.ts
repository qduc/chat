/**
 * Custom hooks module
 *
 * Aggregates all extracted custom hooks for the chat state management system.
 * Each hook handles a specific domain of functionality:
 *
 * - **useRefSync**: State-to-ref synchronization for immediate access
 * - **useModelLoader**: Provider and model data fetching and management
 * - **useConversationLoader**: Conversation list management and pagination
 * - **useStreamHandlers**: Streaming event processing and throttling
 * - **useChatHelpers**: Chat configuration building and send operations
 * - **useInitialization**: App state initialization from localStorage and auth
 *
 * These hooks are composed in the main useChatState hook to provide
 * a clean separation of concerns and improved testability.
 *
 * @module hooks
 */

export { useRefSync } from './useRefSync';
export { useModelLoader } from './useModelLoader';
export { useConversationLoader } from './useConversationLoader';
export { useStreamHandlers } from './useStreamHandlers';
export { useChatHelpers } from './useChatHelpers';
export { useInitialization } from './useInitialization';

export type { UseModelLoaderProps } from './useModelLoader';
export type { UseConversationLoaderProps } from './useConversationLoader';
export type { UseStreamHandlersProps } from './useStreamHandlers';
export type { UseChatHelpersProps } from './useChatHelpers';
export type { UseInitializationProps } from './useInitialization';
