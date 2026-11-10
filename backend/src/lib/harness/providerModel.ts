/**
 * ChatForge providers behind the harness `Model` contract.
 *
 * Every ChatForge provider already takes a Chat Completions request and, for
 * streaming, yields Chat Completions chunks (after its adapter's translation).
 * So one shared streaming core does the `Item` <-> Chat Completions work and
 * maps chunks to `ModelEvent`s; the per-provider subclasses in `models.ts`
 * only add what differs (prompt-cache breakpoints, continuation support).
 *
 * Transport is today's: `createOpenAIRequest` with the provider instance, so
 * HTTP retries, upstream logging and stream translation are unchanged.
 */
import { createOpenAIRequest } from '../streamUtils.js';
import { parseSSEStream } from '../sseParser.js';
import { extractUsage } from '../utils/usage.js';
import { extractUpstreamMessage, readUpstreamErrorBody } from '../upstreamErrors.js';
import { logger } from '../../logger.js';
import { itemsToChatMessages, newItemId, toolSpecsToChatTools } from './chatMessages.ts';
import type { ChatMessage, ChatToolCall } from './chatMessages.ts';
import {
  DEFAULT_ASSUMED_CONTEXT_WINDOW,
  ModelFailure,
} from '@qduc/agent-core';
import type {
  ContentPart,
  Item,
  Model,
  ModelCapabilities,
  ModelError,
  ModelEvent,
  ModelRef,
  ModelRequest,
  StopReason,
  ToolCallId,
} from '@qduc/agent-core';

/** The slice of a ChatForge provider instance the wrapper uses. */
export type ChatForgeProvider = {
  readonly providerId?: string | null;
  readonly settings?: { readonly providerType?: string; readonly baseUrl?: string };
  needsStreamingTranslation?(): boolean;
  translateStreamChunk(chunk: unknown, context?: unknown): unknown;
  supportsPromptCaching?(model?: string): boolean;
  shouldUseResponsesAPI?(): boolean;
};

/** The slice of ChatForge's runtime config the transport reads. */
export type ChatForgeRuntimeConfig = {
  readonly providerConfig?: { readonly streamTimeoutMs?: number };
  readonly [key: string]: unknown;
};

export type ChatCompletionsBody = {
  model: string;
  messages: ChatMessage[];
  stream: true;
  tools?: ReturnType<typeof toolSpecsToChatTools>;
  tool_choice?: unknown;
  previous_response_id?: string;
  reasoning_effort?: string;
  max_tokens?: number;
  temperature?: number;
  [key: string]: unknown;
};

export type ProviderModelOptions = {
  readonly provider: ChatForgeProvider;
  /** Upstream model id, e.g. `claude-sonnet-4-5`. */
  readonly model: string;
  readonly config: ChatForgeRuntimeConfig;
  /** `ModelRef.provider`; defaults to the provider id. */
  readonly providerName?: string;
  readonly contextWindow?: number;
  /** No chunk for this long fails the request. Defaults to `config.providerConfig.streamTimeoutMs`. */
  readonly idleTimeoutMs?: number;
  /** For prompt-caching logs only. */
  readonly userId?: string | null;
};

const DEFAULT_IDLE_TIMEOUT_MS = 300_000;

/** Same limit and text as the legacy loop (toolsStreaming.js). */
const INCOMPLETE_REASONING_RETRY_LIMIT = 2;
export const INCOMPLETE_REASONING_WARNING =
  '[Warning: Model returned an incomplete reasoning response (no tool call and no completion). Proceeding after retries.]';

const FINISH_TO_STOP: Record<string, StopReason> = {
  stop: 'end_turn',
  end_turn: 'end_turn',
  tool_calls: 'tool_use',
  function_call: 'tool_use',
  length: 'max_tokens',
  max_tokens: 'max_tokens',
  content_filter: 'refusal',
  refusal: 'refusal',
};

export class ProviderModel implements Model {
  readonly ref: ModelRef;
  readonly contextWindow: number;
  readonly capabilities: ModelCapabilities;
  protected readonly provider: ChatForgeProvider;
  protected readonly config: ChatForgeRuntimeConfig;
  protected readonly idleTimeoutMs: number;
  protected readonly userId: string | null;

