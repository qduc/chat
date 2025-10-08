/**
 * Main exports for the consolidated API
 */

// Core API modules
export { auth, chat, conversations, images, tools, providers } from './api';
import { auth as _auth } from './api';

// Use the canonical `auth` implementation from ./api as the exported
// `authApi`. Historically tests could override a legacy shim at
// `./auth/api` to inject mocks; that shim is deprecated and removed to
// simplify the module surface. Consumers should mock the consolidated
// `../lib` exports or the `auth`/`authApi` object instead.
export const authApi = { ..._auth };

// Note: legacy chat shim removed. Use the consolidated API exports above:
// - `chat` (chat.sendMessage)
// - `conversations` (create/list/get/delete/editMessage)
// - `tools` (getToolSpecs)
// Tests and consumers should import those directly from '../lib' (they are
// re-exported from './api' at the top of this file).

// HTTP client
export { httpClient, HttpError, type HttpResponse, type RequestOptions } from './http';

// Storage utilities
export {
  getToken,
  setToken,
  removeToken,
  getRefreshToken,
  setRefreshToken,
  removeRefreshToken,
  clearTokens,
  isTokenExpired,
  getUserFromToken
} from './storage';

export {
  isAuthenticated,
  waitForAuthReady,
  markAuthReady,
  resetAuthReady,
  setAuthReady,
  isAuthReady
} from './storage';

// Streaming utilities
export { SSEParser, APIError, type SSEEvent } from './streaming';

// Content utilities
export {
  extractTextFromContent,
  stringToMessageContent,
  arrayToMessageContent,
  hasImages,
  extractImagesFromContent,
  createMixedContent,
  normalizeMessageContent
} from './contentUtils';

// Model capabilities
export { supportsReasoningControls } from './modelCapabilities';

// Utility function for API base resolution (backward compatibility)
export function resolveApiBase(): string {
  return typeof window !== 'undefined'
    ? `${window.location.origin}/api`
    : process.env.NEXT_PUBLIC_API_BASE || 'http://backend:3001/api';
}

// Types - re-export all types
export type {
  // HTTP Types
  HttpClientOptions,

  // Auth Types
  User,
  LoginResponse,
  RegisterResponse,
  VerifySessionReason,
  VerifySessionResult,

  // Chat Types
  Role,
  ImageContent,
  TextContent,
  MessageContent,
  ImageAttachment,
  ImageConfig,
  ImageValidationResult,
  ImageProcessingState,
  ImageUploadProgress,
  ChatMessage,
  ChatEvent,
  ChatResponse,
  ConversationMeta,
  ConversationsList,
  ConversationWithMessages,
  ToolSpec,
  ToolsResponse,
  ChatOptions,
  ChatOptionsExtended,
  SendChatOptions,

  // Conversation Management Types
  ConversationCreateOptions,
  ListConversationsParams,
  GetConversationParams,
  EditMessageResult,

  // Provider Types
  Provider
} from './types';
