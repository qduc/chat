/**
 * Consolidated type definitions for API, HTTP, and Chat
 */

// ============================================================================
// HTTP Types
// ============================================================================

export interface HttpClientOptions {
  baseUrl?: string;
  timeout?: number;
  retries?: number;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  body?: any;
  signal?: AbortSignal;
  credentials?: RequestCredentials;
  skipAuth?: boolean; // Skip adding auth headers
  skipRetry?: boolean; // Skip 401 retry logic
}

export interface HttpResponse<T = any> {
  data: T;
  status: number;
  statusText: string;
  headers: Headers;
}

// ============================================================================
// Auth Types
// ============================================================================

export interface User {
  id: string;
  email: string;
  displayName?: string;
  createdAt: string;
  updatedAt: string;
}

export interface LoginResponse {
  tokens: {
    accessToken: string;
    refreshToken: string;
  };
  user: User;
}

export interface RegisterResponse {
  tokens: {
    accessToken: string;
    refreshToken: string;
  };
  user: User;
}

export type VerifySessionReason = 'missing-token' | 'expired' | 'invalid' | 'network' | 'unknown';

export interface VerifySessionResult {
  valid: boolean;
  user: User | null;
  reason?: VerifySessionReason;
  error?: unknown;
}

// ============================================================================
// Chat Types
// ============================================================================

export type Role = 'user' | 'assistant' | 'system' | 'tool';

// Image-related types for Vision API support
export interface ImageContent {
  type: 'image_url';
  image_url: {
    url: string;
    detail?: 'auto' | 'low' | 'high';
  };
}

export interface TextContent {
  type: 'text';
  text: string;
}

// Audio input content for OpenRouter/OpenAI-style chat completions
// Note: OpenRouter docs sometimes show `inputAudio` (SDK shape) while the
// OpenAI-compatible HTTP API commonly uses `input_audio`. We accept either.
export interface InputAudioContent {
  type: 'input_audio';
  input_audio?: {
    data: string; // base64 (no data: prefix)
    format: string; // e.g. wav, mp3, m4a, flac
  };
  inputAudio?: {
    data: string;
    format: string;
  };
}

export interface PendingState {
  streaming: boolean;
  error?: string;
  abort: AbortController | null;
  tokenStats?: {
    count: number;
    charCount: number;
    startTime: number;
    messageId: string;
    lastUpdated: number;
    provider?: string;
    isEstimate: boolean;
  };
}

export interface EvaluationDraft {
  id: string;
  messageId: string;
  selectedModelIds: string[]; // All models being compared (including primary if selected)
  judgeModelId: string;
  criteria?: string | null;
  content: string;
  status: 'streaming' | 'error';
  error?: string;
}

// File content extracted from message text for UI rendering
export interface FileContent {
  type: 'file';
  name: string;
  language: string;
  content: string;
}

export type MessageContent = string | Array<TextContent | ImageContent | InputAudioContent>;

// Audio attachment for local handling (before conversion to content parts)
export interface AudioAttachment {
  id: string;
  file: File;
  url: string; // blob URL for preview
  name: string;
  size: number;
  type: string;
  format?: string; // e.g. wav, mp3
}

// Image attachment for local handling (before API conversion)
export interface ImageAttachment {
  id: string;
  file: File;
  url: string; // blob URL or data URL for preview
  name: string;
  size: number;
  type: string;
  alt?: string;
  downloadUrl?: string;
  accessToken?: string;
  expiresAt?: string;
  expiresIn?: number;
}

// Image configuration and constraints
export interface ImageConfig {
  // File constraints
  maxFileSize: number; // Default: 10MB
  maxDimensions: { width: number; height: number }; // Default: 4096x4096
  maxImagesPerMessage: number; // Default: 5
  allowedFormats: string[]; // Default: ['jpeg', 'jpg', 'png', 'webp', 'gif']

  // Storage settings
  storageProvider: 'local' | 's3'; // Default: 'local' for dev, 's3' for prod
  localStoragePath: string; // Default: './data/images'
  s3Bucket?: string;
  s3Region?: string;
  cdnBaseUrl?: string;

  // Processing options
  enableCompression: boolean; // Default: true
  compressionQuality: number; // Default: 0.8
  generateThumbnails: boolean; // Default: true

  // Security settings
  enableMalwareScanning: boolean; // Default: false for dev, true for prod
  enableContentModeration: boolean; // Default: false

  // Rate limiting
  uploadRateLimit: number; // Default: 10 per minute
  storageLimitPerUser: number; // Default: 100MB
}

// Image validation result
export interface ImageValidationResult {
  isValid: boolean;
  errors: string[];
  warnings?: string[];
}

// Image processing state
export type ImageProcessingState = 'pending' | 'uploading' | 'processing' | 'ready' | 'error';