  constructor(options: ProviderModelOptions) {
    this.provider = options.provider;
    this.config = options.config;
    this.ref = {
      provider: options.providerName ?? options.provider.providerId ?? options.provider.settings?.providerType ?? 'provider',
      model: options.model,
    };
    this.contextWindow = options.contextWindow ?? DEFAULT_ASSUMED_CONTEXT_WINDOW;
    this.idleTimeoutMs =
      options.idleTimeoutMs ?? options.config.providerConfig?.streamTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    this.userId = options.userId ?? null;
    this.capabilities = { continuity: this.supportsContinuation(), standardServiceTier: false, httpTransportDowngrade: false };
  }

  /** Whether `previous_response_id` continuation reaches the provider. */
  protected supportsContinuation(): boolean {
    return false;
  }

  /** Hook for provider-specific request shaping (prompt caching). */
  protected async finalizeBody(body: ChatCompletionsBody, _request: ModelRequest): Promise<ChatCompletionsBody> {
    return body;
  }

  /** Build the Chat Completions request ChatForge's adapters take as input. */
  async buildRequestBody(request: ModelRequest): Promise<ChatCompletionsBody> {
    if (request.useStandardServiceTier) {
      throw new ModelFailure({
        kind: 'invalid_request',
        message: 'ChatForge providers do not support the standard service tier flag',
        retryable: false,
      });
    }

    const body: ChatCompletionsBody = {
      // Provider options first: the request's own fields win.
      ...(request.providerOptions ?? {}),
      model: request.model.model,
      messages: itemsToChatMessages(request.input, request.instructions),
      stream: true,
    };
    if (request.tools.length > 0) {
      body.tools = toolSpecsToChatTools(request.tools);
      body.tool_choice ??= 'auto';
    }
    if (request.reasoning) body.reasoning_effort = request.reasoning;
    if (request.maxOutputTokens !== undefined) body.max_tokens = request.maxOutputTokens;
    if (request.temperature !== undefined) body.temperature = request.temperature;

    const previousResponseId = this.continuationFor(request);
    if (previousResponseId) body.previous_response_id = previousResponseId;
    else delete body.previous_response_id;

    return this.finalizeBody(body, request);
  }

  protected continuationFor(request: ModelRequest): string | undefined {
    if (request.disableChaining || !this.supportsContinuation()) return undefined;
    if (typeof request.previousResponseId === 'string' && request.previousResponseId) return request.previousResponseId;
    if (typeof request.continuation === 'string' && request.continuation) return request.continuation;
    return undefined;
  }

  async *stream(request: ModelRequest, signal: AbortSignal, onDispatched?: () => void): AsyncGenerator<ModelEvent> {
    const body = await this.buildRequestBody(request);
    // A reasoning-only response (no answer, no tool call) is asked again, as the
    // legacy loop did. This stays inside the wrapper because the engine will not
    // replay a request once its reasoning has streamed to the user.
    for (let retries = 0; ; retries++) {
      const accumulator = yield* this.attempt(body, signal, retries === 0 ? onDispatched : undefined);
      if (!accumulator.isReasoningOnly()) {
        yield* accumulator.finish();
        return;
      }
      if (retries < INCOMPLETE_REASONING_RETRY_LIMIT) {
        logger.warn({ msg: 'invalid_reasoning_response_retrying', retryAttempt: retries + 1, maxRetries: INCOMPLETE_REASONING_RETRY_LIMIT });
        continue;
      }
      logger.warn({ msg: 'invalid_reasoning_response_retry_exhausted', retries });
      yield* accumulator.appendText(INCOMPLETE_REASONING_WARNING);
      yield* accumulator.finish();
      return;
    }
  }

