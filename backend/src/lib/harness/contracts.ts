/**
 * Local mirror of the agent harness contracts.
 *
 * DELETE THIS FILE when the harness package is installed (issue #40, Part B),
 * and import the same names from the package instead. Every type here is a
 * copy of the published contract, so the compiler then checks the wrappers
 * against the real declarations.
 *
 * Source: qduc/term2 `main`, packages/agent-harness-core/src/
 *   - model/index.ts        (Item, Model, ModelRequest, ModelEvent, ...)
 *   - model/failure.ts      (ModelFailure)
 *   - tools/contracts.ts    (Tool, ToolContext, ToolResult, ...)
 *   - engine/types.ts       (TurnSpec, TurnEvent, TurnResult; subset, see below)
 *
 * Fields ChatForge never reads or writes are kept where they are part of a
 * type it implements (`Model`, `Tool`), so an implementation that compiles
 * here also compiles against the package.
 */

// ---------- model/index.ts ----------

/** Scheduling assumption only; not evidence of provider capacity. */
export const DEFAULT_ASSUMED_CONTEXT_WINDOW = 128_000;

export type ItemId = string & { readonly __brand: 'ItemId' };
export type ToolCallId = string & { readonly __brand: 'ToolCallId' };

export type ContentPart =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'image'; readonly mediaType: string; readonly data: string; readonly detail?: string };

export type ProviderOpaqueItem = {
  readonly type: 'provider_opaque';
  readonly id: ItemId;
  readonly provider: string;
  readonly sourceProvider?: string;
  readonly item: Readonly<Record<string, unknown>>;
};

export type ProviderInputItem = {
  readonly type: 'provider_input';
  readonly id: ItemId;
  readonly provider: string;
  readonly input: Readonly<Record<string, unknown>>;
};

export type Item =
  | {
      readonly type: 'user_message';
      readonly id: ItemId;
      readonly content: readonly ContentPart[];
      readonly conversationTiming?: string;
    }
  | { readonly type: 'assistant_message'; readonly id: ItemId; readonly content: readonly ContentPart[] }
  | {
      readonly type: 'reasoning';
      readonly id: ItemId;
      readonly summary: string;
      readonly opaque?: unknown;
      readonly providerMetadata?: Readonly<Record<string, unknown>>;
      readonly providerItemId?: string;
    }
  | {
      readonly type: 'tool_call';
      readonly id: ItemId;
      readonly callId: ToolCallId;
      readonly toolName: string;
      readonly input: unknown;
      readonly rawArguments?: string;
      readonly argumentsSnapshot?: unknown;
      readonly providerMetadata?: Readonly<Record<string, unknown>>;
      readonly toolType?: 'function' | 'custom';
    }
  | {
      readonly type: 'tool_result';
      readonly id: ItemId;
      readonly callId: ToolCallId;
      readonly output: string;
      readonly isError: boolean;
      readonly providerOutput?: readonly Readonly<Record<string, unknown>>[];
      readonly toolType?: 'function' | 'custom';
    }
  | { readonly type: 'summary'; readonly id: ItemId; readonly text: string; readonly replaces: readonly ItemId[] }
  | ProviderOpaqueItem
  | ProviderInputItem;

export type ModelRef = { readonly provider: string; readonly model: string };

export type ToolSpec = {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly modelTool?: {
    readonly type: 'custom';
    readonly format: { readonly type: 'grammar'; readonly syntax: 'lark'; readonly definition: string };
  };
};

export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

export type ModelAffinity = {
  readonly conversationKey: string;
  readonly cacheKey?: string;
  readonly routingKey?: string;
};

/** Opaque here: owned by the engine's recovery module. */
export type ModelRecoveryBudget = unknown;

