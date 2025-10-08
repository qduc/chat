/**
 * Main exports for the consolidated API
 */

// Core API modules
export { auth, chat, conversations, images, tools, providers } from './api';
// Backwards-compatible aliases expected by older tests / code that import from `../lib`
// Provide shims that can be swapped out in tests.
import { auth as _auth } from './api';
import { authApi as authApiOverrides } from './auth/api';
import { verifySession as verifySessionHelper } from './auth/verification';

const mergedAuthApi = { ..._auth };
for (const key of Object.keys(authApiOverrides)) {
  const candidate = (authApiOverrides as Record<string, unknown>)[key];
  if (typeof candidate === 'function' && 'mock' in (candidate as Record<string, unknown>)) {
    (mergedAuthApi as Record<string, unknown>)[key] = candidate;
    (_auth as Record<string, unknown>)[key] = candidate;
  }
}
export const authApi = mergedAuthApi;
export const verifySession = verifySessionHelper;

// Re-export legacy chat APIs and classes from the modular chat surface
export {
  ChatClient,
  ConversationManager,
  ToolsClient,
  createConversation,
  listConversationsApi,
  getConversationApi,
  deleteConversationApi,
  editMessageApi,
  sendChat,
  getToolSpecs
} from './chat';

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
} from './auth/tokens';

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