  /** One upstream request, read to the end. The caller decides whether to finish it. */
  private async *attempt(
    body: ChatCompletionsBody,
    signal: AbortSignal,
    onDispatched?: () => void,
  ): AsyncGenerator<ModelEvent, ChunkAccumulator> {
    let upstream = yield* this.send(body, signal, onDispatched);

    if (!upstream.ok && body.previous_response_id) {
      const errorBody = await readUpstreamErrorBody(upstream);
      if (isRejectedContinuation(upstream.status, errorBody)) {
        // The provider no longer holds that response. Full history is already
        // in the request (the adapter trims it only when continuing), so retry
        // self-contained.
        const { previous_response_id: _dropped, ...selfContained } = body;
        upstream = yield* this.send(selfContained as ChatCompletionsBody, signal);
      } else {
        throw upstreamFailure(upstream.status, errorBody);
      }
    }

    if (!upstream.ok) throw upstreamFailure(upstream.status, await readUpstreamErrorBody(upstream));

    const accumulator = new ChunkAccumulator(this.provider);
    const contentType = String(upstream.headers?.get?.('content-type') ?? '');
    const isStream =
      contentType.includes('text/event-stream') ||
      contentType.includes('text/plain') ||
      typeof (upstream.body as { on?: unknown } | null)?.on === 'function';

    if (!isStream) {
      // Upstream answered with one JSON response; replay it as a single chunk.
      const json = (await upstream.json()) as Record<string, unknown>;
      yield* accumulator.push(jsonResponseAsChunk(json), { translate: false });
    } else {
      yield* this.readStream(upstream.body, accumulator, signal);
    }
    return accumulator;
  }

  /** Dispatch through ChatForge's transport, surfacing its HTTP retries as `retrying` events. */
  private async *send(
    body: ChatCompletionsBody,
    signal: AbortSignal,
    onDispatched?: () => void,
  ): AsyncGenerator<ModelEvent, UpstreamResponse> {
    if (signal.aborted) throw cancelled(signal.reason);

    const retries: ModelEvent[] = [];
    let wake: (() => void) | null = null;
    const onRetry = (info: RetryInfo = {}) => {
      retries.push({
        type: 'retrying',
        attempt: info.attempt ?? retries.length + 1,
        delayMs: info.retryAfterMs ?? 0,
        error: {
          kind: errorKindForStatus(info.status ?? undefined),
          message: info.errorMessage || `Upstream returned ${info.status ?? 'an error'}`,
          retryable: true,
          ...(info.retryAfterMs != null ? { retryAfterMs: info.retryAfterMs } : {}),
        },
      });
      wake?.();
    };

    onDispatched?.();
    let settled = false;
    const pending = (createOpenAIRequest(this.config, body, {
      provider: this.provider,
      providerId: this.provider.providerId ?? undefined,
      signal,
      onRetry,
    }) as Promise<UpstreamResponse>).finally(() => {
      settled = true;
      wake?.();
    });
    pending.catch(() => {});

    while (!settled || retries.length > 0) {
      const next = retries.shift();
      if (next) {
        yield next;
        continue;
      }
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
      wake = null;
    }

    try {
      return await pending;
    } catch (error) {
      throw toModelFailure(error, signal);
    }
  }

  private async *readStream(
    body: unknown,
    accumulator: ChunkAccumulator,
    signal: AbortSignal,
  ): AsyncGenerator<ModelEvent> {
    const iterator = (body as AsyncIterable<unknown>)[Symbol.asyncIterator]();
    let leftover = '';
    let finished = false;
    try {
      while (!finished) {
        const next = await nextWithin(iterator, this.idleTimeoutMs, signal);
        if (next.done) break;
        const objects: unknown[] = [];
        leftover = parseSSEStream(
          next.value as string | Buffer,
          leftover,
          (obj: unknown) => objects.push(obj),
          () => {
            finished = true;
          },
          () => {
            /* malformed frames are ignored, as in the legacy loop */
          },
        );
        for (const obj of objects) yield* accumulator.push(obj);
      }
    } catch (error) {
      throw toModelFailure(error, signal);
    } finally {
      if (finished || signal.aborted) void iterator.return?.();
    }
  }
}

// ---------- chunk -> event mapping ----------

type ChunkDelta = {
  content?: unknown;
  reasoning_content?: unknown;
  reasoning?: unknown;
  reasoning_details?: unknown;
  tool_calls?: Array<{
    index?: number;
    id?: string;
    function?: { name?: string; arguments?: string };
    gemini_thought_signature?: string;
  }>;
  images?: Array<{ image_url?: { url?: string } }>;
};

