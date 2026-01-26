/**
 * Streaming handler module for chat and judge API responses
 */

import { SSEParser, StreamingNotSupportedError, APIError } from '../streaming';
import type { StreamChunk } from '../streamingTypes';
import type { ConversationMeta, Evaluation } from '../types';

/**
 * Check if a value is a streaming Response object
 */
export function isStreamingResponse(value: any): value is Response {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as any).headers?.get === 'function' &&
    (typeof (value as any).body !== 'undefined' || typeof (value as any).text === 'function')
  );
}

/**
 * Process non-streaming response data
 */
export function processNonStreamingData(
  json: any,
  onToken?: (token: string) => void,
  onEvent?: (event: any) => void
): {
  content: string;
  responseId?: string;
  conversation?: ConversationMeta;
  reasoning_summary?: string;
  reasoning_details?: any[];
  reasoning_tokens?: number;
  usage?: any;
} {
  // Track if we processed text events (to avoid duplication with choices[0].message.content)
  let hasTextEvents = false;

  // Check for errors in the response body
  if (json.error) {
    const errorMessage = json.error.message || json.error || JSON.stringify(json.error);

    // Check for organization verification error (streaming not supported)
    if (
      typeof errorMessage === 'string' &&
      (errorMessage.includes('Your organization must be verified to stream') ||
        errorMessage.includes('organization must be verified'))
    ) {
      throw new StreamingNotSupportedError(errorMessage);
    }

    // Throw generic API error for other error types
    const status = json.error.code === 'invalid_request_error' ? 400 : 500;
    throw new APIError(status, errorMessage, json.error);
  }

  if (json.tool_events && Array.isArray(json.tool_events)) {
    for (const event of json.tool_events) {
      if (event.type === 'text') {
        // Non-stream tool text is already merged via onEvent; calling onToken too duplicates it in the UI.
        onEvent?.({ type: 'text', value: event.value });
        hasTextEvents = true;
      } else if (event.type === 'tool_call') {
        onEvent?.({ type: 'tool_call', value: event.value });
      } else if (event.type === 'tool_output') {
        onEvent?.({ type: 'tool_output', value: event.value });
      }
    }
  }

  const conversation = json._conversation
    ? {
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
        ...(Object.hasOwn(json._conversation, 'custom_request_params_id')
          ? { custom_request_params_id: json._conversation.custom_request_params_id ?? null }
          : {}),
        ...(json._conversation.seq !== undefined ? { seq: json._conversation.seq } : {}),
        ...(json._conversation.user_message_id !== undefined
          ? { user_message_id: json._conversation.user_message_id }
          : {}),
        ...(json._conversation.assistant_message_id !== undefined
          ? { assistant_message_id: json._conversation.assistant_message_id }
          : {}),
      }
    : undefined;

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
    if (json.usage.completion_tokens !== undefined)
      usage.completion_tokens = json.usage.completion_tokens;
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
    ...(Object.keys(usage).length > 0 ? { usage } : {}),
  };
}

/**
 * Process a single stream chunk
 */