export type ModelRequest = {
  readonly affinity?: ModelAffinity;
  readonly model: ModelRef;
  readonly instructions: string;
  readonly input: readonly Item[];
  readonly tools: readonly ToolSpec[];
  readonly reasoning?: ReasoningEffort;
  readonly maxOutputTokens?: number;
  readonly temperature?: number;
  readonly providerOptions?: Readonly<Record<string, unknown>>;
  readonly continuation?: unknown;
  readonly previousResponseId?: string | null;
  readonly disableChaining?: boolean;
  readonly recovery?: { readonly budget: ModelRecoveryBudget; readonly dispatchClaimed?: boolean };
  /** OpenAI-only; planned for removal before graduation. ChatForge rejects it. */
  readonly useStandardServiceTier?: boolean;
  /** OpenAI-only; planned for removal before graduation. ChatForge ignores it (HTTP only). */
  readonly downgradeTransport?: boolean;
};

export type Usage = {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedInputTokens: number;
  readonly upstreamProvider?: string;
};

export type StopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'refusal';

export type ToolCallArgumentProgress = {
  readonly type: 'tool_call_streaming_delta';
  readonly argumentCharCount: number;
  readonly toolName?: string;
  readonly callId?: ToolCallId;
  readonly itemId?: string;
  readonly callIndex?: number;
};

export type CodexWeeklyQuota = { readonly usedPercent: number; readonly resetAt: number };

export type ModelEvent =
  | { readonly type: 'codex_quota'; readonly quota: CodexWeeklyQuota | null }
  | ToolCallArgumentProgress
  | { readonly type: 'text_delta'; readonly delta: string; readonly partId?: string }
  | {
      readonly type: 'reasoning_delta';
      readonly delta: string;
      readonly id?: string;
      readonly providerMetadata?: Readonly<Record<string, unknown>>;
    }
  | { readonly type: 'item'; readonly item: Item }
  | {
      readonly type: 'usage';
      readonly usage: Usage;
      readonly speed?: { readonly tps: number; readonly approximate: boolean };
    }
  | { readonly type: 'retrying'; readonly attempt: number; readonly delayMs: number; readonly error: ModelError }
  | {
      readonly type: 'done';
      readonly stopReason: StopReason;
      readonly continuation?: unknown;
      readonly providerMetadata?: Readonly<Record<string, unknown>>;
      readonly costUsd?: number | string;
    };

export type ModelErrorKind =
  | 'authentication'
  | 'rate_limit'
  | 'network'
  | 'context_overflow'
  | 'invalid_request'
  | 'provider'
  | 'cancelled';

export type ModelError = {
  readonly kind: ModelErrorKind;
  readonly message: string;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;
};

export type ModelCapabilities = {
  readonly continuity: boolean;
  readonly standardServiceTier: boolean;
  readonly httpTransportDowngrade: boolean;
};

export interface Model {
  readonly ref: ModelRef;
  readonly contextWindow: number;
  readonly catalogContextWindow?: number;
  readonly capabilities?: ModelCapabilities;
  stream(request: ModelRequest, signal: AbortSignal, onDispatched?: () => void): AsyncIterable<ModelEvent>;
  compact?(request: ModelRequest, signal: AbortSignal, onDispatched?: () => void): Promise<readonly Item[]>;
}

export interface ModelRegistry {
  resolve(ref: ModelRef): Model;
  list(): readonly ModelRef[];
}

// ---------- model/failure.ts ----------

export type ModelRecoveryEvidence =
  | 'request_unsent'
  | 'provider_state_rejected'
  | 'connection_interrupted'
  | 'ambiguous_outcome'
  | 'model_behavior'
  | 'service_tier_rejected'
  | 'transport_downgrade';

/** The only runtime value in this file; the package exports the same class. */
export class ModelFailure extends Error implements ModelError {
  readonly kind: ModelError['kind'];
  readonly retryable: boolean;
  readonly retryAfterMs?: number;
  declare readonly cause: unknown;
  declare readonly recoveryEvidence?: ModelRecoveryEvidence;

