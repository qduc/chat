# Tool Calling (Function/Custom Tools) – Implementation Plan

Last updated: 2025-08-24

## Goals
- Support OpenAI-compatible tool/function calling end-to-end while preserving our existing invariants:
  - No provider keys in the browser.
  - OpenAI request/response schema compatibility (Chat Completions + Responses API).
  - Streaming passthrough (SSE) unchanged, including `Content-Type: text/event-stream` and `data: [DONE]` terminator.
  - Apply `rateLimit` to new endpoints.

## Non-goals (initial phase)
- Do not introduce the Assistants/Threads API; stay within Chat Completions and/or Responses API.
- No generic plugin marketplace. Tools are first-party, curated functions.

## Background (current repo)
- Frontend: `frontend/lib/chat.ts` streams assistant text from either `/v1/responses` (preferred) or `/v1/chat/completions` (fallback), and only parses text deltas today.
- Backend: `backend/src/lib/openaiProxy.js` proxies to provider; when using Responses API it converts stream events to Chat Completions shape for the `/v1/chat/completions` endpoint. Persistence is optional and appends assistant deltas to SQLite.
- DB schema (`messages`): columns exist for `tool_calls`, `function_call`, `content_json` but are not used yet. Roles are text (we can store `tool`).

## What we’ll support
Single pathway with server orchestration:

- Backend parses tool-call stream events, runs registered server tools, injects tool results, and continues the loop until the model returns a final assistant message. SSE is preserved to the client.
- Frontend remains presentation-only: it initiates a single streaming request and renders tokens; it does not parse/act on tool events nor call tools directly.

## API design (client → backend)

### Requests (Chat Completions-compatible)
- Endpoint: `POST /v1/chat/completions`
- Fields to add (optional):
  - `tools`: OpenAI function tools array:
    ```json
    {
      "tools": [
        {
          "type": "function",
          "function": {
            "name": "get_weather",
            "description": "Get current weather by city",
            "parameters": {
              "type": "object",
              "properties": { "city": { "type": "string" } },
              "required": ["city"]
            }
          }
        }
      ],
      "tool_choice": "auto"
    }
    ```
- Messages contract remains standard. Tool results are sent as messages with `role: "tool"`, including `tool_call_id` to pair with the prior assistant `tool_calls` entry.

### Requests (Responses API)
- Endpoint: `POST /v1/responses` (preferred with our proxy)
- Fields to add:
  - `tools`: same tool definitions. The Responses API streams dedicated events for function-call arguments:
    - `response.function_call_arguments.delta`
    - `response.function_call_arguments.done`
  - `tool_choice`: optional (`"auto"` recommended)

### Tool registry (server-only)
- Internal registry of allowed tools with strict schemas and handlers; no public tool execution endpoint is exposed.

## Frontend plan
File: `frontend/lib/chat.ts`

- Keep as a thin client. It should:
  - Send requests including `tools` and `tool_choice` as needed.
  - Stream only assistant text deltas and render them.
  - Not detect/interpret tool events or execute tools. All heavy logic is on the backend.
  - Optionally render non-text “status” lines if the backend chooses to emit text summaries during tool runs (optional future UX improvement; no special parsing today).

## Backend plan
Files to touch:
- `backend/src/lib/openaiProxy.js`: Upgrade from pure passthrough to orchestrator for tool calls while preserving SSE.
- `backend/src/routes/chat.js`: No external tool endpoints are needed; we continue to expose `/v1/responses` and `/v1/chat/completions` only.
- `backend/src/middleware/rateLimit.js`: Continue applying as today.

Server-side orchestration (always on; feature-gated if needed):
- Detect tool calls while streaming:
  - Chat Completions: watch for `choices[].delta.tool_calls` (or legacy `function_call`) chunks; accumulate `arguments` per tool call id/index until complete.
  - Responses API: handle `response.function_call_arguments.delta`/`done` events and map to function name/call id using the surrounding item events. Maintain a small state machine per request.
- On finalized tool call(s):
  - Validate arguments with zod schemas from an internal tool registry.
  - Execute tools on the server (with timeouts and retries if needed).
  - Synthesize a `role: "tool"` message per call with `tool_call_id` and `content` (stringified JSON if object).
  - Continue the same upstream interaction by issuing the next request turn to the provider with the accumulated messages (assistant with tool_calls + tool messages) until no more tool calls.
- SSE to client:
  - Forward assistant text deltas to the client as they arrive.
  - Optionally emit small textual status updates during tool execution (e.g., “Calling get_weather…”) as plain assistant content if we choose, but default to silent while tools run to avoid UI flicker.
  - Always terminate with `data: [DONE]`.

Tool registry pattern (internal only):
```js
// backend/src/lib/tools.js
import { z } from 'zod';

export const tools = {
  get_weather: {
    schema: z.object({ city: z.string().min(1) }).strict(),
    handler: async ({ city }) => ({ tempC: 22, city }),
  },
  // add more tools here
};
```

Persistence adjustments:
- When persistence is enabled and a tool turn occurs:
  - Store the assistant message containing `tool_calls` in `messages.tool_calls`.
  - Insert `role: "tool"` messages with `content` (string) or `content_json` (object) per `tool_call_id`.
  - Finalize the subsequent assistant text message as usual.

## Data model notes
- `messages.role`: accept `tool`.
- `messages.tool_calls`: JSON string for the assistant’s tool_calls array.
- `messages.function_call`: optional legacy field when models emit single `function_call`.
- `messages.content_json`: store structured tool output if not a string; else use `content`.

## Security and reliability
- Validation: zod schemas for every tool; reject extra fields (`.strict()`).
- Timeouts: per-tool execution timeout (e.g., 10s) and overall request timeout.
- Side-effects: keep tools idempotent when possible; log and rate-limit aggressively.
- Network egress: if tools call external APIs, isolate keys server-side; no keys to the browser.
- Observability: log tool invocations with name + latency; redact args with PII.

## Testing plan
- Backend unit tests:
  - Tool registry validation and handler execution with timeouts/errors.
  - Orchestration loop on simulated streams: single and multiple tool calls, and no-tool paths.
  - Rate limits unaffected for existing endpoints.
- Proxy integration tests:
  - Ensure SSE stream remains valid and `[DONE]` preserved under tool orchestration.
  - Chat Completions: fixture chunks with `tool_calls` deltas; ensure backend assembles calls, runs tools, and continues.
  - Responses API: fixture `response.function_call_arguments.delta/done` and associated item events; ensure backend maps names/ids and proceeds.
- Frontend tests:
  - Remain minimal: ensure text streaming still renders correctly; no tool logic tests on FE.

## Rollout
- Single path: backend orchestration only.
- Optional env flag to disable tools entirely (e.g., `ENABLE_TOOLS=false`).

## References
- OpenAI Node helpers: `.runTools()`, parsing and events (Chat Completions).
- Streaming events (Responses API): `response.function_call_arguments.delta` and `response.function_call_arguments.done` for function-call args; preserve `data: [DONE]`.
- See `docs/API-SPECS.md` and `docs/SECURITY.md` for base invariants.

## Open questions
- Responses API tool name discovery: confirm event sequence that provides function name and item/call IDs to pair with arguments events. We’ll code defensively and gate by providers verified in tests.
- Parallel tool calls: begin with sequential execution; evaluate safe parallelization later.
- Persisting non-text tool outputs: use `content_json` and handle UI rendering later.
