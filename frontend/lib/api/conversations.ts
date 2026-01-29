/**
 * Conversations API module
 */

import { httpClient, HttpError } from '../http';
import { waitForAuthReady, onTokensCleared } from '../storage';
import { Cache } from '../cache';
import type {
  ConversationMeta,
  ConversationsList,
  ConversationWithMessages,
  ConversationCreateOptions,
  ListConversationsParams,
  GetConversationParams,
  EditMessageResult,
  MessageContent,
} from '../types';

const CACHE_TTL_MS = 5 * 60 * 1000;
const conversationListCache = new Cache<ConversationsList>(CACHE_TTL_MS);
const conversationDetailCache = new Cache<ConversationWithMessages>(CACHE_TTL_MS);

// Clear caches when tokens are cleared (logout)
onTokensCleared(() => {
  conversationListCache.clear();
  conversationDetailCache.clear();
});

export const conversations = {
  async create(options: ConversationCreateOptions = {}): Promise<ConversationMeta> {
    await waitForAuthReady();
    try {
      const response = await httpClient.post<ConversationMeta>('/v1/conversations', options);
      conversationListCache.clear();
      return response.data;
    } catch (error) {
      throw error instanceof HttpError ? new Error(error.message) : error;
    }
  },

  async list(params: ListConversationsParams = {}): Promise<ConversationsList> {
    await waitForAuthReady();
    const searchParams = new URLSearchParams();
    if (params.cursor) searchParams.set('cursor', params.cursor);
    if (params.limit) searchParams.set('limit', String(params.limit));

    const cacheKey = `list:${searchParams.toString()}`;
    const cached = conversationListCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const url = `/v1/conversations${searchParams.toString() ? `?${searchParams.toString()}` : ''}`;
      const response = await httpClient.get<ConversationsList>(url);
      conversationListCache.set(cacheKey, response.data);
      return response.data;
    } catch (error) {
      throw error instanceof HttpError ? new Error(error.message) : error;
    }
  },

  async get(id: string, params: GetConversationParams = {}): Promise<ConversationWithMessages> {
    await waitForAuthReady();
    const searchParams = new URLSearchParams();
    if (params.after_seq) searchParams.set('after_seq', String(params.after_seq));
    if (params.limit) searchParams.set('limit', String(params.limit));
    if (params.include_linked) searchParams.set('include_linked', params.include_linked);

    const cacheKey = `get:${id}:${searchParams.toString()}`;
    const cached = conversationDetailCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const url = `/v1/conversations/${id}${searchParams.toString() ? `?${searchParams.toString()}` : ''}`;
      const response = await httpClient.get<ConversationWithMessages>(url);
      conversationDetailCache.set(cacheKey, response.data);
      return response.data;
    } catch (error) {
      throw error instanceof HttpError ? new Error(error.message) : error;
    }
  },

  async delete(id: string): Promise<void> {
    await waitForAuthReady();
    try {
      await httpClient.delete(`/v1/conversations/${id}`);
      conversationListCache.clear();
      conversationDetailCache.deleteByPrefix(`get:${id}:`);
    } catch (error) {
      throw error instanceof HttpError ? new Error(error.message) : error;
    }
  },

  clearListCache() {
    conversationListCache.clear();
  },

  invalidateDetailCache(conversationId: string) {
    conversationDetailCache.deleteByPrefix(`get:${conversationId}:`);
  },

  async editMessage(
    conversationId: string,
    messageId: string,
    content: MessageContent
  ): Promise<EditMessageResult> {
    await waitForAuthReady();
    try {
      const response = await httpClient.put<EditMessageResult>(
        `/v1/conversations/${conversationId}/messages/${messageId}/edit`,
        { content }
      );
      conversationDetailCache.clear();
      conversationListCache.clear();
      return response.data;
    } catch (error) {
      throw error instanceof HttpError ? new Error(error.message) : error;
    }
  },

  async migrateFromSession(): Promise<{ migrated: number; message: string }> {
    await waitForAuthReady();
    try {
      const response = await httpClient.post<{ migrated: number; message: string }>(
        '/v1/conversations/migrate'
      );
      return response.data;
    } catch (error) {
      throw error instanceof HttpError ? new Error(error.message) : error;
    }
  },

  /**
   * Get linked comparison conversations for a parent conversation
   * @param parentId - The parent conversation ID
   * @returns Array of linked conversation metadata
   */
  async getLinked(parentId: string): Promise<{ conversations: ConversationMeta[] }> {
    await waitForAuthReady();
    try {
      const response = await httpClient.get<{ conversations: ConversationMeta[] }>(
        `/v1/conversations/${parentId}/linked`
      );
      return response.data;
    } catch (error) {
      throw error instanceof HttpError ? new Error(error.message) : error;
    }
  },
};