  constructor(error: ModelError, cause?: unknown, recoveryEvidence?: ModelRecoveryEvidence) {
    super(error.message, { cause });
    this.name = 'ModelFailure';
    this.kind = error.kind;
    this.retryable = error.retryable;
    if (error.retryAfterMs !== undefined) this.retryAfterMs = error.retryAfterMs;
    Object.defineProperty(this, 'cause', { value: cause, enumerable: false });
    Object.defineProperty(this, 'recoveryEvidence', { value: recoveryEvidence, enumerable: false });
  }
}

// ---------- tools/contracts.ts ----------

export type NestedRunBudget =
  | { readonly kind?: 'native'; readonly maxModelCalls: number; readonly maxToolCalls: number }
  | { readonly kind: 'adopted' };

export type NestedRunOutcome =
  | { readonly kind: 'background'; readonly runId: string }
  | { readonly kind: 'completed' }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'budget_exhausted' }
  | {
      readonly kind: 'interrupted';
      readonly terminalCause?: 'goal_check_unresolved' | 'completion_verification_blocked';
    }
  | { readonly kind: 'failed'; readonly error: ModelError };

export type NestedRunRequest = {
  readonly input?: string;
  readonly mode?: 'foreground' | 'background';
  readonly runId?: string;
  readonly name?: string;
  readonly role?: string;
  readonly label?: string;
  readonly maxOutputTokens?: number;
  readonly instructions: string;
  readonly items: readonly Item[];
  readonly toolNames: readonly string[];
  readonly model: ModelRef;
  readonly reasoning?: ReasoningEffort;
  readonly budget: NestedRunBudget;
};

export type NestedRunResult = {
  readonly runId?: string;
  readonly toolsUsed?: readonly string[];
  readonly toolUseCounts?: readonly { readonly toolName: string; readonly count: number }[];
  readonly items: readonly Item[];
  readonly outcome: NestedRunOutcome;
  readonly report?: string;
};

export type ExecutionId = string & { readonly __brand: 'ExecutionId' };
export type InteractionRequestId = string & { readonly __brand: 'InteractionRequestId' };

export type InteractionDecision = (
  | { readonly kind: 'allow'; readonly grant?: string }
  | { readonly kind: 'deny'; readonly reason?: string }
  | { readonly kind: 'answer'; readonly answer: string }
) & { readonly stopAfterApprovalResolution?: boolean };

export type Risk = 'low' | 'medium' | 'high';

export type ToolInteractionRequest = {
  readonly kind: 'approval' | 'question';
  readonly toolName: string;
  readonly input: unknown;
  readonly sourceCallId?: string;
  readonly summary: string;
  readonly detail?: string;
  readonly risk?: Risk;
  readonly presentation?: Readonly<Record<string, unknown>>;
  readonly grants?: readonly string[];
};

export type ToolContext<AppCtx = unknown> = {
  readonly app: AppCtx;
  runNested(request: NestedRunRequest): Promise<NestedRunResult>;
  readonly signal: AbortSignal;
  progress(chunk: string): void;
  executeChild?<T>(
    descriptor: { readonly toolName: string; readonly input: unknown; readonly sourceCallId: string },
    operation: () => Promise<T>,
  ): Promise<T>;
  interact?(request: ToolInteractionRequest): Promise<InteractionDecision>;
  readonly approvalGrant?: string;
};

export type ApprovalRequirement =
  | { readonly kind: 'none'; readonly batched?: true }
  | { readonly kind: 'question'; readonly request: ToolInteractionRequest }
  | {
      readonly kind: 'ask';
      readonly summary: string;
      readonly risk?: Risk;
      readonly detail?: string;
      readonly grants?: readonly string[];
    }
  | { readonly kind: 'deny'; readonly reason: string };

export type ToolResult = {
  readonly stopAfterExecution?: true;
  readonly output: string;
  readonly isError: boolean;
  readonly providerOutput?: Extract<Item, { readonly type: 'tool_result' }>['providerOutput'];
  readonly display?: unknown;
};