export function processStreamChunk(
  data: any,
  onToken?: (token: string) => void,
  onEvent?: (event: any) => void,
  reasoningStarted?: boolean,
  lastSentUsage?: any
): {
  content?: string;
  responseId?: string;
  conversation?: ConversationMeta;
  reasoningStarted?: boolean;
  reasoning_summary?: string;
  usage?: any;
  usageSent?: boolean;
  reasoningDetails?: any[];
  reasoningTokens?: number;
} {
  const usageFromTimings = (timings?: any): any | undefined => {
    if (!timings || typeof timings !== 'object') return undefined;

    const promptTokens =
      typeof timings.prompt_n === 'number'
        ? (timings.cache_n || 0) + timings.prompt_n
        : typeof timings.prompt_tokens === 'number'
          ? timings.prompt_tokens
          : undefined;

    const completionTokens =
      typeof timings.predicted_n === 'number'
        ? timings.predicted_n
        : typeof timings.completion_tokens === 'number'
          ? timings.completion_tokens
          : undefined;

    const totalTokens =
      typeof timings.total_tokens === 'number'
        ? timings.total_tokens
        : promptTokens !== undefined || completionTokens !== undefined
          ? (promptTokens ?? 0) + (completionTokens ?? 0)
          : undefined;

    const promptMs =
      typeof timings.prompt_ms === 'number'
        ? timings.prompt_ms
        : typeof timings.promptMs === 'number'
          ? timings.promptMs
          : undefined;

    const completionMs =
      typeof timings.predicted_ms === 'number'
        ? timings.predicted_ms
        : typeof timings.completion_ms === 'number'
          ? timings.completion_ms
          : typeof timings.completionMs === 'number'
            ? timings.completionMs
            : undefined;

    if (
      promptTokens === undefined &&
      completionTokens === undefined &&
      totalTokens === undefined &&
      promptMs === undefined &&
      completionMs === undefined
    ) {
      return undefined;
    }

    return {
      ...(promptTokens !== undefined ? { prompt_tokens: promptTokens } : {}),
      ...(completionTokens !== undefined ? { completion_tokens: completionTokens } : {}),
      ...(totalTokens !== undefined ? { total_tokens: totalTokens } : {}),
      ...(promptMs !== undefined ? { prompt_ms: promptMs } : {}),
      ...(completionMs !== undefined ? { completion_ms: completionMs } : {}),
    };
  };

  if (data._conversation) {
    const conversation = {
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
      ...(Object.hasOwn(data._conversation, 'custom_request_params_id')
        ? { custom_request_params_id: data._conversation.custom_request_params_id ?? null }
        : {}),
      ...(data._conversation.seq !== undefined ? { seq: data._conversation.seq } : {}),
      ...(data._conversation.user_message_id !== undefined
        ? { user_message_id: data._conversation.user_message_id }
        : {}),
      ...(data._conversation.assistant_message_id !== undefined
        ? { assistant_message_id: data._conversation.assistant_message_id }
        : {}),
    };
    onEvent?.({ type: 'conversation', value: conversation });
    return { conversation };
  }

  if (data.reasoning_summary) {
    return {
      reasoning_summary: data.reasoning_summary,
    };
  }

  const result: {
    content?: string;
    usage?: any;
    usageSent?: boolean;
    reasoningStarted?: boolean;
    reasoningDetails?: any[];
    reasoningTokens?: number;
  } = {};

  const timingsUsage = usageFromTimings(data.timings);
  const hasUsagePayload = data.usage || timingsUsage || data.provider || data.model;

  if (hasUsagePayload) {
    const usage: any = {};
    if (data.provider) usage.provider = data.provider;
    if (data.model) usage.model = data.model;
    if (data.usage) {
      if (data.usage.prompt_tokens !== undefined) usage.prompt_tokens = data.usage.prompt_tokens;
      if (data.usage.completion_tokens !== undefined)
        usage.completion_tokens = data.usage.completion_tokens;
      if (data.usage.total_tokens !== undefined) usage.total_tokens = data.usage.total_tokens;
      if (data.usage.reasoning_tokens !== undefined) {
        usage.reasoning_tokens = data.usage.reasoning_tokens;
        result.reasoningTokens = data.usage.reasoning_tokens;
      }
    }

    if (timingsUsage) {
      if (usage.prompt_tokens === undefined && timingsUsage.prompt_tokens !== undefined) {
        usage.prompt_tokens = timingsUsage.prompt_tokens;
      }
      if (usage.completion_tokens === undefined && timingsUsage.completion_tokens !== undefined) {
        usage.completion_tokens = timingsUsage.completion_tokens;
      }
      if (usage.total_tokens === undefined && timingsUsage.total_tokens !== undefined) {
        usage.total_tokens = timingsUsage.total_tokens;
      }
      if (timingsUsage.prompt_ms !== undefined) usage.prompt_ms = timingsUsage.prompt_ms;
      if (timingsUsage.completion_ms !== undefined)
        usage.completion_ms = timingsUsage.completion_ms;
    }

    if (Object.keys(usage).length > 0) {
      // Only fire usage event if data has actually changed
      const usageChanged =
        !lastSentUsage ||
        lastSentUsage.provider !== usage.provider ||
        lastSentUsage.model !== usage.model ||
        lastSentUsage.prompt_tokens !== usage.prompt_tokens ||
        lastSentUsage.completion_tokens !== usage.completion_tokens ||
        lastSentUsage.total_tokens !== usage.total_tokens ||
        lastSentUsage.reasoning_tokens !== usage.reasoning_tokens;

      if (usageChanged) {
        onEvent?.({ type: 'usage', value: usage });
        result.usageSent = true;
      }
      result.usage = usage;
    }
  }

  if (Array.isArray((data as any).reasoning_details)) {
    result.reasoningDetails = (data as any).reasoning_details;
  }

  if (typeof (data as any).reasoning_tokens === 'number') {
    result.reasoningTokens = (data as any).reasoning_tokens;
  }

  const chunk = data as StreamChunk;
  const delta = chunk.choices?.[0]?.delta;

  if (reasoningStarted && delta?.content) {
    const closingTag = '</thinking>';
    onToken?.(closingTag);
    onToken?.(delta.content);

    return {
      ...result,
      content: closingTag + delta.content,
      reasoningStarted: false,
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
      reasoningStarted,
    };
  }

  if (delta?.content) {
    // Check for streaming not supported error
    if (
      typeof delta.content === 'string' &&
      delta.content.includes('Your organization must be verified to stream this model')
    ) {
      throw new StreamingNotSupportedError(delta.content);
    }

    onToken?.(delta.content);
    return { ...result, content: delta.content };
  }

  if (delta?.images && Array.isArray(delta.images) && delta.images.length > 0) {
    // Emit generated images as events for the frontend to handle
    for (const img of delta.images) {
      if (img?.image_url?.url) {
        onEvent?.({ type: 'generated_image', value: img });
      }
    }
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
      reasoningStarted,
    };
  }

  if (delta?.tool_output) {
    onEvent?.({ type: 'tool_output', value: delta.tool_output });
  }

  return result;
}

