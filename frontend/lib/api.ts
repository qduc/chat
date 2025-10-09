/**
 * Consolidated API client for all backend operations
 * Auth, Chat, Conversations, Images, Tools, Providers
 */

import { httpClient, HttpError } from './http';
import { getToken, setToken, setRefreshToken, clearTokens, getRefreshToken, waitForAuthReady } from './storage';
import { SSEParser, APIError, StreamingNotSupportedError } from './streaming';
import type {
  User,
  LoginResponse,
  RegisterResponse,
  VerifySessionReason,
  VerifySessionResult,
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
  MessageContent,
  ImageAttachment,
  ImageConfig,
  ImageValidationResult,
  ImageUploadProgress,
  ToolsResponse,
  Provider,
  Role
} from './types';

// Resolve API base URL
const DEFAULT_API_BASE = typeof window !== 'undefined'
  ? `${window.location.origin}/api`
  : process.env.NEXT_PUBLIC_API_BASE || 'http://backend:3001/api';

function resolveApiBase(): string {
  return DEFAULT_API_BASE;
}

// ============================================================================
// Cache Utility
// ============================================================================

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

class Cache<T> {
  private cache = new Map<string, CacheEntry<T>>();
  private ttl: number;

  constructor(ttlMs: number) {
    this.ttl = ttlMs;
  }

  set(key: string, data: T): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now()
    });
  }

  get(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    const age = Date.now() - entry.timestamp;
    if (age > this.ttl) {
      this.cache.delete(key);
      return null;
    }

    return entry.data;
  }

  clear(): void {
    this.cache.clear();
  }

  delete(key: string): void {
    this.cache.delete(key);
  }

  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;

    const age = Date.now() - entry.timestamp;
    if (age > this.ttl) {
      this.cache.delete(key);
      return false;
    }

    return true;
  }
}

// ============================================================================
// Auth API
// ============================================================================

async function refreshToken(): Promise<void> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) {
    throw new Error('No refresh token available');
  }

  try {
    const response = await httpClient.post<{ accessToken: string }>(
      '/v1/auth/refresh',
      { refreshToken },
      { skipAuth: true, skipRetry: true }
    );

    // Store new access token (refresh token remains the same)
    setToken(response.data.accessToken);
  } catch (error) {
    // Clear tokens if refresh fails
    clearTokens();
    throw error instanceof HttpError
      ? new Error(error.data?.message || 'Token refresh failed')
      : error;
  }
}

// Register the refresh function with httpClient
httpClient.setRefreshTokenFn(refreshToken);

export const auth = {
  async register(email: string, password: string, displayName?: string): Promise<RegisterResponse> {
    try {
      const response = await httpClient.post<RegisterResponse>(
        '/v1/auth/register',
        { email, password, displayName },
        { skipAuth: true }
      );

      // Store tokens
      setToken(response.data.tokens.accessToken);
      setRefreshToken(response.data.tokens.refreshToken);

      return response.data;
    } catch (error) {
      throw error instanceof HttpError
        ? new Error(error.data?.message || 'Registration failed')
        : error;
    }
  },

  async login(email: string, password: string): Promise<LoginResponse> {
    try {
      const response = await httpClient.post<LoginResponse>(
        '/v1/auth/login',
        { email, password },
        { skipAuth: true }
      );

      // Store tokens
      setToken(response.data.tokens.accessToken);
      setRefreshToken(response.data.tokens.refreshToken);

      return response.data;
    } catch (error) {
      throw error instanceof HttpError
        ? new Error(error.data?.message || 'Login failed')
        : error;
    }
  },

  async logout(): Promise<void> {
    const token = getToken();
    const refreshTokenValue = getRefreshToken();

    // Clear tokens immediately
    clearTokens();

    // Attempt to notify server (fire and forget)
    try {
      await httpClient.post(
        '/v1/auth/logout',
        { refreshToken: refreshTokenValue },
        { skipAuth: true, headers: token ? { 'Authorization': `Bearer ${token}` } : {} }
      );
    } catch (error) {
      // Ignore network errors during logout
      console.warn('Failed to notify server of logout:', error);
    }
  },

  async getProfile(): Promise<User> {
    try {
      const response = await httpClient.get<{ user: User }>('/v1/auth/me');
      return response.data.user;
    } catch (error) {
      throw error instanceof HttpError
        ? new Error(error.data?.message || 'Failed to fetch profile')
        : error;
    }
  },

  async verifySession(): Promise<VerifySessionResult> {
    const token = getToken();
    if (!token) {
      return {
        valid: false,
        user: null,
        reason: 'missing-token',
      };
    }

    try {
      const user = await this.getProfile();
      return {
        valid: true,
        user,
      };
    } catch (error) {
      let reason: VerifySessionReason = 'unknown';

      if (error instanceof Error) {
        const message = error.message.toLowerCase();
        if (message.includes('expired') || message.includes('not authenticated')) {
          reason = 'expired';
        } else if (message.includes('invalid')) {
          reason = 'invalid';
        } else if (message.includes('network') || message.includes('fetch')) {
          reason = 'network';
        }
      }

      if (reason === 'expired' || reason === 'invalid') {
        clearTokens();
      }

      return {
        valid: false,
        user: null,
        reason,
        error,
      };
    }
  }
};

