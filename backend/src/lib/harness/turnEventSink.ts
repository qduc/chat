/**
 * Lands harness `TurnEvent`s in ChatForge's existing SSE stream and
 * persistence, the way `handleToolsStreaming` writes them today.
 *
 * The host loop (issue #40, Part B) does, for every accepted turn event:
 *     sink.handle(event);  // stream + checkpoint first
 *     handle.accept(token); // then let the turn advance
 *
 * The full mapping, and why each choice was made, is in
 * docs/agent-harness-event-mapping.md.
 */
import { createChatCompletionChunk, writeAndFlush, writeSseEvent } from '../streamUtils.js';
import {
  appendToPersistence,
  emitConversationMetadata,
  recordFinalToPersistence,
  streamDeltaEvent,
  streamDone,
} from '../toolOrchestrationUtils.js';
import type { Item, ModelError, TurnEvent, TurnResult } from './contracts.ts';

export const MAX_ITERATIONS_NOTICE = '\n\n[Maximum iterations reached]';

/** The slice of `SimplifiedPersistence` the sink drives. All optional, as in the legacy loop. */
export type SinkPersistence = {
  readonly persist?: boolean;
  appendContent?(delta: string): void;
  truncateContent?(length: number): void;
  getContentLength?(): number;
  appendReasoningText?(delta: string): void;
  setReasoningDetails?(details: unknown[]): void;
  setReasoningTokens?(tokens: number): void;
  setUsage?(usage: Record<string, unknown>): void;
  setResponseId?(responseId: string): void;
  addToolCalls?(calls: unknown[]): void;
  addToolOutputs?(outputs: unknown[]): void;
  addMessageEvent?(type: string, payload: unknown): void;
  recordAssistantFinal?(final: { finishReason?: string; responseId?: string | null }): void;
  markError?(): void;
};

export type SinkResponse = {
  readonly writableEnded: boolean;
  write(chunk: string): unknown;
  end(): unknown;
  flush?(): void;
};

export type TurnEventSinkOptions = {
  readonly res: SinkResponse;
  readonly persistence?: SinkPersistence | null;
  /** Model id shown on synthesized chunks. */
  readonly model: string;
  /** Chunk id, as the legacy loop's `bodyIn.id || 'chatcmpl-' + Date.now()`. */
  readonly completionId?: string;
  readonly providerId?: string | null;
};

type ChatForgeResponseMetadata = {
  finishReason?: string;
  responseId?: string | null;
  usage?: Record<string, unknown> | null;
  model?: string | null;
  provider?: string | null;
};

type PendingToolCall = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
  index: number;
  textOffset?: number;
  gemini_thought_signature?: string;
};

export class TurnEventSink {
  private readonly res: SinkResponse;
  private readonly persistence: SinkPersistence | null;
  private readonly model: string;
  private readonly completionId: string;
  private readonly providerId: string | null;

  private pendingToolCalls: PendingToolCall[] = [];
  /** First-seen text offset per streamed tool call, keyed `${step}:${index}`. */
  private readonly toolCallOffsets = new Map<string, number>();
  private readonly toolNames = new Map<string, string>();
  /** Persistence content length when each model step's text began. */
  private readonly stepTextStart = new Map<number, number>();
  private lastFinishReason: string | null = null;
  private ended = false;

  constructor(options: TurnEventSinkOptions) {
    this.res = options.res;
    this.persistence = options.persistence ?? null;
    this.model = options.model;
    this.completionId = options.completionId ?? `chatcmpl-${Date.now()}`;
    this.providerId = options.providerId ?? null;
  }

  get isEnded(): boolean {
    return this.ended;
  }