export interface ImageUploadProgress {
  imageId: string;
  state: ImageProcessingState;
  progress: number; // 0-100
  error?: string;
}

// ============================================================================
// File Attachment Types (for text files like source code)
// ============================================================================

// File attachment for local handling (before API conversion)
export interface FileAttachment {
  id: string;
  file: File;
  name: string;
  size: number;
  type: string;
  content?: string; // Text content for display/LLM context
  downloadUrl?: string;
  accessToken?: string;
  expiresAt?: string;
  expiresIn?: number;
}

// File configuration and constraints
export interface FileConfig {
  maxFileSize: number; // Default: 5MB for text files
  maxFilesPerMessage: number; // Default: 3
  allowedExtensions: string[]; // Default: ['.js', '.ts', '.py', '.md', '.txt', '.json', etc.]
  allowedMimeTypes: string[]; // text/plain, application/json, etc.
  uploadRateLimit: number; // Default: 10 per minute
  storageLimitPerUser: number; // Default: 50MB
}

// File validation result
export interface FileValidationResult {
  isValid: boolean;
  errors: string[];
  warnings?: string[];
}

// File processing state (reuse ImageProcessingState)
export type FileProcessingState = ImageProcessingState;

export interface FileUploadProgress {
  fileId: string;
  state: FileProcessingState;
  progress: number; // 0-100
  error?: string;
}

export interface ChatMessage {
  id: string;
  role: Role;
  content: MessageContent;
  seq?: number; // Message sequence number from backend
  responseId?: string; // Response ID for assistant messages to maintain conversation context
  provider?: string; // Provider used for this message
  // Local image attachments (used during composition, converted to content format for API)
  images?: ImageAttachment[];
  tool_calls?: any[];
  message_events?: MessageEvent[];
  tool_call_id?: string;
  tool_outputs?: Array<{
    tool_call_id?: string;
    name?: string;
    output: any;
    status?: string;
  }>;
  usage?: {
    provider?: string;
    model?: string;
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    reasoning_tokens?: number;
  };
  reasoning_details?: any[];
  reasoning_tokens?: number | null;
  comparisonResults?: Record<
    string,
    {
      /**
       * The message id in the *comparison conversation* that corresponds to this primary assistant message.
       * Used by judge/evaluation calls which must reference the correct conversation-scoped message id.
       */
      messageId?: string;
      content: MessageContent;
      tool_calls?: any[];
      tool_outputs?: Array<{
        tool_call_id?: string;
        name?: string;
        output: any;
        status?: string;
      }>;
      message_events?: MessageEvent[];
      usage?: any;
      status: 'streaming' | 'complete' | 'error';
      error?: string;
    }
  >;
}

export interface Evaluation {
  id: string;
  user_id: string;
  conversation_id: string;
  model_a_conversation_id: string;
  model_a_message_id: string;
  model_b_conversation_id: string;
  model_b_message_id: string;
  judge_model_id: string;
  criteria?: string | null;
  score_a?: number | null;
  score_b?: number | null;
  winner?: string | null;
  reasoning?: string | null;
  created_at: string;
  models?: Array<{
    model_id?: string | null;
    conversation_id: string;
    message_id: string;
    score?: number | null;
  }>;
}

export interface MessageEvent {
  seq: number;
  type: 'content' | 'reasoning' | 'tool_call';
  payload: {
    text?: string;
    tool_call_id?: string | null;
    tool_call_index?: number | null;
  } | null;
}

export interface ChatEvent {
  type: 'text' | 'reasoning' | 'tool_call' | 'tool_output' | 'usage' | 'final' | 'generated_image';
  value: any;
}

export interface ChatResponse {
  content: string;
  responseId?: string;
  conversation?: ConversationMeta;
  reasoning_summary?: string;
  usage?: {
    provider?: string;
    model?: string;
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    reasoning_tokens?: number;
  };
  reasoning_details?: any[];
  reasoning_tokens?: number | null;
}

export interface Conversation {
  id: string;
  title: string;
  created_at: string;
  updatedAt: string;
}

export interface ModelOption {
  value: string;
  label: string;
}

export interface ModelGroup {
  id: string;
  label: string;
  options: ModelOption[];
}

export type Status = 'idle' | 'streaming';
export type ReasoningEffortLevel = 'unset' | 'minimal' | 'low' | 'medium' | 'high';
/** @deprecated Use ReasoningEffortLevel instead */
export type QualityLevel = ReasoningEffortLevel;

export interface CustomRequestParamPreset {
  id: string;
  label: string;
  params: Record<string, any>;
}

export interface ConversationMeta {
  id: string;
  title?: string | null;
  provider_id?: string | null;
  model?: string | null;
  created_at: string;
  streaming_enabled?: boolean;
  tools_enabled?: boolean;
  active_tools?: string[];
  custom_request_params_id?: string[] | null;
  research_mode?: boolean;
  reasoning_effort?: string | null;
  verbosity?: string | null;
  system_prompt?: string | null;
  seq?: number | null;
  user_message_id?: string | number | null;
  assistant_message_id?: string | number | null;
}

