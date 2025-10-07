/**
 * Type definitions for the chat state management system
 */

import type { ChatMessage, ConversationMeta, ToolSpec } from '../../lib/chat';
import type { Role } from '../../lib/chat/types';
import type { ImageAttachment, MessageContent } from '../../lib/chat/types';
import type { Group as TabGroup, Option as ModelOption } from '../../components/ui/TabbedSelect';
import type { QualityLevel } from '../../components/ui/QualitySlider';
import type { User } from '../../lib/auth/api';

export interface PendingState {
  abort?: AbortController;
  streaming: boolean;
  error?: string;
}

// Unified state structure
export interface ChatState {
  // Authentication State
  user: User | null;
  isAuthenticated: boolean;

  // UI State
  status: 'idle' | 'streaming' | 'loading' | 'error';
  input: string;
  images: ImageAttachment[];

  // Chat State
  messages: ChatMessage[];
  conversationId: string | null;
  currentConversationTitle: string | null;

  // Settings
  model: string;
  providerId: string | null;
  // Model listing fetched from backend providers
  modelOptions: ModelOption[];
  modelGroups: TabGroup[] | null;
  modelToProvider: Record<string, string>;
  modelCapabilities: Record<string, any>; // Store model capabilities (e.g., supported_parameters)
  isLoadingModels: boolean;
  useTools: boolean;
  shouldStream: boolean;
  reasoningEffort: string;
  verbosity: string;
  qualityLevel: QualityLevel;
  // System prompt for the current session (legacy support)
  systemPrompt: string;
  // Inline system prompt override (from prompt manager)
  inlineSystemPromptOverride: string;
  // Active system prompt ID from loaded conversation
  activeSystemPromptId: string | null;
  // Per-tool enablement (list of tool names). Empty array means no explicit selection.
  enabledTools: string[];

  // Conversations
  conversations: ConversationMeta[];
  nextCursor: string | null;
  historyEnabled: boolean;
  loadingConversations: boolean;
  sidebarCollapsed: boolean;
  rightSidebarCollapsed: boolean;

  // Message Editing
  editingMessageId: string | null;
  editingContent: string;

  // Error handling
  error: string | null;

  // Internal state
  abort?: AbortController;
}

// Action types
export type ChatAction =
  // Authentication Actions
  | { type: 'SET_USER'; payload: User | null }
  | { type: 'SET_AUTHENTICATED'; payload: boolean }

  // UI Actions
  | { type: 'SET_INPUT'; payload: string }
  | { type: 'SET_IMAGES'; payload: ImageAttachment[] }

  // Settings Actions
  | { type: 'SET_MODEL'; payload: string }
  | { type: 'SET_PROVIDER_ID'; payload: string | null }
  | { type: 'SET_USE_TOOLS'; payload: boolean }
  | { type: 'SET_SHOULD_STREAM'; payload: boolean }
  | { type: 'SET_REASONING_EFFORT'; payload: string }
  | { type: 'SET_VERBOSITY'; payload: string }
  | { type: 'SET_QUALITY_LEVEL'; payload: QualityLevel }
  | { type: 'SET_SYSTEM_PROMPT'; payload: string }
  | { type: 'SET_INLINE_SYSTEM_PROMPT_OVERRIDE'; payload: string }
  | { type: 'SET_ACTIVE_SYSTEM_PROMPT_ID'; payload: string | null }
  | { type: 'SET_ENABLED_TOOLS'; payload: string[] }
  | { type: 'SET_MODEL_LIST'; payload: { groups: TabGroup[] | null; options: ModelOption[]; modelToProvider: Record<string, string>; modelCapabilities: Record<string, any> } }
  | { type: 'SET_LOADING_MODELS'; payload: boolean }

  // Conversation Actions
  | { type: 'SET_CONVERSATION_ID'; payload: string | null }
  | { type: 'SET_CURRENT_CONVERSATION_TITLE'; payload: string | null }
  | { type: 'LOAD_CONVERSATIONS_START' }
  | { type: 'LOAD_CONVERSATIONS_SUCCESS'; payload: { conversations: ConversationMeta[]; nextCursor: string | null; replace?: boolean } }
  | { type: 'LOAD_CONVERSATIONS_ERROR' }
  | { type: 'SET_HISTORY_ENABLED'; payload: boolean }
  | { type: 'ADD_CONVERSATION'; payload: ConversationMeta }
  | { type: 'DELETE_CONVERSATION'; payload: string }
  | { type: 'NEW_CHAT' }

  // Streaming Actions
  | { type: 'START_STREAMING'; payload: { abort: AbortController; userMessage: ChatMessage; assistantMessage: ChatMessage } }
  | { type: 'REGENERATE_START'; payload: { abort: AbortController; baseMessages: ChatMessage[]; assistantMessage: ChatMessage } }
  | { type: 'STREAM_TOKEN'; payload: { messageId: string; token: string; fullContent?: string } }
  | { type: 'STREAM_TOOL_CALL'; payload: { messageId: string; toolCall: any } }
  | { type: 'STREAM_TOOL_OUTPUT'; payload: { toolMessage: ChatMessage } }
  | { type: 'STREAM_USAGE'; payload: { messageId: string; usage: any } }
  | { type: 'STREAM_COMPLETE'; payload: { responseId?: string } }
  | { type: 'STREAM_ERROR'; payload: string }
  | { type: 'STOP_STREAMING' }

  // Message mutation helpers
  | { type: 'APPEND_MESSAGE'; payload: ChatMessage }
  | { type: 'SYNC_MESSAGE_ID'; payload: { role: Role; tempId: string; persistedId: string } }

  // Message Actions
  | { type: 'CLEAR_MESSAGES' }
  | { type: 'SET_MESSAGES'; payload: ChatMessage[] }
  | { type: 'SYNC_ASSISTANT'; payload: ChatMessage }

  // Editing Actions
  | { type: 'START_EDIT'; payload: { messageId: string; content: string } }
  | { type: 'UPDATE_EDIT_CONTENT'; payload: string }
  | { type: 'CANCEL_EDIT' }
  | { type: 'SAVE_EDIT_SUCCESS'; payload: { messageId: string; content: MessageContent; baseMessages: ChatMessage[] } }

  // Error Actions
  | { type: 'CLEAR_ERROR' }

  // Sidebar Actions
  | { type: 'TOGGLE_SIDEBAR' }
  | { type: 'SET_SIDEBAR_COLLAPSED'; payload: boolean }
  | { type: 'TOGGLE_RIGHT_SIDEBAR' }
  | { type: 'SET_RIGHT_SIDEBAR_COLLAPSED'; payload: boolean };

export { ToolSpec };
