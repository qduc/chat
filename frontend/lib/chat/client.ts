import {
  ChatOptions,
  ChatOptionsExtended,
  ChatResponse,
  ConversationMeta,
  Role
} from './types';
import { SSEParser, createRequestInit, APIError } from './utils';

const defaultApiBase = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:3001';

// OpenAI API response format types
interface OpenAIStreamChunkChoiceDelta {
  role?: Role;
  content?: string;
  tool_calls?: any[];
  tool_output?: any;
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
    const {
      apiBase = this.apiBase,
      messages,
      model,
      stream = true,
      signal,
      onEvent,
      onToken
    } = options;

    // Build request body
    const bodyObj = this.buildRequestBody(options, stream);
    const requestInit = createRequestInit(bodyObj, { stream, signal });

    // Make request
    const response = await fetch(`${apiBase}/v1/chat/completions`, requestInit);
    if (!response.ok) {
      await this.handleErrorResponse(response);
    }

    // Handle response
    if (stream) {
      return this.handleStreamingResponse(response, onToken, onEvent);
    } else {
      return this.handleNonStreamingResponse(response, onToken, onEvent);
    }
  }

  private buildRequestBody(options: ChatOptions | ChatOptionsExtended, stream: boolean): any {
    const { messages, model, providerId } = options as any;
    const extendedOptions = options as ChatOptionsExtended;

    const bodyObj: any = {
      model,
      messages,
      stream,
      ...(providerId && { provider_id: providerId }),
      ...(extendedOptions.conversationId && { conversation_id: extendedOptions.conversationId }),
      ...(extendedOptions.streamingEnabled !== undefined && { streamingEnabled: extendedOptions.streamingEnabled }),
      ...(extendedOptions.toolsEnabled !== undefined && { toolsEnabled: extendedOptions.toolsEnabled }),
      ...(extendedOptions.qualityLevel !== undefined && { qualityLevel: extendedOptions.qualityLevel }),
    };

    // Handle reasoning parameters for gpt-5* models
    if (typeof model === 'string' && model.startsWith('gpt-5') && extendedOptions.reasoning) {
      if (extendedOptions.reasoning.effort) {
        bodyObj.reasoning_effort = extendedOptions.reasoning.effort;
      }
      if (extendedOptions.reasoning.verbosity) {
        bodyObj.verbosity = extendedOptions.reasoning.verbosity;
      }
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
    } : undefined;

    // Extract content
    let content = '';
    if (json?.choices && Array.isArray(json.choices)) {
      content = json?.choices?.[0]?.message?.content ?? '';
    } else {
      content = json?.content ?? json?.message?.content ?? '';
    }

    return {
      content,
      responseId: json?.id,
      conversation
    };
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

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const events = parser.parse(chunk);

        for (const event of events) {
          if (event.type === 'done') {
            return { content, responseId, conversation };
          }

          if (event.type === 'data' && event.data) {
            const result = this.processStreamChunk(event.data, onToken, onEvent);
            if (result.content) content += result.content;
            if (result.responseId) responseId = result.responseId;
            if (result.conversation) conversation = result.conversation;
          }
        }
      }
    } finally {
      // Some polyfilled readers (in tests) may not support releaseLock
      if (typeof (reader as any).releaseLock === 'function') {
        (reader as any).releaseLock();
      }
    }

    return { content, responseId, conversation };
  }

  private processStreamChunk(
    data: any,
    onToken?: (token: string) => void,
    onEvent?: (event: any) => void
  ): { content?: string; responseId?: string; conversation?: ConversationMeta } {
    // Handle conversation metadata
    if (data._conversation) {
      return {
        conversation: {
          id: data._conversation.id,
          title: data._conversation.title,
          model: data._conversation.model,
          created_at: data._conversation.created_at,
        }
      };
    }

    // Handle Chat Completions API stream format
    const chunk = data as OpenAIStreamChunk;
    const delta = chunk.choices?.[0]?.delta;

    if (delta?.content) {
      onToken?.(delta.content);
      onEvent?.({ type: 'text', value: delta.content });
      return { content: delta.content };
    }

    if (delta?.tool_calls) {
      for (const toolCall of delta.tool_calls) {
        onEvent?.({ type: 'tool_call', value: toolCall });
      }
    }

    if (delta?.tool_output) {
      onEvent?.({ type: 'tool_output', value: delta.tool_output });
    }

    return {};
  }
}
