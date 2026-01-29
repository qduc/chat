/**
 * Chat and Judge API module
 */

import { httpClient, HttpError } from '../http';
import { getToken, waitForAuthReady } from '../storage';
import { APIError } from '../streaming';
import { resolveApiBase } from '../urlUtils';
import {
  isStreamingResponse,
  handleStreamingResponse,
  handleJudgeStreamingResponse,
} from './streaming-handler';
import type { ChatOptions, ChatOptionsExtended, ChatResponse, Evaluation } from '../types';

export interface JudgeOptions {
  conversationId: string;
  messageId: string;
  models: Array<{
    modelId: string;
    conversationId: string;
    messageId: string;
  }>;
  judgeModelId: string;
  criteria?: string | null;
  judgeProviderId?: string | null;
  apiBase?: string;
  signal?: AbortSignal;
  requestId?: string;
  onToken?: (token: string) => void;
  onEvaluation?: (evaluation: Evaluation) => void;
}

function buildRequestBody(options: ChatOptions | ChatOptionsExtended, stream: boolean): any {
  const { messages, model, providerId, responseId } = options;
  const extendedOptions = options as ChatOptionsExtended;

  const normalizedMessages = Array.isArray(messages)
    ? messages.filter((message): message is ChatOptions['messages'][number] => !!message)
    : [];

  let outgoingMessages: any[] = [];

  if (!extendedOptions.conversationId) {
    // New conversation (or retry in new conversation context): send full history to ensure persistence
    outgoingMessages = normalizedMessages.map((m) => ({ ...m, uuid: m.id }));
  } else {
    // Existing conversation: send only the latest user message as optimization
    // (backend loads history from DB)
    const latestUserMessage = [...normalizedMessages]
      .reverse()
      .find((message) => message.role === 'user');

    const messageToSend = latestUserMessage ?? normalizedMessages[normalizedMessages.length - 1];
    outgoingMessages = messageToSend ? [{ ...messageToSend, uuid: messageToSend.id }] : [];
  }

  // Frontend always uses SSE (stream: true) to receive real-time updates
  // providerStream controls upstream behavior based on user's streaming toggle
  const providerStream =
    extendedOptions.providerStream !== undefined ? extendedOptions.providerStream : stream;

  const bodyObj: any = {
    model,
    ...(outgoingMessages.length > 0 ? { messages: outgoingMessages } : {}),
    stream: true, // Always true for frontend SSE connection
    providerStream,
    provider_stream: providerStream,
    provider_id: providerId,
    ...(responseId && { previous_response_id: responseId }),
    ...(extendedOptions.conversationId && { conversation_id: extendedOptions.conversationId }),
    ...((extendedOptions as any).parentConversationId && {
      parent_conversation_id: (extendedOptions as any).parentConversationId,
    }),
    ...(extendedOptions.streamingEnabled !== undefined && {
      streamingEnabled: extendedOptions.streamingEnabled,
    }),
    ...(extendedOptions.toolsEnabled !== undefined && {
      toolsEnabled: extendedOptions.toolsEnabled,
    }),
    ...((options as any).systemPrompt && { system_prompt: (options as any).systemPrompt }),
    ...((options as any).activeSystemPromptId && {
      active_system_prompt_id: (options as any).activeSystemPromptId,
    }),
  };

  if (Object.hasOwn(extendedOptions as any, 'customRequestParamsId')) {
    const customParamsId = (extendedOptions as any).customRequestParamsId;
    bodyObj.custom_request_params_id = Array.isArray(customParamsId)
      ? customParamsId.length > 0
        ? customParamsId
        : null
      : (customParamsId ?? null);
  }

  // Add reasoning parameters when provided (user decides applicability)
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

  if (
    extendedOptions.tools &&
    Array.isArray(extendedOptions.tools) &&
    extendedOptions.tools.length > 0
  ) {
    bodyObj.tools = extendedOptions.tools;
    if (extendedOptions.toolChoice !== undefined) {
      bodyObj.tool_choice = extendedOptions.toolChoice;
    }
  }

  return bodyObj;
}