// ============================================================================
// Chat API
// ============================================================================

// OpenAI API response format types
interface OpenAIStreamChunkChoiceDelta {
  role?: Role;
  content?: string;
  tool_calls?: any[];
  tool_output?: any;
  reasoning?: string;
  reasoning_content?: string;
}

interface OpenAIStreamChunkChoice {
  delta?: OpenAIStreamChunkChoiceDelta;
  finish_reason?: string | null;
}

interface OpenAIStreamChunk {
  choices?: OpenAIStreamChunkChoice[];
}

export const chat = {
  async sendMessage(options: ChatOptions | ChatOptionsExtended): Promise<ChatResponse> {
    await waitForAuthReady();
    const {
      apiBase = resolveApiBase(),
      stream = true,
      signal,
      onEvent,
      onToken
    } = options;

    // Build request body
    const bodyObj = buildRequestBody(options, stream);

    try {
      const httpResponse = await httpClient.post(
        `${apiBase}/v1/chat/completions`,
        bodyObj,
        {
          signal,
          headers: stream
            ? { 'Accept': 'text/event-stream' }
            : { 'Accept': 'application/json' }
        }
      );

      if (stream) {
        return handleStreamingResponse(httpResponse.data as Response, onToken, onEvent);
      } else {
        return processNonStreamingData(httpResponse.data, onToken, onEvent);
      }
    } catch (error) {
      if (error instanceof HttpError) {
        throw new APIError(error.status, error.message, error.data);
      }
      throw error;
    }
  }
};

function buildRequestBody(options: ChatOptions | ChatOptionsExtended, stream: boolean): any {
  const { messages, model, providerId, responseId } = options;
  const extendedOptions = options as ChatOptionsExtended;

  const normalizedMessages = Array.isArray(messages)
    ? messages.filter((message): message is ChatOptions['messages'][number] => !!message)
    : [];

  const latestUserMessage = [...normalizedMessages]
    .reverse()
    .find((message) => message.role === 'user');

  const messageToSend = latestUserMessage ?? normalizedMessages[normalizedMessages.length - 1];

  const outgoingMessages = messageToSend
    ? [{ ...messageToSend, uuid: messageToSend.id }]
    : [];

  const bodyObj: any = {
    model,
    ...(outgoingMessages.length > 0 ? { messages: outgoingMessages } : {}),
    stream,
    provider_id: providerId,
    ...(responseId && { previous_response_id: responseId }),
    ...(extendedOptions.conversationId && { conversation_id: extendedOptions.conversationId }),
    ...(extendedOptions.streamingEnabled !== undefined && { streamingEnabled: extendedOptions.streamingEnabled }),
    ...(extendedOptions.toolsEnabled !== undefined && { toolsEnabled: extendedOptions.toolsEnabled }),
    ...(extendedOptions.qualityLevel !== undefined && { qualityLevel: extendedOptions.qualityLevel }),
    ...((options as any).systemPrompt && { system_prompt: (options as any).systemPrompt }),
    ...((options as any).activeSystemPromptId && { active_system_prompt_id: (options as any).activeSystemPromptId })
  };

  // Map qualityLevel to reasoning_effort (only if not 'unset')
  if (extendedOptions.qualityLevel && extendedOptions.qualityLevel !== 'unset') {
    bodyObj.reasoning_effort = extendedOptions.qualityLevel;
  }

  if (extendedOptions.reasoning) {
    if (extendedOptions.reasoning.effort) {
      bodyObj.reasoning_effort = extendedOptions.reasoning.effort;
    }
    if (extendedOptions.reasoning.verbosity) {
      bodyObj.verbosity = extendedOptions.reasoning.verbosity;
    }
    if (extendedOptions.reasoning.summary) {
      bodyObj.reasoning_summary = extendedOptions.reasoning.summary;
    }
  }
  if ((options as any).reasoningEffort) {
    bodyObj.reasoning_effort = (options as any).reasoningEffort;
  }
  if ((options as any).verbosity) {
    bodyObj.verbosity = (options as any).verbosity;
  }

  if (extendedOptions.tools && Array.isArray(extendedOptions.tools) && extendedOptions.tools.length > 0) {
    bodyObj.tools = extendedOptions.tools;
    if (extendedOptions.toolChoice !== undefined) {
      bodyObj.tool_choice = extendedOptions.toolChoice;
    }
  }

  return bodyObj;
}

