/**
 * Initial state and constants for the chat state management system
 */

import type { ChatState } from './types';
import type { ToolSpec } from '../../lib/chat';

export const initialState: ChatState = {
  // Authentication State
  user: null,
  isAuthenticated: false,

  status: 'idle',
  input: '',
  images: [],
  messages: [],
  conversationId: null,
  currentConversationTitle: null,
  previousResponseId: null,
  model: 'gpt-4.1-mini',
  providerId: null,
  modelOptions: [],
  modelGroups: null,
  modelToProvider: {},
  modelCapabilities: {},
  isLoadingModels: false,
  useTools: true,
  shouldStream: true,
  reasoningEffort: 'medium',
  verbosity: 'medium',
  qualityLevel: 'balanced',
  systemPrompt: '',
  inlineSystemPromptOverride: '',
  activeSystemPromptId: null,
  enabledTools: [],
  conversations: [],
  nextCursor: null,
  historyEnabled: true,
  loadingConversations: false,
  sidebarCollapsed: false,
  rightSidebarCollapsed: false,
  editingMessageId: null,
  editingContent: '',
  error: null,
};

// Available tools used for quick lookups by name
export const availableTools: Record<string, ToolSpec> = {
  get_time: {
    type: 'function',
    function: {
      name: 'get_time',
      description: 'Get the current local time of the server',
      parameters: { type: 'object', properties: {}, required: [] },
    }
  },
  web_search: {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Perform a web search for a given query',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The search query' }
        },
        required: ['query']
      }
    }
  }
};