  handle(event: TurnEvent): void {
    if (this.ended) return;
    // Tool calls from one model response go out together, as one chunk, once
    // the response is over: on anything that isn't another tool call item.
    if (!(event.type === 'item' && event.item.type === 'tool_call')) this.flushToolCalls();

    switch (event.type) {
      case 'text_delta':
        return this.onTextDelta(event);
      case 'reasoning_delta':
        this.chunk({ reasoning_content: event.delta });
        this.persistence?.appendReasoningText?.(event.delta);
        return;
      case 'tool_call_streaming_delta':
        return this.onToolCallProgress(event);
      case 'item':
        return this.onItem(event.item, event.modelStep);
      case 'model_response_completed':
        return this.onResponseCompleted(event.providerMetadata, event.continuation);
      case 'usage':
        // Portable usage loses ChatForge's fields (reasoning tokens, timings);
        // `model_response_completed` carries the full set. Fallback only.
        return;
      case 'retrying':
        return this.retryStatus({ attempt: event.attempt, maxRetries: event.maxRetries, delayMs: event.delayMs, error: event.error });
      case 'model_retrying':
        return this.retryStatus({ attempt: event.attempt, maxRetries: event.maxRetries, delayMs: event.delayMs });
      case 'tool_called':
      case 'tool_start_requested':
        this.toolNames.set(event.callId, event.toolName);
        return;
      case 'tool_progress':
      case 'tool_execution_finished':
        // ChatForge tools report no progress; results land via the tool_result item.
        return;
      case 'turn_ended':
        return this.onTurnEnded(event.result);
    }
  }

  private onTextDelta(event: Extract<TurnEvent, { type: 'text_delta' }>): void {
    const step = event.modelStep ?? -1;
    if (event.withdrawn) {
      const start = this.stepTextStart.get(step);
      if (start !== undefined) this.persistence?.truncateContent?.(start);
      this.stepTextStart.delete(step);
      writeSseEvent(this.res, { type: 'content_withdrawn', value: { modelStep: event.modelStep ?? null } });
      return;
    }
    if (!event.delta) return;
    if (!this.stepTextStart.has(step)) this.stepTextStart.set(step, this.contentLength());
    this.chunk({ content: event.delta });
    appendToPersistence(this.persistence, event.delta);
  }

  private onToolCallProgress(event: Extract<TurnEvent, { type: 'tool_call_streaming_delta' }>): void {
    const key = `${event.modelStep}:${event.callIndex ?? 0}`;
    if (this.toolCallOffsets.has(key)) return;
    this.toolCallOffsets.set(key, this.contentLength());
    if (this.persistence?.persist) {
      this.persistence.addMessageEvent?.('tool_call', {
        tool_call_id: event.callId ?? null,
        tool_call_index: event.callIndex ?? 0,
      });
    }
  }

  private onItem(item: Item, modelStep: number | undefined): void {
    switch (item.type) {
      case 'reasoning': {
        const details = item.providerMetadata?.reasoning_details;
        if (Array.isArray(details) && details.length > 0) {
          this.chunk({ reasoning_details: details });
          this.persistence?.setReasoningDetails?.(details);
        }
        return;
      }
      case 'assistant_message': {
        // Text already streamed as deltas; only generated images are new here.
        const images = item.content.flatMap((part) =>
          part.type === 'image' ? [{ type: 'image_url', image_url: { url: part.data } }] : [],
        );
        if (images.length > 0) this.chunk({ images });
        return;
      }
      case 'tool_call': {
        const index = this.pendingToolCalls.length;
        const signature = item.providerMetadata?.gemini_thought_signature;
        const offset = this.toolCallOffsets.get(`${modelStep}:${index}`);
        this.toolNames.set(item.callId, item.toolName);
        this.pendingToolCalls.push({
          id: item.callId,
          type: 'function',
          function: {
            name: item.toolName,
            arguments: item.rawArguments || JSON.stringify(item.input ?? {}),
          },
          index,
          textOffset: offset ?? this.contentLength(),
          ...(typeof signature === 'string' ? { gemini_thought_signature: signature } : {}),
        });
        return;
      }
      case 'tool_result': {
        const name = this.toolNames.get(item.callId);
        const toolOutput = { tool_call_id: item.callId, name, output: item.output };
        // Both chunks, as the legacy loop sends them.
        this.chunk({ tool_output: toolOutput });
        streamDeltaEvent({ res: this.res, model: this.model, event: { tool_output: toolOutput }, prefix: 'iter' });
        if (this.persistence?.persist) {
          this.persistence.addToolOutputs?.([
            { tool_call_id: item.callId, output: item.output, status: item.isError ? 'error' : 'success' },
          ]);
        }
        return;
      }
      default:
        // user_message / summary / provider_* items are history the host
        // already owns; nothing to stream.
        return;
    }
  }