function processNonStreamingData(
  json: any,
  onToken?: (token: string) => void,
  onEvent?: (event: any) => void
): ChatResponse {
  // Track if we processed text events (to avoid duplication with choices[0].message.content)
  let hasTextEvents = false;

  // Check for errors in the response body
  if (json.error) {
    const errorMessage = json.error.message || json.error || JSON.stringify(json.error);

    // Check for organization verification error (streaming not supported)
    if (typeof errorMessage === 'string' &&
        (errorMessage.includes('Your organization must be verified to stream') ||
         errorMessage.includes('organization must be verified'))) {
      throw new StreamingNotSupportedError(errorMessage);
    }

    // Throw generic API error for other error types
    const status = json.error.code === 'invalid_request_error' ? 400 : 500;
    throw new APIError(status, errorMessage, json.error);
  }

  if (json.tool_events && Array.isArray(json.tool_events)) {
    for (const event of json.tool_events) {
      if (event.type === 'text') {
        onEvent?.({ type: 'text', value: event.value });
        onToken?.(event.value);
        hasTextEvents = true;
      } else if (event.type === 'tool_call') {
        onEvent?.({ type: 'tool_call', value: event.value });
      } else if (event.type === 'tool_output') {
        onEvent?.({ type: 'tool_output', value: event.value });
      }
    }
  }

  const conversation = json._conversation ? {
    id: json._conversation.id,
    title: json._conversation.title,
    model: json._conversation.model,
    created_at: json._conversation.created_at,
    ...(typeof json._conversation.tools_enabled === 'boolean'
      ? { tools_enabled: json._conversation.tools_enabled }
      : {}),
    ...(Array.isArray(json._conversation.active_tools)
      ? { active_tools: json._conversation.active_tools }
      : {}),
    ...(json._conversation.seq !== undefined
      ? { seq: json._conversation.seq }
      : {}),
    ...(json._conversation.user_message_id !== undefined
      ? { user_message_id: json._conversation.user_message_id }
      : {}),
    ...(json._conversation.assistant_message_id !== undefined
      ? { assistant_message_id: json._conversation.assistant_message_id }
      : {}),
  } : undefined;

  let content = '';
  let reasoningDetails: any[] | undefined;
  let reasoningTokens: number | undefined;

  // If we already sent text via tool_events, don't duplicate by returning content
  // The text has already been handled by onEvent/onToken callbacks
  if (!hasTextEvents) {
    if (json?.choices && Array.isArray(json.choices)) {
      const message = json.choices[0]?.message;
      content = message?.content ?? '';

      if (message?.reasoning) {
        content = `<thinking>${message.reasoning}</thinking>\n\n${content}`;
      }

      if (Array.isArray(message?.reasoning_details)) {
        reasoningDetails = message.reasoning_details;
      }
    } else {
      content = json?.content ?? json?.message?.content ?? '';
      if (Array.isArray(json?.reasoning_details)) {
        reasoningDetails = json.reasoning_details;
      }
    }
  }

  const usage: any = {};
  if (json.provider) usage.provider = json.provider;
  if (json.model) usage.model = json.model;
  if (json.usage) {
    if (json.usage.prompt_tokens !== undefined) usage.prompt_tokens = json.usage.prompt_tokens;
    if (json.usage.completion_tokens !== undefined) usage.completion_tokens = json.usage.completion_tokens;
    if (json.usage.total_tokens !== undefined) usage.total_tokens = json.usage.total_tokens;
    if (json.usage.reasoning_tokens !== undefined) {
      usage.reasoning_tokens = json.usage.reasoning_tokens;
      reasoningTokens = json.usage.reasoning_tokens;
    }
  }

  if (Object.keys(usage).length > 0) {
    onEvent?.({ type: 'usage', value: usage });
  }

  return {
    content,
    responseId: json?.id,
    conversation,
    reasoning_summary: json?.reasoning_summary,
    ...(reasoningDetails ? { reasoning_details: reasoningDetails } : {}),
    ...(reasoningTokens !== undefined ? { reasoning_tokens: reasoningTokens } : {}),
    ...(Object.keys(usage).length > 0 ? { usage } : {})
  };
}