type ChunkChoice = { delta?: ChunkDelta; message?: ChunkDelta; finish_reason?: string | null };

type ReasoningDetail = { index?: number; type?: string; text?: string; [key: string]: unknown };

/** Accumulates one model response and turns it into `ModelEvent`s. */
export class ChunkAccumulator {
  private readonly provider: ChatForgeProvider;
  private responseId: string | null = null;
  private text = '';
  private reasoningText = '';
  private reasoningDetails: ReasoningDetail[] = [];
  private readonly images: string[] = [];
  private readonly toolCalls = new Map<number, ChatToolCall>();
  private finishReason: string | null = null;
  private usage: Record<string, unknown> | undefined;
  private model: string | undefined;
  private upstreamProvider: string | undefined;

  constructor(provider: ChatForgeProvider) {
    this.provider = provider;
  }

  *push(raw: unknown, { translate = true }: { translate?: boolean } = {}): Generator<ModelEvent> {
    const obj = translate ? this.translate(raw) : (raw as Record<string, unknown> | null);
    if (!obj || typeof obj !== 'object') return;

    if (!this.responseId && typeof obj.id === 'string' && obj.id) this.responseId = obj.id;
    if (typeof obj.model === 'string') this.model = obj.model;
    if (typeof obj.provider === 'string') this.upstreamProvider = obj.provider;
    const usage = extractUsage(obj) as Record<string, unknown> | undefined;
    if (usage) this.usage = { ...this.usage, ...usage };

    const choice = (obj.choices as ChunkChoice[] | undefined)?.[0];
    if (!choice) return;
    const delta = choice.delta ?? {};
    const message = choice.message;

    if (Array.isArray(delta.reasoning_details) && delta.reasoning_details.length > 0) {
      this.mergeReasoningDetails(delta.reasoning_details as ReasoningDetail[]);
    }
    if (Array.isArray(message?.reasoning_details)) {
      this.reasoningDetails = [...(message.reasoning_details as ReasoningDetail[])];
    }

    const reasoning = delta.reasoning_content ?? delta.reasoning;
    if (typeof reasoning === 'string' && reasoning.length > 0) {
      this.reasoningText += reasoning;
      yield { type: 'reasoning_delta', delta: reasoning };
    }

    for (const tcDelta of delta.tool_calls ?? []) {
      const index = tcDelta.index ?? 0;
      const existing = this.toolCalls.get(index) ?? {
        id: tcDelta.id ?? '',
        type: 'function' as const,
        function: { name: '', arguments: '' },
      };
      if (tcDelta.id && !existing.id) existing.id = tcDelta.id;
      if (tcDelta.function?.name) existing.function.name = tcDelta.function.name;
      if (tcDelta.function?.arguments) existing.function.arguments += tcDelta.function.arguments;
      if (tcDelta.gemini_thought_signature) existing.gemini_thought_signature = tcDelta.gemini_thought_signature;
      this.toolCalls.set(index, existing);
      yield {
        type: 'tool_call_streaming_delta',
        argumentCharCount: existing.function.arguments.length,
        callIndex: index,
        ...(existing.function.name ? { toolName: existing.function.name } : {}),
        ...(existing.id ? { callId: existing.id as ToolCallId } : {}),
      };
    }

    if (typeof delta.content === 'string' && delta.content.length > 0) {
      this.text += delta.content;
      yield { type: 'text_delta', delta: delta.content };
    }

    for (const image of delta.images ?? []) {
      const url = image?.image_url?.url;
      if (url && !this.images.includes(url)) this.images.push(url);
    }

    if (choice.finish_reason) this.finishReason = choice.finish_reason;
  }

  /** Reasoning arrived, but no answer, image or tool call. */
  isReasoningOnly(): boolean {
    const hasReasoning = this.reasoningText.trim().length > 0 || this.reasoningDetails.length > 0;
    return hasReasoning && this.toolCalls.size === 0 && !this.text.trim() && this.images.length === 0;
  }

  /** Text the wrapper adds itself (the incomplete-reasoning warning), streamed like model text. */
  *appendText(text: string): Generator<ModelEvent> {
    this.text += text;
    yield { type: 'text_delta', delta: text };
  }