  private onResponseCompleted(providerMetadata: Readonly<Record<string, unknown>> | undefined, continuation: unknown): void {
    const meta = (providerMetadata?.chatforge ?? {}) as ChatForgeResponseMetadata;
    if (meta.finishReason) this.lastFinishReason = meta.finishReason;

    const responseId = meta.responseId ?? (typeof continuation === 'string' ? continuation : null);
    if (responseId) this.persistence?.setResponseId?.(responseId);

    const usage = meta.usage ?? undefined;
    if (usage) {
      this.persistence?.setUsage?.(usage);
      if (typeof usage.reasoning_tokens === 'number') this.persistence?.setReasoningTokens?.(usage.reasoning_tokens);
    }
    if (usage || meta.model || meta.provider) {
      writeAndFlush(
        this.res,
        `data: ${JSON.stringify({
          ...(usage ? { usage } : {}),
          ...(meta.model ? { model: meta.model } : {}),
          ...(meta.provider ? { provider: meta.provider } : {}),
        })}\n\n`,
      );
    }
  }

  private onTurnEnded(result: TurnResult): void {
    this.ended = true;
    switch (result.kind) {
      case 'completed':
        recordFinalToPersistence(this.persistence, this.lastFinishReason ?? 'stop');
        break;
      case 'interrupted':
        // The root-turn loop cap (TurnSpec.limits) is the legacy MAX_ITERATIONS.
        if (result.terminalCause === 'budget_exhausted') this.notice(MAX_ITERATIONS_NOTICE);
        recordFinalToPersistence(this.persistence, this.lastFinishReason ?? 'stop');
        break;
      case 'cancelled':
        // Partial text is already checkpointed from the deltas.
        recordFinalToPersistence(this.persistence, 'cancelled');
        break;
      case 'failed':
        this.notice(`[Error: ${result.error.message}]`);
        if (this.persistence?.persist) this.persistence.markError?.();
        break;
    }
    if (this.res.writableEnded) return;
    emitConversationMetadata(this.res, this.persistence);
    streamDone(this.res);
    this.res.end();
  }

  private flushToolCalls(): void {
    if (this.pendingToolCalls.length === 0) return;
    const calls = this.pendingToolCalls;
    this.pendingToolCalls = [];
    this.chunk({ tool_calls: calls.map(({ textOffset: _offset, ...call }) => call) });
    if (this.persistence?.persist) this.persistence.addToolCalls?.(calls);
  }

  private retryStatus(info: { attempt: number; maxRetries: number; delayMs: number; error?: ModelError }): void {
    writeSseEvent(this.res, {
      type: 'retry_status',
      value: {
        source: 'provider',
        modelId: this.model,
        providerId: this.providerId,
        status: null,
        attempt: info.attempt,
        maxRetries: info.maxRetries,
        retryAfterMs: info.delayMs,
        errorMessage: info.error?.message ?? null,
        errorPreview: info.error?.message ?? null,
      },
    });
  }

  private notice(text: string): void {
    streamDeltaEvent({ res: this.res, model: this.model, event: { content: text }, prefix: 'iter' });
    appendToPersistence(this.persistence, text);
  }

  private chunk(delta: Record<string, unknown>): void {
    writeAndFlush(this.res, `data: ${JSON.stringify(createChatCompletionChunk(this.completionId, this.model, delta))}\n\n`);
  }

  private contentLength(): number {
    return this.persistence?.getContentLength?.() ?? 0;
  }
}
