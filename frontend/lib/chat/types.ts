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

export type MessageContent = string | Array<TextContent | ImageContent>;

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
  maxFileSize: number;           // Default: 10MB
  maxDimensions: {width: number, height: number}; // Default: 4096x4096
  maxImagesPerMessage: number;   // Default: 5
  allowedFormats: string[];      // Default: ['jpeg', 'jpg', 'png', 'webp', 'gif']

  // Storage settings
  storageProvider: 'local' | 's3'; // Default: 'local' for dev, 's3' for prod
  localStoragePath: string;      // Default: './data/images'
  s3Bucket?: string;
  s3Region?: string;
  cdnBaseUrl?: string;

  // Processing options
  enableCompression: boolean;    // Default: true
  compressionQuality: number;    // Default: 0.8
  generateThumbnails: boolean;   // Default: true

  // Security settings
  enableMalwareScanning: boolean; // Default: false for dev, true for prod
  enableContentModeration: boolean; // Default: false

  // Rate limiting
  uploadRateLimit: number;       // Default: 10 per minute
  storageLimitPerUser: number;   // Default: 100MB
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

export interface ChatMessage {
  id: string;
  role: Role;
  content: MessageContent;
  seq?: number; // Message sequence number from backend
  // Local image attachments (used during composition, converted to content format for API)
  images?: ImageAttachment[];
  tool_calls?: any[];
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
}

export interface ChatEvent {
  type: 'text' | 'reasoning' | 'tool_call' | 'tool_output' | 'usage' | 'final';
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

export interface ConversationMeta {
  id: string;
  title?: string | null;
  provider_id?: string | null;
  model?: string | null;
  created_at: string;
  streaming_enabled?: boolean;
  tools_enabled?: boolean;
  active_tools?: string[];
  research_mode?: boolean;
  quality_level?: string | null;
  reasoning_effort?: string | null;
  verbosity?: string | null;
  system_prompt?: string | null;
  seq?: number | null;
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
  research_mode?: boolean;
  quality_level?: string | null;
  reasoning_effort?: string | null;
  verbosity?: string | null;
  system_prompt?: string | null;
  active_system_prompt_id?: string | null;
  messages: {
    id: number;
    seq: number;
    role: Role;
    status: string;
    content: MessageContent;
    created_at: string;
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
    tool_outputs?: Array<{
      tool_call_id: string;
      output: string;
      status: string;
    }>;
    reasoning_details?: any[];
    reasoning_tokens?: number | null;
  }[];
  next_after_seq: number | null;
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

export interface ToolsResponse {
  tools: ToolSpec[];
  available_tools: string[];
}

// Core chat options - simplified and focused
export interface ChatOptions {
  messages: Array<{
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
  onToken?: (token: string) => void;
  onEvent?: (event: ChatEvent) => void;
  apiBase?: string;
  responseId?: string; // Previous response ID to maintain conversation context
}

// Extended options for advanced features
export interface ChatOptionsExtended extends ChatOptions {
  conversationId?: string;
  // Accept either full ToolSpec objects or simple tool name strings
  tools?: Array<ToolSpec | string>;
  toolChoice?: any;
  reasoning?: {
    effort?: string;
    verbosity?: string;
    summary?: string;
  };
  // Persistence settings
  streamingEnabled?: boolean;
  toolsEnabled?: boolean;
  qualityLevel?: string;
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