export const chat = {
  async sendMessage(options: ChatOptions | ChatOptionsExtended): Promise<ChatResponse> {
    await waitForAuthReady();
    const {
      apiBase = resolveApiBase(),
      stream = true,
      signal,
      onEvent,
      onToken,
      requestId,
    } = options;

    // Build request body - always request SSE from backend for real-time updates
    const bodyObj = buildRequestBody(options, stream);

    try {
      // Always use SSE for real-time tool updates, even when streaming is disabled
      const requestHeaders = {
        Accept: 'text/event-stream',
        ...(requestId ? { 'x-client-request-id': requestId } : {}),
      };

      const httpResponse = await httpClient.post(`${apiBase}/v1/chat/completions`, bodyObj, {
        signal,
        headers: requestHeaders,
      });

      let responseData = httpResponse.data;

      if (!isStreamingResponse(responseData)) {
        if (typeof fetch !== 'function') {
          throw new Error('Streaming fetch is not available in this environment');
        }

        const fallbackHeaders: Record<string, string> = {
          'Content-Type': 'application/json',
          ...requestHeaders,
        };

        if (typeof window !== 'undefined') {
          const token = getToken();
          if (token) {
            fallbackHeaders.Authorization = `Bearer ${token}`;
          }
        }
        if (requestId) {
          fallbackHeaders['x-client-request-id'] = requestId;
        }

        responseData = await fetch(`${apiBase}/v1/chat/completions`, {
          method: 'POST',
          headers: fallbackHeaders,
          body: JSON.stringify(bodyObj),
          signal,
          credentials: 'include',
        });
      }

      // Always handle as streaming response since backend always returns SSE
      return handleStreamingResponse(responseData as Response, onToken, onEvent);
    } catch (error) {
      if (error instanceof HttpError) {
        throw new APIError(error.status, error.message, error.data);
      }
      throw error;
    }
  },
  async stopMessage(options: {
    requestId: string;
    apiBase?: string;
  }): Promise<{ stopped: boolean }> {
    await waitForAuthReady();
    const { requestId, apiBase = resolveApiBase() } = options;
    if (!requestId) return { stopped: false };
    const response = await httpClient.post(`${apiBase}/v1/chat/completions/stop`, {
      request_id: requestId,
    });
    return response.data;
  },
};

export const judge = {
  async evaluate(options: JudgeOptions): Promise<Evaluation> {
    await waitForAuthReady();
    const {
      apiBase = resolveApiBase(),
      signal,
      requestId,
      onToken,
      onEvaluation,
      ...payload
    } = options;

    const bodyObj = {
      conversation_id: payload.conversationId,
      message_id: payload.messageId,
      models: payload.models.map((model) => ({
        model_id: model.modelId,
        conversation_id: model.conversationId,
        message_id: model.messageId,
      })),
      judge_model: payload.judgeModelId,
      judge_provider_id: payload.judgeProviderId ?? undefined,
      criteria: payload.criteria ?? null,
    };

    const requestHeaders = {
      Accept: 'text/event-stream',
      ...(requestId ? { 'x-client-request-id': requestId } : {}),
    };

    try {
      const httpResponse = await httpClient.post(`${apiBase}/v1/chat/judge`, bodyObj, {
        signal,
        headers: requestHeaders,
      });

      let responseData = httpResponse.data;
      if (!isStreamingResponse(responseData)) {
        if (typeof fetch !== 'function') {
          throw new Error('Streaming fetch is not available in this environment');
        }

        const fallbackHeaders: Record<string, string> = {
          'Content-Type': 'application/json',
          ...requestHeaders,
        };

        if (typeof window !== 'undefined') {
          const token = getToken();
          if (token) {
            fallbackHeaders.Authorization = `Bearer ${token}`;
          }
        }
        if (requestId) {
          fallbackHeaders['x-client-request-id'] = requestId;
        }

        responseData = await fetch(`${apiBase}/v1/chat/judge`, {
          method: 'POST',
          headers: fallbackHeaders,
          body: JSON.stringify(bodyObj),
          signal,
          credentials: 'include',
        });
      }

      return handleJudgeStreamingResponse(responseData as Response, onToken, onEvaluation);
    } catch (error) {
      if (error instanceof HttpError) {
        throw new APIError(error.status, error.message, error.data);
      }
      throw error;
    }
  },

  async deleteEvaluation(id: string): Promise<void> {
    await waitForAuthReady();
    const apiBase = resolveApiBase();
    try {
      await httpClient.delete(`${apiBase}/v1/chat/judge/${id}`);
    } catch (error) {
      if (error instanceof HttpError) {
        throw new APIError(error.status, error.message, error.data);
      }
      throw error;
    }
  },
};