  /** Completed items, usage, then `done`, in that order. */
  *finish(): Generator<ModelEvent> {
    const toolCalls = [...this.toolCalls.entries()].sort(([a], [b]) => a - b).map(([, call]) => call);


    if (this.reasoningText || this.reasoningDetails.length > 0) {
      yield {
        type: 'item',
        item: {
          type: 'reasoning',
          id: newItemId(),
          summary: this.reasoningText,
          ...(this.reasoningDetails.length > 0
            ? { providerMetadata: { reasoning_details: this.reasoningDetails } }
            : {}),
        },
      };
    }

    const content: ContentPart[] = [];
    if (this.text) content.push({ type: 'text', text: this.text });
    for (const url of this.images) content.push({ type: 'image', mediaType: imageMediaType(url), data: url });
    if (content.length > 0) {
      yield { type: 'item', item: { type: 'assistant_message', id: newItemId(), content } };
    }

    for (const call of toolCalls) {
      const rawArguments = call.function.arguments || '{}';
      const item: Item = {
        type: 'tool_call',
        id: newItemId(),
        callId: (call.id || `call_${newItemId()}`) as ToolCallId,
        toolName: call.function.name,
        input: parseJsonOr(rawArguments),
        rawArguments,
        ...(call.gemini_thought_signature
          ? { providerMetadata: { gemini_thought_signature: call.gemini_thought_signature } }
          : {}),
      };
      yield { type: 'item', item };
    }

    if (this.usage) {
      const usage = this.usage as Record<string, number | undefined>;
      yield {
        type: 'usage',
        usage: {
          inputTokens: usage.prompt_tokens ?? 0,
          outputTokens: usage.completion_tokens ?? 0,
          cachedInputTokens: usage.cache_read_input_tokens ?? 0,
          ...(this.upstreamProvider ? { upstreamProvider: this.upstreamProvider } : {}),
        },
      };
    }

    const stopReason: StopReason =
      toolCalls.length > 0 ? 'tool_use' : FINISH_TO_STOP[this.finishReason ?? 'stop'] ?? 'end_turn';
    yield {
      type: 'done',
      stopReason,
      ...(this.responseId ? { continuation: this.responseId } : {}),
      providerMetadata: {
        // ChatForge-native details the portable events don't carry; the
        // turn-event sink persists and streams them (see event mapping doc).
        chatforge: {
          finishReason: this.finishReason ?? (toolCalls.length > 0 ? 'tool_calls' : 'stop'),
          responseId: this.responseId,
          usage: this.usage ?? null,
          model: this.model ?? null,
          provider: this.upstreamProvider ?? null,
        },
      },
    };
  }