async function handleStreamingResponse(
  response: Response,
  onToken?: (token: string) => void,
  onEvent?: (event: any) => void
): Promise<ChatResponse> {
  if (!response.body) {
    throw new Error('No response body');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  const parser = new SSEParser();

  let content = '';
  let responseId: string | undefined;
  let conversation: ConversationMeta | undefined;
  let reasoningStarted = false;
  let reasoning_summary: string | undefined;
  let usage: any | undefined;
  let reasoning_details: any[] | undefined;
  let reasoning_tokens: number | undefined;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const events = parser.parse(chunk);

      for (const event of events) {
        if (event.type === 'done') {
          if (reasoningStarted) {
            const closingTag = '</thinking>';
            onToken?.(closingTag);
            content += closingTag;
          }

          return {
            content,
            responseId,
            conversation,
            reasoning_summary,
            ...(reasoning_details ? { reasoning_details } : {}),
            ...(reasoning_tokens !== undefined ? { reasoning_tokens } : {}),
            ...(usage ? { usage } : {})
          };
        }

        if (event.type === 'data' && event.data) {
          const result = processStreamChunk(event.data, onToken, onEvent, reasoningStarted);
          if (result.content) content += result.content;
          if (result.responseId) responseId = result.responseId;
          if (result.conversation) conversation = result.conversation;
          if (result.reasoningStarted !== undefined) reasoningStarted = result.reasoningStarted;
          if (result.reasoning_summary) reasoning_summary = result.reasoning_summary;
          if (result.usage) usage = { ...usage, ...result.usage };
          if (result.reasoningDetails) reasoning_details = result.reasoningDetails;
          if (result.reasoningTokens !== undefined) reasoning_tokens = result.reasoningTokens;
        }
      }
    }
  } finally {
    if (typeof (reader as any).releaseLock === 'function') {
      (reader as any).releaseLock();
    }
  }

  return {
    content,
    responseId,
    conversation,
    reasoning_summary,
    ...(reasoning_details ? { reasoning_details } : {}),
    ...(reasoning_tokens !== undefined ? { reasoning_tokens } : {}),
    ...(usage ? { usage } : {})
  };
}

