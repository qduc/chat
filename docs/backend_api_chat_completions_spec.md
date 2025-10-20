### POST /v1/chat/completions
Core unified endpoint for all chat interactions. Implements an OpenAI-compatible surface while adding conversation persistence, iterative tool orchestration, provider routing, reasoning controls, prompt caching, and system prompt management.

#### Request Content-Type
`application/json`

#### Authentication
Required (Bearer token). Request is rejected with 401 if missing/invalid.

#### Request Body (superset of OpenAI spec)
```
{
  "model": "<model-id>",                  // Optional; resolved to provider default when omitted
  "messages": [                            // Standard OpenAI chat messages (system injected automatically)
    { "role": "user", "content": "Hello" },
    { "role": "assistant", "content": "..." },
    { "role": "tool", "tool_call_id": "tc_123", "content": "<tool result>" }
  ],
  "stream": true|false,                   // Controls client SSE; defaults to true (set false for JSON response)
  "provider_stream": true|false,          // Optional upstream streaming toggle; defaults to match `stream` (alias: providerStream)
  "tools": [                              // Either simplified tool names or full OpenAI tool specs
    // 1) Simplified: ["weather", "search"] (server expands to registered specs)
    // 2) Full spec objects (OpenAI format):
    { "type": "function", "function": { "name": "search", "description": "...", "parameters": { ...JSON Schema... } } }
  ],
  "tool_choice": "auto" | "none" | { "type":"function", "function":{"name":"..."} },
  "conversation_id": "uuid",              // Existing conversation; if absent a new one may be auto-created (persisted)
  "provider_id": "uuid",                  // Chooses a stored provider (header `x-provider-id` alternative)
  "system_prompt": "<string>",            // Convenience field; converted into/updates first system message server-side
  "active_system_prompt_id": "prompt-id?",// Optional persisted system prompt selection
  "previous_response_id": "resp_123?",    // Optional; used when provider supports Responses API chaining
  "reasoning_effort": "minimal|low|medium|high",
  "verbosity": "low|medium|high",
  "streamingEnabled": true|false,         // Client hint for persistence metadata
  "toolsEnabled": true|false,             // Client hint for persistence metadata
  "qualityLevel": "default|...",          // Stored in conversation metadata
  "researchMode": true|false,             // (Experimental) stripped before upstream call
  "id": "client-generated-id?"            // Optional passthrough for some streaming tool call chunk IDs
}
```

Notes:
- The server injects or replaces a single leading `system` message based on `system_prompt`.
- `stream` defaults to `true`, so clients receive SSE unless they explicitly send `stream: false`.
- `provider_stream` can disable upstream streaming without changing the client transport. When omitted it mirrors `stream`. Both `provider_stream` and `providerStream` are accepted.
- Persistence hints and internal selector fields (`conversation_id`, `provider_id`, `provider`, `streamingEnabled`, `toolsEnabled`, `qualityLevel`, `researchMode`, `system_prompt`, `providerStream`, `provider_stream`) are stripped before the outbound upstream request.
- If `tools` is an array of strings, the server expands only the tools that match registered names; unmatched names are silently ignored.
- When a persisted conversation exists, prior history is reconstructed server-side (and may include a `previous_response_id` optimization when the provider supports it), so clients only need to send the latest turn.

#### Modes Matrix
| Tools Present | Client stream (`stream`) | Behavior Path | Iterations | Client Transport |
|---------------|-------------------------|---------------|-----------|------------------|
| No            | false                   | Plain proxy   | 1         | Single JSON body |
| No            | true                    | Plain proxy   | 1         | SSE (delta chunks) |
| Yes           | false                   | Tool orchestration (JSON) | 1..N | JSON (augmented) |
| Yes           | true                    | Iterative tool streaming   | 1..N | SSE (content + tool events) |

`N` is bounded by a safety limit (currently 10 iterations). Upstream streaming can additionally be disabled with `provider_stream: false`; the server still streams to the client when `stream: true`.

