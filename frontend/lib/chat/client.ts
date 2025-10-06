import {
  ChatOptions,
  ChatOptionsExtended,
  ChatResponse,
  ConversationMeta,
  Role
} from './types';
import { SSEParser, APIError } from './utils';
import { waitForAuthReady } from '../auth/ready';
import { httpClient } from '../http/client';
import { HttpError } from '../http/types';
import { resolveApiBase } from '../config/apiBase';

const defaultApiBase = resolveApiBase();

// OpenAI API response format types
interface OpenAIStreamChunkChoiceDelta {
  role?: Role;
  content?: string;
  tool_calls?: any[];
  tool_output?: any;
  reasoning?: string;
  reasoning_content?: string; // Add reasoning_content
}

interface OpenAIStreamChunkChoice {
  delta?: OpenAIStreamChunkChoiceDelta;
  finish_reason?: string | null;
}

interface OpenAIStreamChunk {
  choices?: OpenAIStreamChunkChoice[];
}

export class ChatClient {
  constructor(private apiBase: string = defaultApiBase) {}

  async sendMessage(options: ChatOptions): Promise<ChatResponse> {
    return this.sendMessageInternal(options);
  }

  async sendMessageWithTools(options: ChatOptionsExtended): Promise<ChatResponse> {
    return this.sendMessageInternal(options);
  }

