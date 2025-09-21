import {
  ConversationMeta,
  ConversationsList,
  ConversationWithMessages
} from './types';
import { handleResponse } from './utils';

const defaultApiBase = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:3001';

export interface ConversationCreateOptions {
  title?: string;
  provider_id?: string;
  model?: string;
  streamingEnabled?: boolean;
  toolsEnabled?: boolean;
  qualityLevel?: string;
  reasoningEffort?: string;
  verbosity?: string;
}

export interface ListConversationsParams {
  cursor?: string;
  limit?: number;
}

export interface GetConversationParams {
  after_seq?: number;
  limit?: number;
}

export interface EditMessageResult {
  message: {
    id: string;
    seq: number;
    content: string;
  };
  new_conversation_id: string;
}

export class ConversationManager {
  constructor(private apiBase: string = defaultApiBase) {}

  async create(options: ConversationCreateOptions = {}): Promise<ConversationMeta> {
    const response = await fetch(`${this.apiBase}/v1/conversations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options),
      credentials: 'include'
    });

    return handleResponse<ConversationMeta>(response);
  }

  async list(params: ListConversationsParams = {}): Promise<ConversationsList> {
    const searchParams = new URLSearchParams();
    if (params.cursor) searchParams.set('cursor', params.cursor);
    if (params.limit) searchParams.set('limit', String(params.limit));

    const response = await fetch(
      `${this.apiBase}/v1/conversations?${searchParams.toString()}`,
      {
        method: 'GET',
        credentials: 'include'
      }
    );

    return handleResponse<ConversationsList>(response);
  }

  async get(id: string, params: GetConversationParams = {}): Promise<ConversationWithMessages> {
    const searchParams = new URLSearchParams();
    if (params.after_seq) searchParams.set('after_seq', String(params.after_seq));
    if (params.limit) searchParams.set('limit', String(params.limit));

    const response = await fetch(
      `${this.apiBase}/v1/conversations/${id}?${searchParams.toString()}`,
      {
        method: 'GET',
        credentials: 'include'
      }
    );

    return handleResponse<ConversationWithMessages>(response);
  }

  async delete(id: string): Promise<void> {
    const response = await fetch(`${this.apiBase}/v1/conversations/${id}`, {
      method: 'DELETE',
      credentials: 'include'
    });

    if (response.status === 204) return;
    await handleResponse(response);
  }

  async editMessage(
    conversationId: string,
    messageId: string,
    content: string
  ): Promise<EditMessageResult> {
    const response = await fetch(
      `${this.apiBase}/v1/conversations/${conversationId}/messages/${messageId}/edit`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
        credentials: 'include'
      }
    );

    return handleResponse<EditMessageResult>(response);
  }

  // Backward-compatible instance method aliases
  async createConversation(options: ConversationCreateOptions = {}): Promise<ConversationMeta> {
    return this.create(options);
  }

  async listConversations(params: ListConversationsParams = {}): Promise<ConversationsList> {
    return this.list(params);
  }

  async getConversation(id: string, params: GetConversationParams = {}): Promise<ConversationWithMessages> {
    return this.get(id, params);
  }

  async deleteConversation(id: string): Promise<void> {
    return this.delete(id);
  }
}

// Convenience functions for backward compatibility
export async function createConversation(
  apiBase = defaultApiBase,
  init: ConversationCreateOptions = {}
): Promise<ConversationMeta> {
  const manager = new ConversationManager(apiBase);
  return manager.create(init);
}

export async function listConversationsApi(
  apiBase = defaultApiBase,
  params: ListConversationsParams = {}
): Promise<ConversationsList> {
  const manager = new ConversationManager(apiBase);
  return manager.list(params);
}

export async function getConversationApi(
  apiBase = defaultApiBase,
  id: string,
  params: GetConversationParams = {}
): Promise<ConversationWithMessages> {
  const manager = new ConversationManager(apiBase);
  return manager.get(id, params);
}

export async function deleteConversationApi(
  apiBase = defaultApiBase,
  id: string
): Promise<boolean> {
  const manager = new ConversationManager(apiBase);
  await manager.delete(id);
  return true;
}

export async function editMessageApi(
  apiBase = defaultApiBase,
  conversationId: string,
  messageId: string,
  content: string
): Promise<EditMessageResult> {
  const manager = new ConversationManager(apiBase);
  return manager.editMessage(conversationId, messageId, content);
}
