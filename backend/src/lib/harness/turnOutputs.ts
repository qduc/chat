/**
 * Where `TurnEventSink` sends what the client sees. Persistence stays in the
 * sink; an output only decides the wire format:
 *
 * - `SseTurnOutput`: the streaming reply (chat.completion chunks, then
 *   `_conversation` and `[DONE]`).
 * - `JsonTurnOutput`: one JSON reply when the client asked not to stream
 *   (`stream: false`): the final assistant message plus `tool_events`, the
 *   shape the frontend's non-streaming handler reads.
 */
import { addConversationMetadata } from '../responseUtils.js';
import { createChatCompletionChunk, writeAndFlush, writeSseEvent } from '../streamUtils.js';
import { emitConversationMetadata, streamDeltaEvent, streamDone } from '../toolOrchestrationUtils.js';
import type { TurnResult } from '@qduc/agent-core';

/** What one model response reported, for the reply's usage line or body. */
export type ResponseMeta = {
  readonly usage?: Record<string, unknown> | null;
  readonly model?: string | null;
  readonly provider?: string | null;
  readonly responseId?: string | null;
  readonly finishReason?: string | null;
};

export type ToolOutputEvent = { readonly tool_call_id: string; readonly name?: string; readonly output: string };

export interface TurnOutput {
  readonly writableEnded: boolean;
  /** One chat.completion delta: content, reasoning, tool calls, details or images. */
  chunk(delta: Record<string, unknown>): void;
  /** Text ChatForge adds itself (loop cap, error), shown as assistant text. */
  notice(text: string): void;
  toolOutput(output: ToolOutputEvent): void;
  /** Side-channel events (`content_withdrawn`, `retry_status`). */
  event(event: { readonly type: string; readonly value: unknown }): void;
  responseCompleted(meta: ResponseMeta): void;
  /** The turn ended; persistence is already final. */
  end(result: TurnResult, persistence: unknown): void;
  /** The turn stopped without a `turn_ended` event; close the reply. */
  abandon(persistence: unknown): void;
}

export type SseResponse = {
  readonly writableEnded: boolean;
  write(chunk: string): unknown;
  end(): unknown;
  flush?(): void;
};

export class SseTurnOutput implements TurnOutput {
  private readonly res: SseResponse;
  private readonly model: string;
  private readonly completionId: string;

  constructor(res: SseResponse, model: string, completionId: string) {
    this.res = res;
    this.model = model;
    this.completionId = completionId;
  }

  get writableEnded(): boolean {
    return this.res.writableEnded;
  }

  chunk(delta: Record<string, unknown>): void {
    writeAndFlush(this.res, `data: ${JSON.stringify(createChatCompletionChunk(this.completionId, this.model, delta))}\n\n`);
  }

  notice(text: string): void {
    streamDeltaEvent({ res: this.res, model: this.model, event: { content: text }, prefix: 'iter' });
  }

  toolOutput(output: ToolOutputEvent): void {
    // Both chunks, as the legacy loop sent them.
    this.chunk({ tool_output: output });
    streamDeltaEvent({ res: this.res, model: this.model, event: { tool_output: output }, prefix: 'iter' });
  }

  event(event: { readonly type: string; readonly value: unknown }): void {
    writeSseEvent(this.res, event);
  }

  responseCompleted(meta: ResponseMeta): void {
    if (!meta.usage && !meta.model && !meta.provider) return;
    writeAndFlush(
      this.res,
      `data: ${JSON.stringify({
        ...(meta.usage ? { usage: meta.usage } : {}),
        ...(meta.model ? { model: meta.model } : {}),
        ...(meta.provider ? { provider: meta.provider } : {}),
      })}\n\n`,
    );
  }

  end(_result: TurnResult, persistence: unknown): void {
    this.abandon(persistence);
  }

  abandon(persistence: unknown): void {
    if (this.res.writableEnded) return;
    emitConversationMetadata(this.res, persistence);
    streamDone(this.res);
    this.res.end();
  }
}

