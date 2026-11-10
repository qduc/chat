# Agent harness: event mapping

Status: **Part B of [#40](https://github.com/qduc/chat/issues/40) in progress.** The streaming tool loop
runs on the harness when `AGENT_HARNESS_TOOL_LOOP=true` (default off; the legacy loop runs otherwise).

The harness is `@qduc/agent-core`, developed in qduc/agent-runtime (`packages/core/`) and installed
from npm at an exact version (`0.2.0-alpha.1`) in `backend/package.json` and `electron/package.json`.
To pick up a harness change, publish a new version from agent-runtime and bump both pins.

## Pieces

| File | Role |
| --- | --- |
| `harness/harnessToolsStreaming.ts` | The flagged tool loop: builds the `TurnSpec`, runs `startTurn`, feeds the sink |
| `harness/chatMessages.ts` | `Item[]` ⇄ Chat Completions messages, lossless (unmappable messages ride as `provider_input`) |
| `harness/providerModel.ts` | Shared `Model.stream`: request building, ChatForge transport, chunk → `ModelEvent` |
| `harness/models.ts` | One wrapper per provider (`OpenAIModel`, `AnthropicModel`, `GeminiModel`, `LlamaCppModel`), `createModel`, `createModelRegistry` |
| `harness/tools.ts` | `toHarnessTool`, `createToolRegistry`; app context is `{ userId }` |
| `harness/turnEventSink.ts` | `TurnEvent` → SSE + persistence, matching `handleToolsStreaming` |

## Building a turn

| Legacy (`handleToolsStreaming`) | Harness |
| --- | --- |
| `buildConversationMessagesOptimized` → messages | `buildConversationMessagesAsync` (always full history) → `chatMessagesToItems` → `{ instructions, items }`, all as `newItems` |
| `body.model`, provider instance | `createModel({ provider, model, config, userId })`, one registry per turn |
| `body.tools` (expanded specs) | `createToolRegistry(enabledNames)`; `TurnSpec.tools` = their specs |
| `userId` passed to `executeToolCall` | `TurnDeps.toolContext = { userId }`, read by tools as `ctx.app.userId` |
| `getUserMaxToolIterations(userId)` | `TurnSpec.limits.maxModelCalls` |
| parallel tools opt-in + concurrency | `TurnDeps.maxParallelToolCalls` (1 when parallel mode is off) |
| `reasoning_effort`, `verbosity`, custom params | `TurnSpec.reasoning`; the rest in `TurnSpec.providerOptions` |
| conversation id | `TurnSpec.affinity.conversationKey` (cache-log key) |
| `previous_response_id` from the last message | Not sent yet: without `TurnDeps.continuity` every request is self-contained |
| `abortContext.signal` | `handle.cancel()` on abort |
| invalid-reasoning retry (2×, then warning) | Inside the model wrapper (`ProviderModel.stream`), same limit and warning text |

Each wrapper is built per turn and holds no module state, so N concurrent turns (comparison mode,
many users) share nothing. `createOpenAIRequest` now accepts the provider instance, so the wrapper no
longer re-resolves a provider from the database per request.

## Event mapping

The host loop handles each event, then accepts it: `sink.handle(event); handle.accept(token)`. The
checkpoint and final-write model is unchanged: deltas are appended to `SimplifiedPersistence` as they
arrive (and checkpointed by it), and `recordAssistantFinal` writes the message at the end.

| `TurnEvent` | SSE | Persistence |
| --- | --- | --- |
| `text_delta` | chunk `{ content }` | `appendContent`; remembers where the model step's text began |
| `text_delta` + `withdrawn` | `{ type: 'content_withdrawn', value: { modelStep } }` | `truncateContent(stepStart)`, rewrites a checkpoint that holds the withdrawn text |
| `reasoning_delta` | chunk `{ reasoning_content }` | `appendReasoningText` |
| `tool_call_streaming_delta` (first per call) | — | `addMessageEvent('tool_call', …)`, records the call's `textOffset` |
| `item` reasoning | chunk `{ reasoning_details }` | `setReasoningDetails` |
| `item` assistant_message | chunk `{ images }` if it has image parts (text already streamed) | — |
| `item` tool_call | buffered; one `{ tool_calls }` chunk when the response ends | `addToolCalls` with `textOffset` |
| `item` tool_result | chunk `{ tool_output }` twice (meta chunk + `streamDeltaEvent`), as today | `addToolOutputs`, status `error` when `isError` |
| `model_response_completed` | `{ usage, model, provider }` | `setResponseId`, `setUsage`, `setReasoningTokens` |
| `usage` | — (the full set rides on `model_response_completed`) | — |
| `retrying`, `model_retrying` | `{ type: 'retry_status', value }` | — |
| `tool_called`, `tool_start_requested` | — (call id → tool name for outputs) | — |
| `tool_progress`, `tool_execution_finished` | — (ChatForge tools report no progress; results come from the tool_result item) | — |
| `turn_ended` completed | `_conversation`, `[DONE]` | `recordAssistantFinal(last finish reason)` |
| `turn_ended` interrupted, `budget_exhausted` | `[Maximum iterations reached]`, then as completed | as completed, after appending the notice |
| `turn_ended` cancelled | `_conversation`, `[DONE]` | `recordAssistantFinal('cancelled')`; partial text is what the deltas checkpointed |
| `turn_ended` failed | `[Error: …]`, `_conversation`, `[DONE]` | `markError` |

**Partial text on abort** comes from collected text deltas, as today. The engine's accepted history
never holds a partial assistant message; ChatForge's checkpoint does, by design.

**ChatForge-native response data** (raw normalized usage incl. reasoning tokens and timings,
finish reason, upstream model and provider, response id) travels on
`done.providerMetadata.chatforge`, which the engine passes through on `model_response_completed`.

## Deliberate differences from the legacy loop

- **Synthesized chunks.** The legacy loop forwards upstream chunks verbatim. The sink writes chunks
  built from events, so client-visible fields are the ones the frontend reads (`content`,
  `reasoning_content`, `reasoning_details`, `tool_calls`, `tool_output`, `images`, `usage`). Usage,
  `reasoning_details` and images now arrive once per model response instead of per chunk.
- **Continuation only where it exists.** The legacy loop sends `previous_response_id` (a `chatcmpl-…`
  id) to Chat Completions providers from the second iteration on, because the adapter allow-lists the
  key. Wrappers send it only to Responses-API providers. A rejected continuation is retried
  self-contained from the request's own full history instead of rebuilding history from the database.
- **Tool errors are errors.** A throwing tool is persisted with status `error` (legacy: `success`). The
  text the model sees is unchanged.
- **`content_withdrawn` is new.** The frontend ignores it today, so withdrawn text stays on screen until
  reload. It only fires if engine recovery is enabled, which ChatForge does not configure.
- **No `previous_response_id` yet.** Every harness request carries the full history, including for
  Responses-API providers. Correct, but more input tokens than legacy for long Responses-API threads.
  Wiring `TurnDeps.continuity` restores it.
- **Streamed `tool_output.output` is text.** Legacy streams the tool's raw value (an object for JSON
  tools), the harness the serialized string the model saw. The UI pretty-prints objects and shows
  strings as-is, so a JSON result is indented while streaming on legacy and compact on the harness;
  after reload both are compact (the database stores the string).