  private translate(raw: unknown): Record<string, unknown> | null {
    if (!this.provider.needsStreamingTranslation?.()) return raw as Record<string, unknown>;
    try {
      const translated = this.provider.translateStreamChunk(raw);
      if (!translated || translated === '[DONE]') return null;
      return translated as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  private mergeReasoningDetails(incoming: ReasoningDetail[]): void {
    for (const detail of incoming) {
      const existingIndex = this.reasoningDetails.findIndex(
        (existing) => existing.index === detail.index && existing.type === detail.type,
      );
      if (existingIndex === -1) {
        this.reasoningDetails.push(detail);
      } else if (detail.type === 'reasoning.text') {
        const existing = this.reasoningDetails[existingIndex]!;
        this.reasoningDetails[existingIndex] = {
          ...existing,
          ...detail,
          text: (existing.text || '') + (detail.text || ''),
        };
      } else {
        this.reasoningDetails[existingIndex] = detail;
      }
    }
  }
}

// ---------- helpers ----------

type UpstreamResponse = {
  ok: boolean;
  status: number;
  headers?: { get?(name: string): string | null };
  body: unknown;
  json(): Promise<unknown>;
};

type RetryInfo = {
  status?: number | null;
  attempt?: number | null;
  retryAfterMs?: number | null;
  errorMessage?: string | null;
};

function jsonResponseAsChunk(json: Record<string, unknown>): Record<string, unknown> {
  const choice = (json.choices as Array<{ message?: Record<string, unknown>; finish_reason?: string }> | undefined)?.[0];
  if (!choice?.message) return json;
  const message = choice.message;
  const toolCalls = Array.isArray(message.tool_calls)
    ? (message.tool_calls as Array<Record<string, unknown>>).map((call, index) => ({ ...call, index: call.index ?? index }))
    : undefined;
  return {
    ...json,
    choices: [
      {
        delta: {
          ...(typeof message.content === 'string' ? { content: message.content } : {}),
          ...(message.reasoning_content !== undefined ? { reasoning_content: message.reasoning_content } : {}),
          ...(message.reasoning !== undefined ? { reasoning: message.reasoning } : {}),
          ...(toolCalls ? { tool_calls: toolCalls } : {}),
          ...(Array.isArray(message.images) ? { images: message.images } : {}),
        },
        message: Array.isArray(message.reasoning_details) ? { reasoning_details: message.reasoning_details } : undefined,
        finish_reason: choice.finish_reason ?? null,
      },
    ],
  };
}

function parseJsonOr(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function imageMediaType(url: string): string {
  return /^data:([^;,]+)[;,]/.exec(url)?.[1] ?? 'image/*';
}

function isRejectedContinuation(status: number, body: unknown): boolean {
  const error = (body as { error?: { param?: string; code?: string } } | undefined)?.error;
  return status === 400 && error?.param === 'previous_response_id' && error?.code === 'invalid_value';
}

function errorKindForStatus(status: number | undefined): ModelError['kind'] {
  if (status === 401 || status === 403) return 'authentication';
  if (status === 429) return 'rate_limit';
  if (status !== undefined && status >= 500) return 'provider';
  if (status !== undefined && status >= 400) return 'invalid_request';
  return 'network';
}

const CONTEXT_OVERFLOW = /context(_| )length|context window|too many tokens|maximum context|prompt is too long/i;

export function upstreamFailure(status: number, body: unknown): ModelFailure {
  const detail = extractUpstreamMessage(body) || JSON.stringify(body);
  const message = `Upstream API error (${status}): ${detail}`;
  let kind = errorKindForStatus(status);
  if (kind === 'invalid_request' && CONTEXT_OVERFLOW.test(detail)) kind = 'context_overflow';
  return new ModelFailure(
    { kind, message, retryable: kind === 'rate_limit' || kind === 'provider' },
    body,
    'model_behavior',
  );
}

function cancelled(reason: unknown): ModelFailure {
  return new ModelFailure({ kind: 'cancelled', message: 'Request cancelled', retryable: false }, reason);
}

function toModelFailure(error: unknown, signal: AbortSignal): ModelFailure {
  if (error instanceof ModelFailure) return error;
  if (signal.aborted || (error as { name?: string } | null)?.name === 'AbortError') return cancelled(error);
  // Duck-typed: errors from Node internals can come from another realm (e.g. under Jest).
  const errorMessage = (error as { message?: unknown } | null)?.message;
  const message = typeof errorMessage === 'string' ? errorMessage : String(error);
  const isTransport = (error as { name?: string } | null)?.name === 'ProviderTransportError';
  return new ModelFailure(
    { kind: isTransport ? 'network' : 'provider', message, retryable: true },
    error,
    isTransport ? 'request_unsent' : 'connection_interrupted',
  );
}

class IdleTimeout extends Error {
  constructor() {
    super('Stream timeout - no response from upstream API');
    this.name = 'IdleTimeout';
  }
}

/** `iterator.next()` that fails after `ms` of silence or on abort. */
async function nextWithin<T>(
  iterator: AsyncIterator<T>,
  ms: number,
  signal: AbortSignal,
): Promise<IteratorResult<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  try {
    return await Promise.race([
      iterator.next(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new IdleTimeout()), ms);
        onAbort = () => reject(cancelled(signal.reason));
        if (signal.aborted) onAbort();
        else signal.addEventListener('abort', onAbort, { once: true });
      }),
    ]);
  } finally {
    clearTimeout(timer);
    if (onAbort) signal.removeEventListener('abort', onAbort);
  }
}
