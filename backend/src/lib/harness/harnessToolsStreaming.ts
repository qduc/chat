/**
 * The tool loop: every request with tools runs here, through `startTurn` from
 * `@qduc/agent-core` (see openaiProxy.js). Streaming requests get SSE
 * (`handleToolsStreamingHarness`); `stream: false` gets one JSON reply
 * (`handleToolsJsonHarness`). Both drive the same turn and the same persistence.
 *
 * Event-to-persistence mapping lives in `TurnEventSink`, the wire format in
 * turnOutputs.ts; this file only builds the turn and drives it.
 * See docs/agent-harness-event-mapping.md.
 */
import { randomUUID } from 'node:crypto';
import { startTurn } from '@qduc/agent-core';
import type { InteractionRequest, ReasoningEffort, TurnDeps, TurnId, TurnSpec } from '@qduc/agent-core';
import { createProvider } from '../providers/index.js';
import { setupStreamingHeaders } from '../streamingHandler.js';
import { buildConversationMessagesWithResumeAsync } from '../toolOrchestrationUtils.js';
import { getUserMaxToolIterations } from '../../db/users.js';
import { logger } from '../../logger.js';
import { chatMessagesToItems } from './chatMessages.ts';
import type { ChatMessage } from './chatMessages.ts';
import { createModel, createModelRegistry } from './models.ts';
import type { ChatForgeProvider, ChatForgeRuntimeConfig } from './providerModel.ts';
import { createToolRegistry } from './tools.ts';
import type { ChatForgeToolContext } from './tools.ts';
import { TurnEventSink } from './turnEventSink.ts';
import type { SinkPersistence } from './turnEventSink.ts';
import { JsonTurnOutput, SseTurnOutput } from './turnOutputs.ts';
import type { JsonResponse, SseResponse, TurnOutput } from './turnOutputs.ts';
import { REASONING_EFFORTS as REASONING_EFFORT_VALUES, normalizeReasoningEffort } from '../reasoningEffort.js';

const DEFAULT_MAX_ITERATIONS = 10;
const REASONING_EFFORTS = new Set<ReasoningEffort>(REASONING_EFFORT_VALUES as readonly ReasoningEffort[]);

type HarnessConfig = ChatForgeRuntimeConfig & {
  readonly defaultModel?: string;
  readonly parallelTools?: { readonly enabled?: boolean; readonly concurrency?: number; readonly maxConcurrency?: number };
};

type RequestBody = {
  readonly model?: string;
  readonly tools?: ReadonlyArray<{ readonly function?: { readonly name?: string } }>;
  readonly tool_choice?: unknown;
  readonly reasoning_effort?: string;
  readonly verbosity?: unknown;
  /** False when the user turned streaming off, or the model can't stream. */
  readonly provider_stream?: boolean;
  readonly [key: string]: unknown;
};

type IncomingBody = {
  readonly id?: string;
  readonly provider_id?: string;
  readonly enable_parallel_tool_calls?: boolean;
  readonly parallel_tool_concurrency?: number;
  readonly [key: string]: unknown;
};

type TurnArgs<Res> = {
  readonly body: RequestBody;
  readonly bodyIn: IncomingBody;
  readonly config: HarnessConfig;
  readonly res: Res;
  readonly req: { header(name: string): string | undefined };
  readonly persistence?: (SinkPersistence & { readonly conversationId?: string | null }) | null;
  readonly provider?: ChatForgeProvider | null;
  readonly userId?: string | null;
  readonly abortContext?: { readonly signal?: AbortSignal | null } | null;
};

export type HarnessToolsStreamingArgs = TurnArgs<SseResponse & { setHeader?(name: string, value: string): unknown }>;
export type HarnessToolsJsonArgs = TurnArgs<JsonResponse>;

/** Same parallel settings the legacy loop reads; 1 means sequential. */
function maxParallelToolCalls(bodyIn: IncomingBody, config: HarnessConfig): number {
  const enabled = bodyIn.enable_parallel_tool_calls === true || Boolean(config.parallelTools?.enabled);
  if (!enabled) return 1;
  const requested = Number(bodyIn.parallel_tool_concurrency ?? config.parallelTools?.concurrency ?? 3);
  const cap = Number(config.parallelTools?.maxConcurrency ?? 5);
  const concurrency = Math.min(requested, cap);
  return Number.isFinite(concurrency) && concurrency >= 1 ? Math.floor(concurrency) : 1;
}

/** Tool names the request enabled; undefined offers every registered tool, as the legacy fallback does. */
function enabledToolNames(body: RequestBody): string[] | undefined {
  if (!Array.isArray(body.tools) || body.tools.length === 0) return undefined;
  return body.tools.map((tool) => tool.function?.name).filter((name): name is string => Boolean(name));
}

function reasoningEffort(value: unknown): ReasoningEffort | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = normalizeReasoningEffort(value);
  return typeof normalized === 'string' && REASONING_EFFORTS.has(normalized as ReasoningEffort)
    ? (normalized as ReasoningEffort)
    : undefined;
}

/** Request fields the legacy loop forwarded that have no `TurnSpec` field. */
function providerOptions(body: RequestBody): Record<string, unknown> {
  const options: Record<string, unknown> = {};
  if (body.tool_choice !== undefined) options.tool_choice = body.tool_choice;
  if (body.verbosity !== undefined) options.verbosity = body.verbosity;
  // An effort outside the portable set (a provider-specific value) still reaches the provider.
  if (body.reasoning_effort && !reasoningEffort(body.reasoning_effort)) options.reasoning_effort = body.reasoning_effort;
  return options;
}