function processStreamChunk(
  data: any,
  onToken?: (token: string) => void,
  onEvent?: (event: any) => void,
  reasoningStarted?: boolean
): { content?: string; responseId?: string; conversation?: ConversationMeta; reasoningStarted?: boolean; reasoning_summary?: string; usage?: any; reasoningDetails?: any[]; reasoningTokens?: number } {
  if (data._conversation) {
    return {
      conversation: {
        id: data._conversation.id,
        title: data._conversation.title,
        model: data._conversation.model,
        created_at: data._conversation.created_at,
        ...(typeof data._conversation.tools_enabled === 'boolean'
          ? { tools_enabled: data._conversation.tools_enabled }
          : {}),
        ...(Array.isArray(data._conversation.active_tools)
          ? { active_tools: data._conversation.active_tools }
          : {}),
        ...(data._conversation.seq !== undefined
          ? { seq: data._conversation.seq }
          : {}),
        ...(data._conversation.user_message_id !== undefined
          ? { user_message_id: data._conversation.user_message_id }
          : {}),
        ...(data._conversation.assistant_message_id !== undefined
          ? { assistant_message_id: data._conversation.assistant_message_id }
          : {}),
      }
    };
  }

  if (data.reasoning_summary) {
    return {
      reasoning_summary: data.reasoning_summary
    };
  }

  const result: { content?: string; usage?: any; reasoningStarted?: boolean; reasoningDetails?: any[]; reasoningTokens?: number } = {};

  if (data.usage || data.provider || data.model) {
    const usage: any = {};
    if (data.provider) usage.provider = data.provider;
    if (data.model) usage.model = data.model;
    if (data.usage) {
      if (data.usage.prompt_tokens !== undefined) usage.prompt_tokens = data.usage.prompt_tokens;
      if (data.usage.completion_tokens !== undefined) usage.completion_tokens = data.usage.completion_tokens;
      if (data.usage.total_tokens !== undefined) usage.total_tokens = data.usage.total_tokens;
      if (data.usage.reasoning_tokens !== undefined) {
        usage.reasoning_tokens = data.usage.reasoning_tokens;
        result.reasoningTokens = data.usage.reasoning_tokens;
      }
    }

    if (Object.keys(usage).length > 0) {
      onEvent?.({ type: 'usage', value: usage });
      result.usage = usage;
    }
  }

  if (Array.isArray((data as any).reasoning_details)) {
    result.reasoningDetails = (data as any).reasoning_details;
  }

  if (typeof (data as any).reasoning_tokens === 'number') {
    result.reasoningTokens = (data as any).reasoning_tokens;
  }

  const chunk = data as OpenAIStreamChunk;
  const delta = chunk.choices?.[0]?.delta;

  if (reasoningStarted && delta?.content) {
    const closingTag = '</thinking>';
    onToken?.(closingTag);
    onToken?.(delta.content);

    return {
      ...result,
      content: closingTag + delta.content,
      reasoningStarted: false
    };
  }

  const currentReasoning = delta?.reasoning_content ?? delta?.reasoning;

  if (currentReasoning) {
    let contentToAdd = '';

    if (!reasoningStarted) {
      contentToAdd = '<thinking>' + currentReasoning;
      reasoningStarted = true;
    } else {
      contentToAdd = currentReasoning;
    }

    onToken?.(contentToAdd);
    onEvent?.({ type: 'reasoning', value: currentReasoning });

    return {
      ...result,
      content: contentToAdd,
      reasoningStarted
    };
  }

  if (delta?.content) {
    // Check for streaming not supported error
    if (typeof delta.content === 'string' &&
        delta.content.includes('Your organization must be verified to stream this model')) {
      throw new StreamingNotSupportedError(delta.content);
    }

    onToken?.(delta.content);
    return { ...result, content: delta.content };
  }

  if (delta?.tool_calls) {
    let closingContent = '';

    if (reasoningStarted) {
      const closingTag = '</thinking>';
      onToken?.(closingTag);
      closingContent = closingTag;
      reasoningStarted = false;
    }

    for (const toolCall of delta.tool_calls) {
      onEvent?.({ type: 'tool_call', value: toolCall });
    }

    return {
      ...result,
      ...(closingContent ? { content: closingContent } : {}),
      reasoningStarted
    };
  }

  if (delta?.tool_output) {
    onEvent?.({ type: 'tool_output', value: delta.tool_output });
  }

  return result;
}

// ============================================================================
// Conversations API
// ============================================================================

const CACHE_TTL_MS = 5 * 60 * 1000;
const conversationListCache = new Cache<ConversationsList>(CACHE_TTL_MS);
const conversationDetailCache = new Cache<ConversationWithMessages>(CACHE_TTL_MS);

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
      conversationDetailCache.delete(`get:${id}:`);
    } catch (error) {
      throw error instanceof HttpError ? new Error(error.message) : error;
    }
  },

  clearListCache() {
    conversationListCache.clear();
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
      const response = await httpClient.post<{ migrated: number; message: string }>('/v1/conversations/migrate');
      return response.data;
    } catch (error) {
      throw error instanceof HttpError ? new Error(error.message) : error;
    }
  }
};

// ============================================================================
// Images API
// ============================================================================