- **`provider_stream: false` is ignored.** The wrapper always asks upstream to stream; it already handles
  a JSON reply if the provider sends one.

## Gaps to report to the harness

None of these needed a local workaround in Part A; each is a candidate Term2 issue.

1. **Reasoning-only responses.** The legacy loop retries (up to 2×) when a model returns reasoning with
   no text and no tool call, then appends a warning. The engine's `model_behavior` recovery looks like
   the fit, but it refuses to replay once any reasoning delta has streamed (that counts as committed
   output), so it never fires for this case. ChatForge handles it in the model wrapper instead. Worth
   raising: should streamed reasoning block a model-behavior replay?
2. **No live provider-metadata channel.** `ModelEvent` can't carry per-chunk provider extras (llama.cpp
   `timings`, OpenRouter `provider`, generated images while streaming). ChatForge sends them at the
   end of the response via `done.providerMetadata`.
3. **`Usage` is narrow.** No reasoning tokens, cache-creation tokens or timings; ChatForge keeps its own
   on `providerMetadata`.
4. **`TurnSpec.limits` requires both caps.** ChatForge has one knob (max iterations = model calls) and
   would pass a large `maxToolCalls`. An optional `maxToolCalls` would fit.
5. **Run budget and cost accounting:** ChatForge does not need them. Per-user iteration cap is the only
   limit, and it's `limits`.
6. **Codex and OpenAI-only fields:** ChatForge needs none. Wrappers reject `useStandardServiceTier`,
   ignore `downgradeTransport`, and never emit `codex_quota`. All can be removed before graduation.
7. **Retries live in providers.** ChatForge providers retry 429/5xx themselves and the wrapper surfaces
   those as `retrying` events. ChatForge won't configure engine `recovery`, so there is one retry
   layer. If the harness ever requires `recovery`, providers need a "no retries" switch.

## Part B checklist

- [x] Install the package (from npm); delete `contracts.ts`; fix imports;
      `npm run typecheck` checks the wrappers against the package's declarations.
- [x] Behind `AGENT_HARNESS_TOOL_LOOP`: build the `TurnSpec` (table above), `startTurn`, feed each event
      to `TurnEventSink`, then accept it (`harness/harnessToolsStreaming.ts`).
- [x] Parity test over the real route, both loops, same scripted upstream
      (`__tests__/harness/toolLoopParity.test.js`): tool call then answer, reasoning-only retry and
      exhaustion, iteration cap, upstream error.
- [x] Replay e2e over sanitized real provider recordings (`npm run test:provider-replay`,
      `integration/providerReplay.test.js`): OpenAI Chat Completions, OpenAI Responses, Anthropic
      and Gemini, each through both loops, checked against the recording and against each other.
- [x] Parallel tools (synthetic fixtures, SDK-checked), Stop mid-answer and upstream drop, through
      both loops in the replay suite. Legacy closes the upstream request ~50 ms after `[DONE]` on
      Stop; the harness before it. Both agree on everything the client and database see.
- [ ] Replace the synthetic parallel fixtures with real captures; run with the flag on against real
      providers.
- [x] Switch from the vendored tarball to the npm release.
- [ ] Wire `TurnDeps.continuity` so Responses-API providers get `previous_response_id` again.
- [ ] Frontend: handle `content_withdrawn` (only needed if engine recovery is turned on).
- [ ] Remove the legacy loop.