export interface ConversationsList {
  items: ConversationMeta[];
  next_cursor: string | null;
}

export interface ConversationWithMessages {
  id: string;
  title?: string;
  provider?: string;
  model?: string;
  created_at: string;
  streaming_enabled?: boolean;
  tools_enabled?: boolean;
  active_tools?: string[];
  custom_request_params_id?: string[] | null;
  research_mode?: boolean;
  reasoning_effort?: string | null;
  verbosity?: string | null;
  system_prompt?: string | null;
  active_system_prompt_id?: string | null;
  messages: {
    id: string | number;
    seq: number;
    role: Role;
    status: string;
    content: MessageContent | null;
    created_at: string;
    provider?: string;
    // Image references stored in database (after upload)
    images?: Array<{
      id: string;
      url: string;
      alt?: string;
    }>;
    tool_calls?: Array<{
      id: string;
      type: 'function';
      index: number;
      function: {
        name: string;
        arguments: string;
      };
      textOffset?: number;
    }>;
    message_events?: MessageEvent[];
    tool_outputs?: Array<{
      tool_call_id: string;
      output: unknown;
      status: string;
    }>;
    reasoning_details?: any[];
    reasoning_tokens?: number | null;
    usage?: {
      provider?: string;
      model?: string;
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
      reasoning_tokens?: number;
    };
  }[];
  next_after_seq: number | null;
  evaluations?: Evaluation[];
  // Linked comparison conversations (included when include_linked=messages)
  linked_conversations?: Array<{
    id: string;
    title?: string | null;
    provider_id?: string | null;
    model?: string | null;
    created_at: string;
    updated_at?: string;
    messages: ConversationWithMessages['messages'];
  }>;
}

export interface ToolSpec {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, any>;
      required: string[];
    };
  };
}

export interface ToolApiKeyStatus {
  hasApiKey: boolean;
  requiresApiKey: boolean;
  missingKeyLabel?: string;
}

export interface ToolsResponse {
  tools: ToolSpec[];
  available_tools: string[];
  tool_api_key_status?: Record<string, ToolApiKeyStatus>;
}

// Core chat options - simplified and focused
export interface ChatOptions {
  messages: Array<{
    id?: string;
    role: Role;
    content: MessageContent;
    seq?: number; // Message sequence number for existing messages
    tool_calls?: any[];
    tool_outputs?: Array<{
      tool_call_id?: string;
      output: any;
      status?: string;
    }>;
    tool_call_id?: string;
    status?: string;
  }>;
  model?: string;
  providerId: string;
  stream?: boolean;
  signal?: AbortSignal;
  requestId?: string;
  onToken?: (token: string) => void;
  onEvent?: (event: ChatEvent) => void;
  apiBase?: string;
  responseId?: string; // Previous response ID to maintain conversation context
}

// Extended options for advanced features
export interface ChatOptionsExtended extends ChatOptions {
  conversationId?: string;
  parentConversationId?: string;
  // Accept either full ToolSpec objects or simple tool name strings
  tools?: Array<ToolSpec | string>;
  toolChoice?: any;
  providerStream?: boolean;
  customRequestParamsId?: string[] | null;
  reasoning?: {
    effort?: string;
    verbosity?: string;
    summary?: string;
  };
  // Persistence settings
  streamingEnabled?: boolean;
  toolsEnabled?: boolean;
  systemPrompt?: string;
  activeSystemPromptId?: string | null;
  modelCapabilities?: any;
}

// Legacy interface for backward compatibility
export interface SendChatOptions extends ChatOptionsExtended {
  // Legacy aliases
  shouldStream?: boolean;
  research_mode?: boolean;
  reasoningEffort?: string;
  verbosity?: string;
  tool_choice?: any;
  activeSystemPromptId?: string | null;
}

// ============================================================================
// Conversation Management Types
// ============================================================================

export interface ConversationCreateOptions {
  title?: string;
  provider_id?: string;
  model?: string;
  streamingEnabled?: boolean;
  toolsEnabled?: boolean;
  reasoningEffort?: string;
  verbosity?: string;
  custom_request_params_id?: string[] | null;
}

export interface ListConversationsParams {
  cursor?: string;
  limit?: number;
}

export interface GetConversationParams {
  after_seq?: number;
  limit?: number;
  include_linked?: 'messages';
}

export interface EditMessageResult {
  message: {
    id: string;
    seq: number;
    content: string;
  };
  new_conversation_id: string;
}

// ============================================================================
// Provider Types
// ============================================================================

export interface Provider {
  id: string;
  name: string;
  provider_type: string;
  enabled: number;
  updated_at: string;
}
