/**
 * Main exports for the consolidated API
 */

// Core API modules
export { auth, chat, conversations, images, tools, providers } from './api';

// Backward compatibility exports for tests
export const authApi = auth;
export const verifySession = auth.verifySession;

// Legacy function exports (deprecated but kept for backward compatibility)
export const listConversationsApi = conversations.list;
export const createConversation = conversations.create;
export const getConversationApi = conversations.get;
export const deleteConversationApi = conversations.delete;
export const editMessageApi = conversations.editMessage;
export const getToolSpecs = tools.getToolSpecs;

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
  getUserFromToken,
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