/** Streaming reply: SSE chunks as the turn runs. */
export async function handleToolsStreamingHarness(args: HarnessToolsStreamingArgs): Promise<void> {
  setupStreamingHeaders(args.res);
  return runToolTurn(args, (model, completionId) => new SseTurnOutput(args.res, model, completionId));
}

/** `stream: false`: one JSON reply once the turn ends. */
export async function handleToolsJsonHarness(args: HarnessToolsJsonArgs): Promise<void> {
  return runToolTurn(args, (model, completionId) => new JsonTurnOutput(args.res, model, completionId));
}

async function runToolTurn<Res>(
  { body, bodyIn, config, req, persistence = null, provider = null, userId = null, abortContext = null }: TurnArgs<Res>,
  createOutput: (model: string, completionId: string) => TurnOutput,
): Promise<void> {
  const signal = abortContext?.signal ?? null;
  const providerId = bodyIn?.provider_id || req.header('x-provider-id') || undefined;
  const modelId = body.model || config.defaultModel || '';
  const completionId = bodyIn?.id || `chatcmpl-${Date.now()}`;

  const sink = new TurnEventSink({
    output: createOutput(modelId, completionId),
    persistence,
    model: modelId,
    completionId,
    providerId: providerId ?? null,
  });

  let spec: TurnSpec;
  let deps: TurnDeps<ChatForgeToolContext>;
  try {
    const providerInstance = (provider ?? (await createProvider(config, { providerId }))) as ChatForgeProvider;
    // The turn holds the full history. On the Responses API its first request
    // continues from the previous turn's stored response when that is safe
    // (`resumeFrom`), and later tool rounds chain within the turn (`continuity` below).
    // Its JSDoc says Object/string; null persistence and user id are handled at runtime.
    const buildArgs = { body, bodyIn, persistence, userId } as Parameters<typeof buildConversationMessagesWithResumeAsync>[0];
    const built = (await buildConversationMessagesWithResumeAsync(buildArgs)) as {
      messages: ChatMessage[];
      resumeFrom: string | null;
    };
    const { instructions, items } = chatMessagesToItems(built.messages);

    const model = createModel({
      provider: providerInstance,
      model: modelId,
      config,
      userId,
      stream: body.provider_stream !== false,
      resumeFrom: built.resumeFrom,
    });
    const toolContext: ChatForgeToolContext = { userId };
    const tools = createToolRegistry(enabledToolNames(body));
    const turnId = randomUUID() as TurnId;
    const maxIterations = userId ? getUserMaxToolIterations(userId) : DEFAULT_MAX_ITERATIONS;
    const reasoning = reasoningEffort(body.reasoning_effort);

    spec = {
      turnId,
      affinity: { conversationKey: persistence?.conversationId || turnId },
      history: [],
      newItems: items,
      instructions,
      model: model.ref,
      tools: tools.available(toolContext).map((tool) => tool.spec),
      ...(reasoning ? { reasoning } : {}),
      providerOptions: providerOptions(body),
      // Legacy MAX_ITERATIONS counts model requests; tool calls were never capped.
      limits: { maxModelCalls: maxIterations, maxToolCalls: Number.MAX_SAFE_INTEGER },
    };
    deps = {
      models: createModelRegistry([model]),
      tools,
      toolContext,
      // No `recovery`: HTTP retries happen in ChatForge's transport (createOpenAIRequest),
      // and the model wrapper re-asks reasoning-only responses itself.
      maxParallelToolCalls: maxParallelToolCalls(bodyIn, config),
      // Chain tool rounds within this turn on the Responses API. Only there: other
      // models still report a response id, but chaining them would drop history.
      ...(model.capabilities.continuity
        ? { continuity: { binding: { origin: turnId, endpoint: `${model.ref.provider}/${model.ref.model}` } } }
        : {}),
    };
  } catch (error) {
    // Setup failed before a turn existed: report it the way a failed turn ends.
    logger.error({ msg: '[harness tool loop] setup error', err: error });
    const message = error instanceof Error ? error.message : String(error);
    sink.handle({ type: 'turn_ended', result: { kind: 'failed', error: { kind: 'provider', message, retryable: false } } });
    return;
  }

  const handle = startTurn(spec, deps);
  const onAbort = () => handle.cancel();
  if (signal?.aborted) onAbort();
  else signal?.addEventListener('abort', onAbort, { once: true });

  try {
    for await (const { event, token } of handle.events) {
      sink.handle(event);
      handle.accept(token);
      // ChatForge tools never ask; refuse rather than leave the turn waiting forever.
      if (event.type === 'interaction_required') denyInteraction(handle, event.request);
    }
  } catch (error) {
    logger.error({ msg: '[harness tool loop] error', err: error });
    const message = error instanceof Error ? error.message : String(error);
    sink.handle({ type: 'turn_ended', result: { kind: 'failed', error: { kind: 'provider', message, retryable: false } } });
  } finally {
    signal?.removeEventListener('abort', onAbort);
    // The turn ended without a turn_ended event reaching the sink; close the reply cleanly.
    sink.abandon();
  }
}

function denyInteraction(handle: ReturnType<typeof startTurn>, request: InteractionRequest): void {
  logger.warn({ msg: '[harness tool loop] unexpected interaction request', toolName: request.toolName, kind: request.kind });
  handle.answer(request.requestId, { kind: 'deny', reason: 'ChatForge does not support tool approvals' });
}
