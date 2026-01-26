/**
 * Consolidated API client for all backend operations
 * Auth, Chat, Conversations, Images, Tools, Providers
 *
 * This file re-exports from the modularized API directory for backward compatibility.
 * New imports should use the individual modules directly from './api/'.
 */

// Re-export all APIs from the modular directory
export * from './api/index';

// Re-export resolveApiBase for external usage (backward compatibility)
export { resolveApiBase } from './urlUtils';