  private async sendMessageInternal(options: ChatOptions | ChatOptionsExtended): Promise<ChatResponse> {
    await waitForAuthReady();
    const {
      apiBase = this.apiBase,
      stream = true,
      signal,
      onEvent,
      onToken
    } = options;

    // Build request body
    const bodyObj = this.buildRequestBody(options, stream);

    try {
      // Use the HTTP client for both streaming and non-streaming requests
      // It will handle 401 errors and token refresh automatically
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
        // For streaming, httpResponse.data will be the raw Response object
        return this.handleStreamingResponse(httpResponse.data as Response, onToken, onEvent);
      } else {
        // For non-streaming, httpResponse.data will be the parsed JSON
        return this.processNonStreamingData(httpResponse.data, onToken, onEvent);
      }
    } catch (error) {
      if (error instanceof HttpError) {
        throw new APIError(error.status, error.message, error.data);
      }
      throw error;
    }
  }

  private buildRequestBody(options: ChatOptions | ChatOptionsExtended, stream: boolean): any {
    const { messages, model, providerId, responseId } = options;
    const extendedOptions = options as ChatOptionsExtended;

    const normalizedMessages = Array.isArray(messages)
      ? messages.filter((message): message is ChatOptions['messages'][number] => !!message)
      : [];

    const latestUserMessage = [...normalizedMessages]
      .reverse()
      .find((message) => message.role === 'user');

    const messageToSend = latestUserMessage ?? normalizedMessages[normalizedMessages.length - 1];

    // Simply spread all properties from messageToSend - this includes seq if it exists
    const outgoingMessages = messageToSend ? [{ ...messageToSend }] : [];

    // DEBUG: Check what's being sent to backend
    if (outgoingMessages.length > 0) {
      console.log('[DEBUG] Final outgoing message to backend:', {
        role: outgoingMessages[0].role,
        seq: outgoingMessages[0].seq,
        hasSeq: outgoingMessages[0].seq !== undefined,
        allKeys: Object.keys(outgoingMessages[0])
      });
    }

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
      // Send effective system prompt as single field
      ...((options as any).systemPrompt && { system_prompt: (options as any).systemPrompt }),
      // Send active system prompt ID for persistence
      ...((options as any).activeSystemPromptId && { active_system_prompt_id: (options as any).activeSystemPromptId })
    };

    // Handle reasoning parameters - send for persistence even if model doesn't support them
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
    // Also support legacy SendChatOptions fields for backward compatibility
    if ((options as any).reasoningEffort) {
      bodyObj.reasoning_effort = (options as any).reasoningEffort;
    }
    if ((options as any).verbosity) {
      bodyObj.verbosity = (options as any).verbosity;
    }

    // Handle tools
    if (extendedOptions.tools && Array.isArray(extendedOptions.tools) && extendedOptions.tools.length > 0) {
      bodyObj.tools = extendedOptions.tools;
      if (extendedOptions.toolChoice !== undefined) {
        bodyObj.tool_choice = extendedOptions.toolChoice;
      }
    }

    return bodyObj;
  }

  /**
   * Process non-streaming response data (equivalent to handleNonStreamingResponse but without Response parsing)
   */
  private processNonStreamingData(
    json: any,
    onToken?: (token: string) => void,
    onEvent?: (event: any) => void
  ): ChatResponse {
    // Process tool_events if present
    if (json.tool_events && Array.isArray(json.tool_events)) {
      for (const event of json.tool_events) {
        if (event.type === 'text') {
          onEvent?.({ type: 'text', value: event.value });
          onToken?.(event.value);
        } else if (event.type === 'tool_call') {
          onEvent?.({ type: 'tool_call', value: event.value });
        } else if (event.type === 'tool_output') {
          onEvent?.({ type: 'tool_output', value: event.value });
        }
      }
    }

    // Extract conversation metadata
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

    // Extract content
    let content = '';
    let reasoningDetails: any[] | undefined;
    let reasoningTokens: number | undefined;

    if (json?.choices && Array.isArray(json.choices)) {
      const message = json.choices[0]?.message;
      content = message?.content ?? '';

      // Handle reasoning content from non-streaming response
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

    // Extract usage metadata
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

    // Emit usage event if we have usage data
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

  private async handleErrorResponse(response: Response): Promise<never> {
    let errorMessage = `HTTP ${response.status}`;
    let errorBody: any;

    try {
      errorBody = await response.json();
      errorMessage += `: ${errorBody.error || errorBody.message || JSON.stringify(errorBody)}`;
    } catch {
      // Ignore JSON parse errors
    }

    throw new APIError(response.status, errorMessage, errorBody);
  }

  private async handleNonStreamingResponse(
    response: Response,
    onToken?: (token: string) => void,
    onEvent?: (event: any) => void
  ): Promise<ChatResponse> {
    const json = await response.json();
    return this.processNonStreamingData(json, onToken, onEvent);
  }

  private async handleStreamingResponse(
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
            // If we're in the middle of reasoning, close the thinking tag
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
            const result = this.processStreamChunk(event.data, onToken, onEvent, reasoningStarted);
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
      // Some polyfilled readers (in tests) may not support releaseLock
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

  private processStreamChunk(
    data: any,
    onToken?: (token: string) => void,
    onEvent?: (event: any) => void,
    reasoningStarted?: boolean
  ): { content?: string; responseId?: string; conversation?: ConversationMeta; reasoningStarted?: boolean; reasoning_summary?: string; usage?: any; reasoningDetails?: any[]; reasoningTokens?: number } {
    // Handle conversation metadata
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

    // Handle reasoning_summary if present in the chunk
    if (data.reasoning_summary) {
      return {
        reasoning_summary: data.reasoning_summary
      };
    }

    const result: { content?: string; usage?: any; reasoningStarted?: boolean; reasoningDetails?: any[]; reasoningTokens?: number } = {};

    // Handle usage data if present in the chunk
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

    // Handle Chat Completions API stream format
    const chunk = data as OpenAIStreamChunk;
    const delta = chunk.choices?.[0]?.delta;

    if (reasoningStarted && delta?.content) {
      const closingTag = '</thinking>';
      onToken?.(closingTag);
      onToken?.(delta.content);
      onEvent?.({ type: 'text', value: delta.content });

      return {
        ...result,
        content: closingTag + delta.content,
        reasoningStarted: false
      };
    }

    // Prioritize reasoning_content, then fall back to reasoning
    const currentReasoning = delta?.reasoning_content ?? delta?.reasoning;

    if (currentReasoning) {
      let contentToAdd = '';

      // If this is the first reasoning token, open the thinking tag
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
      onToken?.(delta.content);
      onEvent?.({ type: 'text', value: delta.content });
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
}
