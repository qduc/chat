// Compatibility layer exporting legacy chat symbols expected by older code/tests

import type {
  ChatOptions,
  ChatOptionsExtended,
  ChatResponse,
  ConversationMeta,
  ConversationsList,
  ConversationWithMessages,
  ConversationCreateOptions,
  ListConversationsParams,
  GetConversationParams,
  EditMessageResult,
  SendChatOptions,
  ToolsResponse
} from './types';
import { chat, conversations, tools } from './api';

// Minimal ChatClient wrapper delegating to new `chat` API
export class ChatClient {
  constructor(private apiBase?: string) {}

  async sendMessage(options: ChatOptions): Promise<ChatResponse> {
    // Delegate to api.chat
    return chat.sendMessage({ ...options, apiBase: this.apiBase });
  }

  async sendMessageWithTools(options: ChatOptionsExtended): Promise<ChatResponse> {
    return chat.sendMessage({ ...options, apiBase: this.apiBase });
  }
}

// Minimal ConversationManager wrapper delegating to `conversations` API
export class ConversationManager {
  constructor(private apiBase?: string) {}

  async create(options: ConversationCreateOptions = {}): Promise<ConversationMeta> {
    return conversations.create(options);
  }

  async list(params: ListConversationsParams = {}): Promise<ConversationsList> {
    return conversations.list(params);
  }

  async get(id: string, params: GetConversationParams = {}): Promise<ConversationWithMessages> {
    return conversations.get(id, params);
  }

  async delete(id: string): Promise<void> {
    return conversations.delete(id);
  }

  async editMessage(conversationId: string, messageId: string, content: any): Promise<EditMessageResult> {
    return conversations.editMessage(conversationId, messageId, content);
  }
}

// Legacy convenience functions
export async function sendChat(options: SendChatOptions): Promise<ChatResponse> {
  // Reuse chat.sendMessage; SendChatOptions should be compatible enough for tests
  return chat.sendMessage(options as any);
}

export async function listConversationsApi(params: ListConversationsParams = {}) {
  return conversations.list(params);
}

export async function getConversationApi(id: string, params: GetConversationParams = {}) {
  return conversations.get(id, params);
}

export async function createConversation(options: ConversationCreateOptions = {}) {
  return conversations.create(options);
}

export async function deleteConversationApi(id: string) {
  return conversations.delete(id);
}

export async function editMessageApi(conversationId: string, messageId: string, content: any) {
  return conversations.editMessage(conversationId, messageId, content);
}

export async function getToolSpecs(): Promise<ToolsResponse> {
  return tools.getToolSpecs();
}

// Export ToolsClient if needed by consumers (very small shim)
export class ToolsClient {
  constructor(private apiBase?: string) {}
  async getToolSpecs() {
    return getToolSpecs();
  }
}
