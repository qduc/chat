// Main chat API - provides both new modular API and legacy compatibility

// Re-export all types for easy access
export type {
  Role,
  ChatMessage,
  ChatEvent,
  ChatResponse,
  ChatOptions,
  ChatOptionsExtended,
  SendChatOptions,
  ConversationMeta,
  ConversationsList,
  ConversationWithMessages,
  ToolSpec,
  ToolsResponse
} from './chat/types';

// Re-export new modular APIs
export { ChatClient } from './chat/client';
export {
  ConversationManager,
  type ConversationCreateOptions,
  type ListConversationsParams,
  type GetConversationParams,
  type EditMessageResult
} from './chat/conversations';
export { ToolsClient } from './chat/tools';
export { APIError, SSEParser } from './chat/utils';

// Legacy function exports for backward compatibility
// @deprecated Use ConversationManager class instead
export {
  createConversation,
  listConversationsApi,
  getConversationApi,
  deleteConversationApi,
  editMessageApi
} from './chat/conversations';
// @deprecated Use ToolsClient class instead
export { getToolSpecs } from './chat/tools';

import { ChatClient } from './chat/client';
import { SendChatOptions, ChatResponse } from './chat/types';

const defaultApiBase = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:3001';

// Legacy sendChat function for backward compatibility
// @deprecated Use ChatClient.sendMessage() or ChatClient.sendMessageWithTools() instead
export async function sendChat(options: SendChatOptions): Promise<ChatResponse> {
  const client = new ChatClient(options.apiBase || defaultApiBase);

  // Convert legacy options to new format
  const convertedOptions = {
    ...options,
    stream: options.shouldStream !== undefined ? !!options.shouldStream :
            (options.stream === undefined ? true : !!options.stream),
    reasoning: (options.reasoningEffort || options.verbosity) ? {
      effort: options.reasoningEffort,
      verbosity: options.verbosity
    } : undefined,
    toolChoice: options.tool_choice
  };

  if (convertedOptions.tools && convertedOptions.tools.length > 0) {
    return client.sendMessageWithTools(convertedOptions);
  } else {
    return client.sendMessage(convertedOptions);
  }
}