export type JsonResponse = {
  readonly writableEnded: boolean;
  status(code: number): { json(body: unknown): unknown };
  end(): unknown;
};

type ToolEvent =
  | { type: 'text'; value: string }
  | { type: 'tool_call'; value: unknown }
  | { type: 'tool_output'; value: ToolOutputEvent };

export class JsonTurnOutput implements TurnOutput {
  private readonly toolEvents: ToolEvent[] = [];
  /** Open text event that further text extends; closed by a tool call or output. */
  private openText: { type: 'text'; value: string } | null = null;
  /** Text since the last tool round: the reply's `message.content`. */
  private finalText = '';
  private reasoning = '';
  private reasoningDetails: unknown[] = [];
  private images: unknown[] = [];
  private last: ResponseMeta = {};
  private readonly res: JsonResponse;
  private readonly model: string;
  private readonly completionId: string;

  constructor(res: JsonResponse, model: string, completionId: string) {
    this.res = res;
    this.model = model;
    this.completionId = completionId;
  }

  get writableEnded(): boolean {
    return this.res.writableEnded;
  }

  chunk(delta: Record<string, unknown>): void {
    if (typeof delta.content === 'string') this.text(delta.content);
    if (typeof delta.reasoning_content === 'string') this.reasoning += delta.reasoning_content;
    if (Array.isArray(delta.reasoning_details)) this.reasoningDetails.push(...delta.reasoning_details);
    if (Array.isArray(delta.images)) this.images.push(...delta.images);
    if (Array.isArray(delta.tool_calls)) {
      for (const call of delta.tool_calls) this.toolEvents.push({ type: 'tool_call', value: call });
      this.closeText();
    }
  }

  notice(text: string): void {
    this.text(text);
  }

  toolOutput(output: ToolOutputEvent): void {
    this.toolEvents.push({ type: 'tool_output', value: output });
    this.closeText();
  }

  event(): void {
    // No side channel in a single JSON reply. `content_withdrawn` only fires with
    // engine recovery, which ChatForge doesn't configure; retries just take longer.
  }

  responseCompleted(meta: ResponseMeta): void {
    this.last = { ...this.last, ...Object.fromEntries(Object.entries(meta).filter(([, v]) => v != null)) };
  }

  end(result: TurnResult, persistence: unknown): void {
    if (this.res.writableEnded) return;
    if (result.kind === 'cancelled') {
      // The client is gone; nothing to answer.
      this.res.end();
      return;
    }
    if (result.kind === 'failed') {
      this.fail(result.error.message);
      return;
    }
    const message: Record<string, unknown> = { role: 'assistant', content: this.finalText };
    if (this.reasoning) message.reasoning_content = this.reasoning;
    if (this.reasoningDetails.length > 0) message.reasoning_details = this.reasoningDetails;
    if (this.images.length > 0) message.images = this.images;
    const body: Record<string, unknown> = {
      id: this.last.responseId || this.completionId,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: this.last.model || this.model,
      choices: [{ index: 0, message, finish_reason: this.last.finishReason || 'stop' }],
      ...(this.last.usage ? { usage: this.last.usage } : {}),
      ...(this.last.provider ? { provider: this.last.provider } : {}),
      tool_events: this.toolEvents,
    };
    addConversationMetadata(body, persistence);
    this.res.status(200).json(body);
  }

  abandon(): void {
    if (this.res.writableEnded) return;
    this.fail('The tool turn ended without a result');
  }

  private fail(message: string): void {
    this.res.status(500).json({ error: { message, type: 'tool_orchestration_error' }, tool_events: this.toolEvents });
  }

  private text(delta: string): void {
    if (!delta) return;
    if (!this.openText) {
      this.openText = { type: 'text', value: '' };
      this.toolEvents.push(this.openText);
    }
    this.openText.value += delta;
    this.finalText += delta;
  }

  private closeText(): void {
    this.openText = null;
    this.finalText = '';
  }
}
