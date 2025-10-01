import {
  ConversationMeta,
  ConversationsList,
  ConversationWithMessages
} from './types';
import { waitForAuthReady } from '../auth/ready';
import { httpClient } from '../http/client';
import { HttpError } from '../http/types';
import { Cache } from './cache';

const defaultApiBase = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:3001';

// Cache TTL: 5 minutes
const CACHE_TTL_MS = 5 * 60 * 1000;

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
  private listCache = new Cache<ConversationsList>(CACHE_TTL_MS);
  private conversationCache = new Cache<ConversationWithMessages>(CACHE_TTL_MS);

  constructor(private apiBase: string = defaultApiBase) {}

  async create(options: ConversationCreateOptions = {}): Promise<ConversationMeta> {
    await waitForAuthReady();
    try {
      const response = await httpClient.post<ConversationMeta>(
        `${this.apiBase}/v1/conversations`,
        options
      );
      // Clear list cache on create
      this.listCache.clear();
      return response.data;
    } catch (error) {
      if (error instanceof HttpError) {
        throw new Error(error.message);
      }
      throw error;
    }
  }

  async list(params: ListConversationsParams = {}): Promise<ConversationsList> {
    await waitForAuthReady();
    const searchParams = new URLSearchParams();
    if (params.cursor) searchParams.set('cursor', params.cursor);
    if (params.limit) searchParams.set('limit', String(params.limit));

    const cacheKey = `list:${searchParams.toString()}`;
    const cached = this.listCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const url = `${this.apiBase}/v1/conversations${searchParams.toString() ? `?${searchParams.toString()}` : ''}`;
      const response = await httpClient.get<ConversationsList>(url);
      this.listCache.set(cacheKey, response.data);
      return response.data;
    } catch (error) {
      if (error instanceof HttpError) {
        throw new Error(error.message);
      }
      throw error;
    }
  }

  async get(id: string, params: GetConversationParams = {}): Promise<ConversationWithMessages> {
    await waitForAuthReady();
    const searchParams = new URLSearchParams();
    if (params.after_seq) searchParams.set('after_seq', String(params.after_seq));
    if (params.limit) searchParams.set('limit', String(params.limit));

    const cacheKey = `get:${id}:${searchParams.toString()}`;
    const cached = this.conversationCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const url = `${this.apiBase}/v1/conversations/${id}${searchParams.toString() ? `?${searchParams.toString()}` : ''}`;
      const response = await httpClient.get<ConversationWithMessages>(url);
      this.conversationCache.set(cacheKey, response.data);
      return response.data;
    } catch (error) {
      if (error instanceof HttpError) {
        throw new Error(error.message);
      }
      throw error;
    }
  }

  async delete(id: string): Promise<void> {
    await waitForAuthReady();
    try {
      await httpClient.delete(`${this.apiBase}/v1/conversations/${id}`);
      // Clear caches on delete
      this.listCache.clear();
      this.conversationCache.delete(`get:${id}:`);
    } catch (error) {
      if (error instanceof HttpError) {
        throw new Error(error.message);
      }
      throw error;
    }
  }

  async editMessage(
    conversationId: string,
    messageId: string,
    content: string
  ): Promise<EditMessageResult> {
    await waitForAuthReady();
    try {
      const response = await httpClient.put<EditMessageResult>(
        `${this.apiBase}/v1/conversations/${conversationId}/messages/${messageId}/edit`,
        { content }
      );
      // Clear conversation cache on edit (creates new conversation)
      this.conversationCache.clear();
      this.listCache.clear();
      return response.data;
    } catch (error) {
      if (error instanceof HttpError) {
        throw new Error(error.message);
      }
      throw error;
    }
  }

  async migrateFromSession(): Promise<{ migrated: number; message: string }> {
    await waitForAuthReady();
    try {
      const response = await httpClient.post<{ migrated: number; message: string }>(
        `${this.apiBase}/v1/conversations/migrate`
      );
      return response.data;
    } catch (error) {
      if (error instanceof HttpError) {
        throw new Error(error.message);
      }
      throw error;
    }
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