/**
 * Handle streaming chat response
 */
export async function handleStreamingResponse(
  response: Response,
  onToken?: (token: string) => void,
  onEvent?: (event: any) => void
): Promise<{
  content: string;
  responseId?: string;
  conversation?: ConversationMeta;
  reasoning_summary?: string;
  reasoning_details?: any[];
  reasoning_tokens?: number;
  usage?: any;
}> {
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
  let lastSentUsage: any | undefined; // Track last sent usage to prevent duplicate events

  const finalizeResponse = () => ({
    content,
    responseId,
    conversation,
    reasoning_summary,
    ...(reasoning_details ? { reasoning_details } : {}),
    ...(reasoning_tokens !== undefined ? { reasoning_tokens } : {}),
    ...(usage ? { usage } : {}),
  });

  const processChunk = (chunk: string) => {
    const events = parser.parse(chunk);

    for (const event of events) {
      if (event.type === 'done') {
        if (reasoningStarted) {
          const closingTag = '</thinking>';
          onToken?.(closingTag);
          content += closingTag;
          reasoningStarted = false;
        }

        return finalizeResponse();
      }

      if (event.type === 'data' && event.data) {
        const result = processStreamChunk(
          event.data,
          onToken,
          onEvent,
          reasoningStarted,
          lastSentUsage
        );
        if (result.content) content += result.content;
        if (result.responseId) responseId = result.responseId;
        if (result.conversation) conversation = result.conversation;
        if (result.reasoningStarted !== undefined) reasoningStarted = result.reasoningStarted;
        if (result.reasoning_summary) reasoning_summary = result.reasoning_summary;
        if (result.usage) {
          usage = { ...usage, ...result.usage };
          // Update lastSentUsage if we actually sent a usage event
          if (result.usageSent) lastSentUsage = usage;
        }
        if (result.reasoningDetails) reasoning_details = result.reasoningDetails;
        if (result.reasoningTokens !== undefined) reasoning_tokens = result.reasoningTokens;
      }
    }

    return undefined;
  };

  const body: any = response.body;
  const readBodyAsText = async (): Promise<string> => {
    const responseAny = response as any;

    if (typeof responseAny.text === 'function') {
      return responseAny.text();
    }

    const streamDecoderFactory = () => new TextDecoder('utf-8');
    const normalizeChunk = (chunk: any, decoder: TextDecoder): string => {
      if (typeof chunk === 'string') {
        return chunk;
      }
      if (chunk instanceof Uint8Array) {
        return decoder.decode(chunk, { stream: true });
      }
      if (chunk instanceof ArrayBuffer) {
        return decoder.decode(new Uint8Array(chunk), { stream: true });
      }
      if (typeof Buffer !== 'undefined' && Buffer.isBuffer?.(chunk)) {
        return decoder.decode(chunk, { stream: true });
      }
      if (ArrayBuffer.isView?.(chunk)) {
        const view = chunk as ArrayBufferView;
        return decoder.decode(new Uint8Array(view.buffer, view.byteOffset, view.byteLength), {
          stream: true,
        });
      }
      if (chunk?.type === 'Buffer' && Array.isArray(chunk?.data)) {
        return decoder.decode(Uint8Array.from(chunk.data), { stream: true });
      }
      return '';
    };

    const tryCollectFromAsyncIterable = async (iterable: any): Promise<string> => {
      const streamDecoder = streamDecoderFactory();
      let textContent = '';
      for await (const chunk of iterable as any) {
        textContent += normalizeChunk(chunk, streamDecoder);
      }
      textContent += streamDecoder.decode();
      return textContent;
    };

    const streamCandidate = body ?? responseAny.body;

    if (streamCandidate && typeof streamCandidate[Symbol.asyncIterator] === 'function') {
      return tryCollectFromAsyncIterable(streamCandidate);
    }

    if (typeof responseAny[Symbol.asyncIterator] === 'function') {
      return tryCollectFromAsyncIterable(responseAny);
    }

    if (streamCandidate && typeof streamCandidate.on === 'function') {
      return await new Promise<string>((resolve, reject) => {
        const streamDecoder = streamDecoderFactory();
        let textContent = '';

        const handleData = (chunk: any) => {
          textContent += normalizeChunk(chunk, streamDecoder);
        };
        const handleEnd = () => {
          textContent += streamDecoder.decode();
          cleanup();
          resolve(textContent);
        };
        const handleError = (error: Error) => {
          cleanup();
          reject(error);
        };
        const cleanup = () => {
          streamCandidate.off?.('data', handleData);
          streamCandidate.off?.('end', handleEnd);
          streamCandidate.off?.('error', handleError);
          streamCandidate.removeListener?.('data', handleData);
          streamCandidate.removeListener?.('end', handleEnd);
          streamCandidate.removeListener?.('error', handleError);
        };

        streamCandidate.on('data', handleData);
        streamCandidate.on('end', handleEnd);
        streamCandidate.on('error', handleError);
      });
    }

    throw new Error('No response body');
  };

  if (body && typeof body.getReader === 'function') {
    const reader = body.getReader();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;

        const chunk = decoder.decode(value, { stream: true });
        const finalResponse = processChunk(chunk);
        if (finalResponse) {
          return finalResponse;
        }
      }
    } finally {
      if (typeof reader.releaseLock === 'function') {
        reader.releaseLock();
      }
    }
  } else {
    // Fallback for environments (e.g. Node tests) where the response body isn't a web ReadableStream
    const text = await readBodyAsText();
    const finalResponse = processChunk(text);
    if (finalResponse) {
      return finalResponse;
    }
  }

  return finalizeResponse();
}

