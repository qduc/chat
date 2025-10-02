export type Role = 'user' | 'assistant' | 'system';

export interface ChatMessage {
  id: string;
  role: Role;
  content: string;
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
  };
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
  };
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
    content: string;
    created_at: string;
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
  messages: { role: Role; content: string }[];
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