export interface Tool<Input = unknown, AppCtx = unknown> {
  readonly spec: ToolSpec;
  readonly parallelSafe?: boolean | ((input: Input, ctx: ToolContext<AppCtx>) => boolean | Promise<boolean>);
  parse(raw: unknown): Input;
  approval(input: Input, ctx: ToolContext<AppCtx>): ApprovalRequirement | Promise<ApprovalRequirement>;
  execute(input: Input, ctx: ToolContext<AppCtx>): Promise<ToolResult>;
}

export interface ToolRegistry<AppCtx = unknown> {
  get(name: string): Tool<unknown, AppCtx> | undefined;
  available(ctx: AppCtx): readonly Tool<unknown, AppCtx>[];
}

// ---------- engine/types.ts (subset) ----------
//
// Only the turn input and the events ChatForge maps (see
// docs/agent-harness-event-mapping.md). The real `TurnEvent` union also has
// compaction, budget and codex variants; ChatForge configures none of those
// features, and once the package lands the compiler will flag any variant the
// mapper doesn't handle.

export type TurnId = string & { readonly __brand: 'TurnId' };

export type TurnSpec = {
  readonly affinity?: ModelAffinity;
  readonly turnId: TurnId;
  readonly history: readonly Item[];
  readonly newItems: readonly Item[];
  readonly instructions: string;
  readonly model: ModelRef;
  readonly tools: readonly ToolSpec[];
  readonly reasoning?: ReasoningEffort;
  readonly temperature?: number;
  readonly maxOutputTokens?: number;
  readonly providerOptions?: Readonly<Record<string, unknown>>;
  readonly limits?: { readonly maxModelCalls: number; readonly maxToolCalls: number };
};

export type TurnResult =
  | { readonly kind: 'completed'; readonly notice?: string }
  | { readonly kind: 'cancelled' }
  | {
      readonly kind: 'interrupted';
      readonly terminalCause?: 'goal_check_unresolved' | 'completion_verification_blocked' | 'budget_exhausted';
      readonly notice?: string;
    }
  | { readonly kind: 'failed'; readonly error: ModelError; readonly notice?: string };

export type TurnEvent =
  | {
      readonly type: 'retrying';
      readonly attempt: number;
      readonly maxRetries: number;
      readonly delayMs: number;
      readonly error: ModelError;
      readonly toolName: 'turn' | 'conversation';
      readonly retryType: 'upstream' | 'connection_interrupted';
    }
  | { readonly type: 'model_retrying'; readonly attempt: number; readonly maxRetries: number; readonly delayMs: number }
  | (ToolCallArgumentProgress & { readonly turnId: TurnId; readonly modelStep: number })
  | {
      readonly type: 'model_response_completed';
      readonly modelStep: number;
      readonly stopReason: StopReason;
      readonly continuation?: unknown;
      readonly providerMetadata?: Readonly<Record<string, unknown>>;
      readonly costUsd?: number | string;
    }
  | { readonly type: 'text_delta'; readonly delta: string; readonly modelStep?: number; readonly withdrawn?: true }
  | { readonly type: 'reasoning_delta'; readonly delta: string }
  | { readonly type: 'item'; readonly item: Item; readonly executionId?: ExecutionId; readonly modelStep?: number }
  | {
      readonly type: 'usage';
      readonly usage: Usage;
      readonly modelStep?: number;
      readonly speed?: { readonly tps: number; readonly approximate: boolean };
    }
  | {
      readonly type: 'tool_called';
      readonly executionId: ExecutionId;
      readonly callId: ToolCallId;
      readonly toolName: string;
      readonly input: unknown;
    }
  | {
      readonly type: 'tool_start_requested';
      readonly executionId: ExecutionId;
      readonly parentExecutionId?: ExecutionId;
      readonly callId: ToolCallId;
      readonly toolName: string;
      readonly input: unknown;
    }
  | { readonly type: 'tool_progress'; readonly executionId: ExecutionId; readonly chunk: string }
  | { readonly type: 'tool_execution_finished'; readonly executionId: ExecutionId; readonly result: ToolResult }
  | { readonly type: 'turn_ended'; readonly result: TurnResult };