export const images = {
  async getConfig(): Promise<ImageConfig> {
    const response = await httpClient.get('/v1/images/config');
    return response.data;
  },

  async validateImages(files: File[], config?: ImageConfig): Promise<ImageValidationResult> {
    const actualConfig = config || await this.getConfig();
    const errors: string[] = [];
    const warnings: string[] = [];

    if (files.length > actualConfig.maxImagesPerMessage) {
      errors.push(`Maximum ${actualConfig.maxImagesPerMessage} images allowed per message`);
    }

    for (const file of files) {
      if (file.size > actualConfig.maxFileSize) {
        const maxSizeMB = actualConfig.maxFileSize / (1024 * 1024);
        errors.push(`${file.name}: File size (${(file.size / (1024 * 1024)).toFixed(1)}MB) exceeds ${maxSizeMB}MB limit`);
      }

      const ext = file.name.split('.').pop()?.toLowerCase();
      if (!ext || !actualConfig.allowedFormats.includes(ext)) {
        errors.push(`${file.name}: Invalid file type. Allowed: ${actualConfig.allowedFormats.join(', ')}`);
      }

      if (!file.type.startsWith('image/')) {
        errors.push(`${file.name}: Not a valid image file`);
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings: warnings.length > 0 ? warnings : undefined
    };
  },

  async uploadImages(
    files: File[],
    onProgress?: (progress: ImageUploadProgress[]) => void
  ): Promise<ImageAttachment[]> {
    const validation = await this.validateImages(files);
    if (!validation.isValid) {
      throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
    }

    const formData = new FormData();
    files.forEach(file => {
      formData.append('images', file);
    });

    const apiBase = resolveApiBase();
    const toAbsoluteUrl = (value?: string | null) => {
      if (!value) return undefined;
      if (/^https?:\/\//i.test(value)) {
        return value;
      }
      const normalized = value.startsWith('/') ? value : `/${value}`;
      return `${apiBase}${normalized}`;
    };

    const progressData: ImageUploadProgress[] = files.map((file, index) => ({
      imageId: `temp-${index}`,
      state: 'pending' as const,
      progress: 0,
    }));

    if (onProgress) {
      onProgress(progressData);
    }

    try {
      progressData.forEach(p => {
        p.state = 'uploading';
        p.progress = 0;
      });

      if (onProgress) {
        onProgress([...progressData]);
      }

      const response = await httpClient.post('/v1/images/upload', formData);

      const uploadedImages = response.data.images;
      const result: ImageAttachment[] = uploadedImages.map((img: any, index: number) => {
        progressData[index].state = 'ready';
        progressData[index].progress = 100;
        progressData[index].imageId = img.id;

        return {
          id: img.id,
          file: files[index],
          url: toAbsoluteUrl(img.url) ?? `${apiBase}/v1/images/${img.id}`,
          downloadUrl: toAbsoluteUrl(img.downloadUrl),
          accessToken: typeof img.accessToken === 'string' ? img.accessToken : undefined,
          expiresAt: typeof img.expiresAt === 'string' ? img.expiresAt : undefined,
          expiresIn: typeof img.expiresIn === 'number' ? img.expiresIn : undefined,
          name: img.originalFilename || img.filename,
          size: img.size,
          type: img.type,
          alt: img.alt,
        };
      });

      if (onProgress) {
        onProgress([...progressData]);
      }

      return result;

    } catch (error: any) {
      progressData.forEach(p => {
        p.state = 'error';
        p.error = error.message || 'Upload failed';
      });

      if (onProgress) {
        onProgress([...progressData]);
      }

      throw error;
    }
  },

  createPreviewUrl(file: File): string {
    return URL.createObjectURL(file);
  },

  revokePreviewUrl(url: string): void {
    if (url.startsWith('blob:')) {
      URL.revokeObjectURL(url);
    }
  },

  attachmentToImageContent(attachment: ImageAttachment, detail: 'auto' | 'low' | 'high' = 'auto') {
    const rawUrl = attachment.url;
    return {
      type: 'image_url' as const,
      image_url: {
        url: rawUrl,
        detail,
      },
    };
  }
};

// ============================================================================
// Tools API
// ============================================================================

export const tools = {
  async getToolSpecs(): Promise<ToolsResponse> {
    const response = await httpClient.get<ToolsResponse>('/v1/tools');
    return response.data;
  }
};

// ============================================================================
// Providers API
// ============================================================================

let cachedDefaultProvider: string | null = null;

export const providers = {
  async getDefaultProviderId(): Promise<string> {
    if (cachedDefaultProvider) {
      return cachedDefaultProvider;
    }

    try {
      await waitForAuthReady();
      const response = await httpClient.get<{ providers: Provider[] }>('/v1/providers');

      const providerList: Provider[] = Array.isArray(response.data.providers) ? response.data.providers : [];
      const enabledProviders = providerList.filter(p => p.enabled === 1);

      if (enabledProviders.length === 0) {
        throw new Error('No enabled providers found');
      }

      enabledProviders.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());

      cachedDefaultProvider = enabledProviders[0].id;
      return cachedDefaultProvider;
    } catch (error) {
      console.error('Failed to get default provider:', error);
      throw new Error('Unable to determine default provider');
    }
  },

  clearCache() {
    cachedDefaultProvider = null;
  }
};