#### Streaming Event Semantics
When `stream: true` the response headers include `Content-Type: text/event-stream`.
Events follow the OpenAI format (`data: <json>` terminated by a blank line) with a final `data: [DONE]` sentinel.

Additional event payload shapes:
```
// Conversation metadata event (persistence enabled)
// Emitted once per response: plain proxy sends it before the first delta,
// tool orchestration emits it after the final chunk and before [DONE].
{ "_conversation": { "id":"...", "assistant_message_id": "...", ... } }

// Standard delta chunk (OpenAI-compatible)
{ "id": "...", "object": "chat.completion.chunk", "created": 123, "model": "...", "choices": [ { "index":0, "delta": { "content": "Hel" } } ] }

// Consolidated tool_calls chunk (tool streaming path, buffered from partial deltas)
{ "id": "...", "object": "chat.completion.chunk", "choices": [ { "delta": { "tool_calls": [ { "id":"tc_x", "type":"function", "function": { "name":"search", "arguments":"{...json...}" } } ] } } ] }

// Tool output event (server-emitted wrapper)
{ "id": "...", "object": "chat.completion.chunk", "choices": [ { "delta": { "tool_output": { "tool_call_id": "tc_x", "name": "search", "output": "<stringified output>" } } } ] }

// Final empty delta signaling completion (finish_reason may appear earlier or here)
{ "id": "...", "object": "chat.completion.chunk", "choices": [ { "delta": {}, "finish_reason":"stop" } ] }
```

#### Non-Streaming JSON Responses
When `stream: false`, two shapes are returned:

1. Plain (no tools): Standard OpenAI response plus `_conversation` metadata.
```
{
  "id": "chatcmpl-...",
  "object": "chat.completion",
  "created": 1234567890,
  "model": "gpt-4o-mini",
  "choices": [ { "index":0, "message": { "role":"assistant", "content":"Hello!" }, "finish_reason":"stop" } ],
  "usage": { "prompt_tokens": 12, "completion_tokens": 7, "total_tokens": 19, "reasoning_tokens?": 4 },
  "_conversation": {
    "id": "uuid",
    "title": "optional title",
    "model": "gpt-4o-mini",
    "created_at": "2024-07-01T12:00:00Z",
    "tools_enabled": false,
    "active_tools": [],
    "active_system_prompt_id": null,
    "seq": 42,
    "user_message_id": "msg_usr_123",
    "assistant_message_id": "msg_asst_456"
  }
}
```
2. Tool orchestration (no stream): Adds `tool_events` capturing the iterative sequence before the final assistant message, plus the same `_conversation` block.
```
{
  ...standard fields...,
  "choices": [ { "message": { "role":"assistant", "content":"Final summarized answer" } } ],
  "tool_events": [
     { "type": "text", "value": "Thinking about query..." },
     { "type": "tool_call", "value": { "id":"tc_1", "type":"function", "function": { "name":"search", "arguments":"{...}" } } },
     { "type": "tool_output", "value": { "tool_call_id":"tc_1", "name":"search", "output":"<stringified result>" } }
  ],
  "_conversation": { ... }
}
```

`_conversation` is present only when persistence is enabled and the request is authenticated. `assistant_message_id` is populated after the assistant turn is stored; during streaming it may be `null` until finalization.

#### Conversation Persistence Behavior
| Scenario | Effect |
|----------|--------|
| No `conversation_id` provided | A new conversation is created (if persistence is enabled and the user is authenticated). `_conversation.id` reflects the new UUID and the metadata event is streamed. Title generation runs asynchronously. |
| Existing `conversation_id` | History is reconstructed server-side; clients can send just the latest user turn. The server may add `previous_response_id` when using the Responses API adapter. |
| Invalid / foreign `conversation_id` | Ignored and a new conversation is created. Clients observe a new `_conversation.id`. |
| Persistence disabled (config) | Endpoint still works but omits `_conversation` metadata entirely. |

#### Tool Orchestration Details
Iterative algorithm continues until the model stops requesting tools or the max iteration cap is hit.