/**
 * Handle streaming judge response
 */
export async function handleJudgeStreamingResponse(
  response: Response,
  onToken?: (token: string) => void,
  onEvaluation?: (evaluation: Evaluation) => void
): Promise<Evaluation> {
  const decoder = new TextDecoder('utf-8');
  const parser = new SSEParser();

  let content = '';
  let evaluation: Evaluation | null = null;

  const finalize = (): Evaluation => {
    if (evaluation) return evaluation;
    // Fallback if evaluation wasn't sent explicitly
    try {
      const parsed = content ? JSON.parse(content) : null;
      const scores =
        parsed && typeof parsed === 'object' && typeof parsed.scores === 'object'
          ? parsed.scores
          : null;
      const inferredModels = scores
        ? Object.entries(scores).map(([modelId, score]) => ({
            model_id: modelId,
            conversation_id: 'unknown',
            message_id: 'unknown',
            score: Number.isFinite(Number(score)) ? Number(score) : null,
          }))
        : [];
      return {
        id: 'unknown',
        user_id: 'unknown',
        conversation_id: 'unknown',
        model_a_conversation_id: 'unknown',
        model_a_message_id: 'unknown',
        model_b_conversation_id: 'unknown',
        model_b_message_id: 'unknown',
        judge_model_id: 'unknown',
        criteria: null,
        score_a: Number.isFinite(Number(parsed?.score_a)) ? Number(parsed?.score_a) : null,
        score_b: Number.isFinite(Number(parsed?.score_b)) ? Number(parsed?.score_b) : null,
        winner: typeof parsed?.winner === 'string' ? parsed.winner : 'tie',
        reasoning: typeof parsed?.reasoning === 'string' ? parsed.reasoning : content,
        created_at: new Date().toISOString(),
        models: inferredModels.length > 0 ? inferredModels : undefined,
      };
    } catch {
      return {
        id: 'unknown',
        user_id: 'unknown',
        conversation_id: 'unknown',
        model_a_conversation_id: 'unknown',
        model_a_message_id: 'unknown',
        model_b_conversation_id: 'unknown',
        model_b_message_id: 'unknown',
        judge_model_id: 'unknown',
        criteria: null,
        score_a: null,
        score_b: null,
        winner: 'tie',
        reasoning: content,
        created_at: new Date().toISOString(),
      };
    }
  };

  const body: any = response.body;
  const processChunk = (chunk: string): Evaluation | null => {
    const events = parser.parse(chunk);
    for (const event of events) {
      if (event.type === 'done') {
        return finalize();
      }

      if (event.type === 'data' && event.data) {
        if (event.data.type === 'evaluation' && event.data.evaluation) {
          evaluation = event.data.evaluation as Evaluation;
          onEvaluation?.(evaluation);
          continue;
        }

        const delta = event.data?.choices?.[0]?.delta;
        if (delta?.content) {
          content += delta.content;
          onToken?.(delta.content);
        }
      }
    }

    return null;
  };

  if (body && typeof body.getReader === 'function') {
    const reader = body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      const maybeEvaluation = processChunk(text);
      if (maybeEvaluation) return maybeEvaluation;
    }
    return finalize();
  }

  if (body && typeof body[Symbol.asyncIterator] === 'function') {
    for await (const chunk of body as any) {
      const text = typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
      const maybeEvaluation = processChunk(text);
      if (maybeEvaluation) return maybeEvaluation;
    }
    return finalize();
  }

  const text = await response.text();
  const maybeEvaluation = processChunk(text);
  return maybeEvaluation || finalize();
}