Each iteration:
1. Call the provider with `stream: provider_stream !== false`. Upstream may respond with either SSE or JSON; the server adapts accordingly.
2. Stream assistant deltas directly to the client, buffering partial tool call arguments.
3. When tool calls are complete, emit a consolidated `tool_calls` chunk, execute each tool locally, stream `tool_output` events, append tool results to the conversation history, and continue.
4. If no tool calls are requested, stream the model's final completion and finalize persistence.
5. A guard appends `"[Maximum iterations reached]"` if the safety limit (10) is hit.

Tool outputs are persisted as separate `tool` messages with status (`success` / `error`) after the assistant turn is recorded.

#### Reasoning Controls
`reasoning_effort` and `verbosity` are validated against the provider's capabilities. Unsupported values are dropped, and invalid enumerations produce a 400 `invalid_request_error`.

#### Headers
Optional request headers:
- `x-provider-id`: Overrides provider selection (same as body `provider_id`).
- `x-conversation-id`: Alternate source for the conversation id (body takes precedence).

#### Example: Streaming With Tools
Request:
```
POST /v1/chat/completions
{
  "model": "gpt-4o-mini",
  "messages": [ { "role":"user", "content":"What's the weather in Paris?" } ],
  "tools": ["weather_api"]
}
```
Pseudo-stream:
```
data: {"choices":[{"delta":{"content":"Let me check"}}]}
data: {"choices":[{"delta":{"tool_calls":[{"id":"tc_1","type":"function","function":{"name":"weather_api","arguments":"{...}"}}]}}]}
data: {"choices":[{"delta":{"tool_output":{"tool_call_id":"tc_1","name":"weather_api","output":"{\"tempC\":18}"}}}]}
data: {"choices":[{"delta":{},"finish_reason":"stop"}]}
data: {"_conversation":{"id":"uuid","assistant_message_id":"msg_asst_456"}}
data: [DONE]
```

Plain (no tools) streams the `_conversation` frame first so the client learns the conversation id before deltas arrive.

#### Error Responses
Format mirrors OpenAI:
```
{ "error": "invalid_request_error", "message": "Invalid reasoning_effort. Must be one of minimal, low, medium, high" }
```
Common codes:
- 400 `invalid_request_error` (bad fields / invalid reasoning controls)
- 401 `invalid_token`
- 404 `not_found` (conversation referenced but removed after validation window)
- 429 `rate_limit_exceeded` (future / upstream passthrough)
- 500 `upstream_error` (network / provider issues), `tool_orchestration_error` (internal tool flow failure)
- 502 `bad_gateway` (provider failure surfaced)

#### Idempotency & Retries
Endpoint is not strictly idempotent (new conversation creation, title generation). Clients should deduplicate user messages if retrying after network errors.

#### Stability Guarantees
- Unknown new fields will be additive.
- `tool_events` list ordering is preserved.
- Streaming order: plain proxy => `_conversation` (if any) -> content deltas -> final empty delta -> `[DONE]`; tool streaming => content deltas -> buffered `tool_calls` -> `tool_output` events -> final empty delta -> `_conversation` -> `[DONE]`.

#### Field Removal / Stripping Summary
Before the upstream call the server removes: `conversation_id`, `provider_id`, `provider`, `system_prompt`, `streamingEnabled`, `toolsEnabled`, `qualityLevel`, `researchMode`, `providerStream`, `provider_stream`, and (for Chat Completions) `previous_response_id`. When the Responses API adapter is active, `previous_response_id` is forwarded.

#### Backwards Compatibility Notes
Legacy clients that send their own leading `system` message continue to work; supplying `system_prompt` overwrites it.

#### Limits & Safety
- Max tool orchestration iterations: 10
- Stream timeout guard: 30s inactivity abort for tool streaming path
- Tool argument accumulation concatenates deltas until valid JSON (empty => `{}`)

#### Observability
Server logs capture upstream requests and responses (with truncated previews), tool call arguments, tool outputs (truncated), iteration counts, and persistence actions. System prompt bodies are excluded from logs for privacy.

#### Future Extensions (non-breaking)
- Parallel tool execution
- Partial reasoning block streaming
- Tool call cancellation events
