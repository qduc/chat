# ChatForge Backend API Specification

Version: 2025-10-07
Status: Draft (authoritative for current code on branch `refactor/frontend_rewrite`)
Base URL: `https://<host>` (all endpoints are prefixed with `/v1` except health which also supports `/health`/`/healthz`)
Authentication: JSON Web Tokens (JWT) via `Authorization: Bearer <accessToken>` unless explicitly marked Public.
Content Type: `application/json` unless stated (multipart for image upload, SSE for streaming chat if enabled by client request headers).

## Conventions
- All date/time fields are ISO 8601 UTC strings unless otherwise noted.
- IDs are UUID v4 (or NanoID for images) unless externally sourced.
- Pagination uses opaque `cursor` tokens where provided; message pagination uses `after_seq` integer sequence numbers.
- Errors follow `{ error: <code>, message?: <human readable>, details?: any }`.
- All data is user-scoped: authenticated user only sees/acts on their own resources.

## Authentication & Users

### POST /v1/auth/register
Register a new user.
Request JSON body:
```
{
  "email": "user@example.com",
  "password": "min 8 chars",
  "displayName": "Optional Name"
}
```
Responses:
- 201 Created:
```
{
  "user": {"id":"...","email":"...","displayName": "...", "emailVerified": false, "createdAt": "..."},
  "tokens": { "accessToken": "...", "refreshToken": "..." }
}
```
- 400 validation_error | invalid_email | weak_password
- 409 email_taken
- 500 registration_failed
Rate limits: 3/hour/IP.

### POST /v1/auth/login
Authenticate existing user.
Request body: `{ "email": "...", "password": "..." }`
Success 200:
```
{
  "user": {"id":"...","email":"...","displayName":"...","emailVerified":false,"createdAt":"...","lastLoginAt":"..."},
  "tokens": {"accessToken":"...","refreshToken":"..."}
}
```
Errors: 400 validation_error, 401 invalid_credentials, 500 login_failed.
Rate limits: 5 / 15min / IP.

### POST /v1/auth/refresh
Refresh access token.
Body: `{ "refreshToken": "<token>" }`
200: `{ "accessToken": "..." }`
Errors: 400 validation_error, 401 refresh_token_expired, 403 invalid_refresh_token | invalid_token, 500 refresh_failed.

### GET /v1/auth/me
Auth required. Returns `{ "user": { id, email, displayName, ... } }`.

### POST /v1/auth/logout
Stateless logout (client discards tokens). Always 200: `{ "message": "Logged out successfully" }`.

## Health

### GET /health or /healthz
Public. Returns status + environment basics.
```
{
  "status": "ok",
  "uptime": <seconds>,
  "provider": "openai-compatible",
  "model": "<defaultModel>",
  "persistence": { "enabled": true, "retentionDays": <int> }
}
```

## Providers
Manage upstream AI API provider configurations (per user).
All endpoints require auth.

### GET /v1/providers
List providers: `{ "providers": [ { id, name, provider_type, base_url, enabled, is_default, created_at, ... } ] }`

### GET /v1/providers/default
Get effective default provider. 200 provider object or 404 not_found.

### GET /v1/providers/{id}
Get single provider. 404 not_found.

### POST /v1/providers
Create provider.
Body fields:
```
{
  "id?": "uuid (optional)",
  "name": "string",
  "provider_type": "openai|...",
  "api_key?": "string",
  "base_url?": "https://...",
  "enabled?": true,
  "is_default?": false,
  "extra_headers?": { "Header": "Value" },
  "metadata?": { "model_filter": { /* filter spec */ }, ... }
}
```
Responses: 201 with created object; 400 invalid_request; 409 conflict (duplicate); 500 internal_server_error.

### PUT /v1/providers/{id}
Update mutable fields (same shape as create, all optional). 200 updated, 404 not_found.

### POST /v1/providers/{id}/default
Set provider as default. 200 provider, 404 not_found.

### DELETE /v1/providers/{id}
Deletes provider. 204 empty or 404 not_found.

### GET /v1/providers/{id}/models
Fetch upstream models via stored credentials. Applies optional model filtering.
Success: `{ provider: { id, name, provider_type }, models: [ { id, ...upstream } ] }`
Errors: 400 invalid_provider | disabled | bad request reasons; 404 not_found; 502 bad_gateway/provider_error; 500 internal_server_error.

### POST /v1/providers/test
Test a provider configuration without saving.
Body requires: `name`, `provider_type`, `api_key`; optional `base_url`, `extra_headers`, `metadata.model_filter`.
Success 200: `{ success: true, message: "Connection successful! Found X models (sample1, sample2, ...).", models: <count> }`
Errors 400 test_failed (with detail), 400 invalid_request.

### POST /v1/providers/{id}/test
Test an existing stored provider (optionally overriding `base_url`, `extra_headers`, `metadata.model_filter`). Similar response codes to generic test.

## Conversations
Conversation & message lifecycle (requires persistence enabled). All routes require auth. If persistence disabled, routes respond 501 not_implemented.

### POST /v1/conversations/migrate
Migrates anonymous (session-bound) conversations to authenticated user.
Body: none.
Success 200: `{ migrated: <int>, message: "..." }`.
Errors: 400 bad_request (no session), 500 internal_error.

### GET /v1/conversations
Query params: `cursor?`, `limit?`, `include_deleted?=true|false`.
Returns cursor-paginated list.
Success 200: shape:
```
{
  "items": [ { id, title, model, provider_id, created_at, updated_at, deleted_at?, ... } ],
  "next_cursor": "..." | null
}
```
Errors 500 internal_error.

### POST /v1/conversations
Create conversation.
Body (all optional except may desire model/provider):
```
{
  "title?": "string",
  "provider_id?": "uuid",
  "model?": "model-id",
  "streamingEnabled?": true,
  "toolsEnabled?": true,
  "qualityLevel?": "default|...",
  "reasoningEffort?": "low|medium|high",
  "verbosity?": "...",
  "system_prompt?": "string"  // or legacy systemPrompt
}
```
201: Full conversation record including metadata.
Errors: 500 db_error/internal_error.

### GET /v1/conversations/{id}
Query params: `after_seq?=N` (default 0), `limit?=50`.
Returns conversation metadata plus paginated messages.
200 Response shape:
```
{
  id, title, model, provider_id,
  system_prompt: "..." | null,
  active_system_prompt_id: "uuid" | null,
  messages: [ { id, seq, role, content, created_at, ... } ],
  next_after_seq: <next seq or null>,
  ...other conversation fields
}
```
Errors: 404 not_found, 500 internal_error.

### DELETE /v1/conversations/{id}
Soft delete (marks deleted_at). 204 or 404 not_found.

### PUT /v1/conversations/{id}/messages/{messageId}/edit
Edits message content then forks conversation starting from that message; deletes subsequent messages in original.
Body:
- `content`: string OR mixed-content array (objects with type `text` + `text` field or `image_url` etc.)
Validation: must not be empty (at least one text or image element).
200:
```
{
  "message": { id, seq, content },
  "new_conversation_id": "uuid"
}
```
Errors: 400 bad_request, 404 not_found, 500 internal_error.

## Chat (Proxy Completions & Tools)
All endpoints require auth.

### POST /v1/chat/completions
Core unified endpoint for all chat interactions. Implements an OpenAI-compatible surface while adding: conversation persistence, tool orchestration (iterative), reasoning controls, system prompt injection, and metadata synchronization.

#### Request Content-Type
`application/json`

#### Authentication
Required (Bearer token). Request is rejected with 401 if missing/invalid.

#### Request Body (superset of OpenAI spec)
```
{
  "model": "<model-id>",                  // Optional: resolved to provider default if omitted
  "messages": [                            // Standard OpenAI chat messages (system injected automatically)
    { "role": "user", "content": "Hello" },
    { "role": "assistant", "content": "..." },
    { "role": "tool", "tool_call_id": "tc_123", "content": "<tool result>" }
  ],
  "stream": true|false,                    // Enable SSE streaming (default false if omitted)
  "tools": [                               // EITHER full OpenAI tool objects OR simplified string array
    // 1) Simplified: ["weather", "search"] (server expands)
    // 2) Full spec objects (OpenAI format):
    { "type": "function", "function": { "name": "search", "description": "...", "parameters": { ...JSON Schema... } } }
  ],
  "tool_choice": "auto" | "none" | { "type":"function", "function":{"name":"..."} },
  "conversation_id": "uuid",              // Existing conversation; if absent a new one may be auto-created (persisted)
  "provider_id": "uuid",                  // Chooses a stored provider (header `x-provider-id` alternative). Stripped upstream.
  "system_prompt": "<string>",            // Convenience field; converted into/updates first system message server-side
  "reasoning_effort": "minimal|low|medium|high", // Only if model supports reasoning
  "verbosity": "low|medium|high",         // Only if model supports reasoning verbosity tiers
  "streamingEnabled": true|false,          // Client hint for persistence metadata (not sent upstream)
  "toolsEnabled": true|false,              // Client hint for persistence metadata (not sent upstream)
  "qualityLevel": "default|...",          // Stored in conversation metadata (not upstream)
  "researchMode": true|false,              // (Experimental) stripped
  "id": "client-generated-id?"            // Optional passthrough for some streaming tool call chunk IDs
}
```

Notes:
- The server injects / normalizes a single leading `system` message based on `system_prompt`.
- Any non-OpenAI persistence / UI control fields are stripped before outbound upstream API call.
- If `tools` is an array of strings, each must match a registered tool name; unmatched names are silently ignored.
- When a persisted conversation exists, prior history is reconstructed server-side (may use `previous_response_id` optimization) — client need not resend full history.

#### Modes Matrix
| Tools Present | stream=true | Behavior Path | Iterations | Response Transport |
|---------------|-------------|---------------|-----------|--------------------|
| No            | false       | Plain proxy   | 1         | Single JSON body   |
| No            | true        | Plain proxy   | 1         | SSE (delta chunks) |
| Yes           | false       | Tool orchestration (JSON) | 1..N (until no more tool calls or max) | JSON (augmented) |
| Yes           | true        | Iterative tool streaming   | 1..N | SSE (tool + content events) |

`N` is bounded by a safety limit (currently 10 iterations) to avoid infinite tool loops.

#### Streaming Event Semantics
When `stream: true` headers include `Content-Type: text/event-stream`.
Events follow OpenAI pattern: lines of `data: <json>` terminated by blank line. A final `data: [DONE]` sentinel closes the stream.

Additional event payload shapes:
```
// Standard delta chunk (OpenAI)
{ "id": "...", "object": "chat.completion.chunk", "created": 123, "model": "...", "choices": [ { "index":0, "delta": { "content": "Hel" } } ] }

// Consolidated tool_calls chunk (tool streaming path only, after buffering partial deltas)
{ "id": "...", "object": "chat.completion.chunk", "choices": [ { "delta": { "tool_calls": [ { "id":"tc_x", "type":"function", "function": { "name":"search", "arguments":"{...json...}" } } ] } } ] }

// Tool output event (internal prefix; `event` not used—encoded as delta wrapper)
{ "id": "...", "object": "chat.completion.chunk", "choices": [ { "delta": { "tool_output": { "tool_call_id": "tc_x", "name": "search", "output": "<stringified output>" } } } ] }

// Final empty delta signaling completion (finish_reason may appear earlier or here)
{ "id": "...", "object": "chat.completion.chunk", "choices": [ { "delta": {}, "finish_reason":"stop" } ] }
```
Conversation metadata (e.g. newly created conversation id) may be streamed in a synthetic chunk before `[DONE]`.

#### Non-Streaming JSON Responses
Two shapes depending on tool usage:

1. Plain (no tools): Standard OpenAI response plus added conversation metadata fields.
```
{
  "id": "chatcmpl-...",
  "object": "chat.completion",
  "created": 1234567890,
  "model": "gpt-4o-mini",
  "choices": [ { "index":0, "message": { "role":"assistant", "content":"Hello!" }, "finish_reason":"stop" } ],
  "usage": { "prompt_tokens": 12, "completion_tokens": 7, "total_tokens": 19, "reasoning_tokens?": 4 },
  "conversation_id": "uuid",                // Added
  "new_conversation": true|false,            // Added (present if auto-created this call)
  "user_message_id": "<id?>",               // Added (last persisted user message)
  "assistant_message_id": "<id?>"           // Added
}
```
2. Tool orchestration (no stream): Adds `tool_events` capturing the iterative sequence (thinking text, tool calls, tool outputs) prior to final assistant message.
```
{
  ...standard fields...,
  "choices": [ { "message": { "role":"assistant", "content":"Final summarized answer" } } ],
  "tool_events": [
     { "type": "text", "value": "Thinking about query..." },
     { "type": "tool_call", "value": { "id":"tc_1", "type":"function", "function": { "name":"search", "arguments":"{...}" } } },
     { "type": "tool_output", "value": { "tool_call_id":"tc_1", "name":"search", "output":"<stringified result>" } }
  ],
  "conversation_id": "uuid"
}
```

#### Conversation Persistence Behavior
| Scenario | Effect |
|----------|--------|
| No `conversation_id` provided | New conversation created (if persistence enabled & user authenticated). Metadata flags (model, tools, reasoning) captured. Title may be auto-generated from first user message. |
| Existing `conversation_id` | History reconstructed server-side; request `messages` can be partial (latest turn). Server may use `previous_response_id` for upstream optimization. |
| Invalid / foreign `conversation_id` | Ignored and new conversation created (client receives new id). |
| Persistence disabled (config) | Endpoint still works but omits conversation metadata fields. |

#### Tool Orchestration Details
Iterative algorithm until: model stops requesting tools OR max iterations reached.
Each iteration:
1. Non-stream upstream call (even if client requested streaming) to inspect `tool_calls`.
2. If no tool calls -> final response (optionally streamed separately if streaming mode).
3. If tool calls -> execute each locally, buffer outputs, append tool messages, repeat.
4. Streams thinking/content + tool events if `stream:true`.
5. Max iteration fallback appends `[Maximum iterations reached]` marker.

#### Reasoning Controls
`reasoning_effort` and `verbosity` are only forwarded if provider/model declares support. Invalid values => 400 `invalid_request_error`.

#### Headers
Optional request headers:
- `x-provider-id`: Overrides provider selection (same as body `provider_id`).
- `x-conversation-id`: Alternate place for conversation id (body takes precedence).

#### Example: Streaming With Tools
Request:
```
POST /v1/chat/completions
{
  "model": "gpt-4o-mini",
  "messages": [ { "role":"user", "content":"What's the weather in Paris?" } ],
  "tools": ["weather_api"],
  "stream": true
}
```
Pseudo-stream:
```
data: {"choices":[{"delta":{"content":"Let me check"}}]}
data: {"choices":[{"delta":{"tool_calls":[{"id":"tc_1","type":"function","function":{"name":"weather_api","arguments":"{...}"}}]}}]}
data: {"choices":[{"delta":{"tool_output":{"tool_call_id":"tc_1","name":"weather_api","output":"{\"tempC\":18}"}}}]}
data: {"choices":[{"delta":{"content":"Currently 18C in Paris."},"finish_reason":"stop"}]}
data: {"conversation":{"id":"uuid","new":true}}
data: [DONE]
```

#### Error Responses
Format mirrors OpenAI:
```
{ "error": "invalid_request_error", "message": "Invalid reasoning_effort. Must be one of minimal, low, medium, high" }
```
Common codes:
- 400 `invalid_request_error` (bad fields / invalid reasoning controls)
- 401 `invalid_token`
- 404 `not_found` (if conversation referenced but removed after validation window)
- 429 `rate_limit_exceeded` (future / upstream passthrough)
- 500 `upstream_error` (network / provider), `tool_orchestration_error` (internal tool flow)
- 502 `bad_gateway` (provider failure surfaced)

#### Idempotency & Retries
Endpoint is not strictly idempotent (new conversation creation, title generation). Clients should de-duplicate user messages client-side if retrying after network errors.

#### Stability Guarantees
- Unknown new fields will be additive.
- `tool_events` list ordering preserved.
- Streaming order: content deltas -> (buffered) tool_calls -> per-tool tool_output events -> final empty delta -> metadata -> `[DONE]`.

#### Field Removal / Stripping Summary (never sent upstream)
`conversation_id`, `provider_id`, `system_prompt` (transformed to message), `streamingEnabled`, `toolsEnabled`, `qualityLevel`, `researchMode`.

#### Backwards Compatibility Notes
Legacy clients sending a first system message manually still work; server will replace it if `system_prompt` provided.

#### Limits & Safety
- Max tool orchestration iterations: 10
- Stream timeout guard: 30s inactivity abort for tool streaming path
- Large tool argument accumulation: arguments concatenated until complete JSON parse (empty => `{}`)

#### Observability
Server logs summarize tool calls, tool outputs (with truncated previews), iteration counts, and persistence actions; system prompt content excluded from logs for privacy.

#### Future Extensions (non-breaking)
- Function calling parallelization
- Partial reasoning block streaming
- Tool call cancellation events

---

### GET /v1/tools
Returns registered tool specifications.
200:
```
{
  "tools": [ { type: "function", function: { name, description, parameters } }, ...],
  "available_tools": ["tool_name", ...]
}
```
Errors: 500 { error: "Failed to generate tool specifications" }.

## System Prompts
Manage built-in and custom system prompts and selection per conversation.
All routes require auth.

### GET /v1/system-prompts
List built-ins and custom prompts.
200:
```
{
  "built_ins": [ { id, name, content, ... } ],
  "custom": [ { id, name, content, ... } ],
  "error": null | "partial_failure_reason"
}
```

### POST /v1/system-prompts
Create custom prompt.
Body (validated): `name` (string), `content` (string), optional metadata per schema.
201: new prompt object.
Errors: 400 validation_error, other codes via service.

### PATCH /v1/system-prompts/{id}
Update custom prompt (partial). 200 updated prompt or 404 not_found.
Errors: 400 validation_error.

### DELETE /v1/system-prompts/{id}
Delete custom prompt. 204 or 404 not_found.

### POST /v1/system-prompts/{id}/duplicate
Duplicate prompt. 201 new prompt or 404 not_found.

### POST /v1/system-prompts/none/select
Clear active prompt for a conversation.
Body: `{ "conversation_id": "uuid" }`
200: result object.
Errors: 400 validation_error, service-specific codes.

### POST /v1/system-prompts/{id}/select
Select a prompt for a conversation (optionally inline override content).
Body: `{ "conversation_id": "uuid", "inline_override?": "string" }`
200: selection result (includes active prompt info).
Errors: 400 validation_error, 404 not_found, service-specific codes.

## Images
Image upload & retrieval (user isolated). All retrieval requires auth.

### POST /v1/images/upload
Multipart form-data with field name `images` (1..maxImagesPerMessage).
Returns:
- 200 `{ success: true, images: [ { id, url, filename, originalFilename, size, type, alt } ] }`
- 207 Multi-Status if partial success: `{ success: true, images: [...], errors: [ { filename, error } ] }`
Errors: 400 no_files|upload_failed, 413 file_too_large|too_many_files, 500 upload_failed.

### GET /v1/images/config
Public config for client validation.
200 `{ maxFileSize, maxDimensions, maxImagesPerMessage, allowedFormats, uploadRateLimit, storageLimitPerUser }`

### GET /v1/images/{imageId}
Serve image (must belong to user). Handles ETag / 304.
Responses:
- 200 binary image data with headers.
- 304 not modified.
- 400 invalid_image_id
- 404 not_found
- 500 serve_failed

## Error Codes (Non-exhaustive)
- authentication: invalid_token, refresh_token_expired, invalid_refresh_token
- validation: validation_error, invalid_request, bad_request, weak_password, invalid_email
- providers: conflict, not_found, disabled, test_failed, provider_error, bad_gateway, invalid_provider
- conversations: not_implemented, internal_error, db_error
- prompts: not_found, validation_error, internal_server_error
- images: no_files, file_too_large, too_many_files, invalid_image_id, serve_failed, upload_failed

## Security Notes
- All mutating operations require valid JWT.
- Provider API keys never exposed except through operations requiring user auth; model listing proxied server-side.
- Image access enforced per-user; direct path guessing returns 404.
- System prompt content never appears in logs.

## Rate Limiting
- Auth endpoints have explicit rate limits (see above). Other endpoints may rely on upstream infra or future middleware.

## Streaming Chat Protocol
When `stream:true` chat responses use SSE with event lines following OpenAI spec. Tool calls appear as interim messages with tool invocation metadata; final message terminates with `[DONE]` sentinel.

## Versioning & Compatibility
- Current version path prefix: `/v1`.
- Non-breaking additions may introduce new fields; clients should ignore unknown fields.

## Change Log (since initial spec)
- 2025-10-07: Initial authored spec.

---
For questions or proposing changes, open a PR updating this file alongside corresponding tests in `backend/__tests__/*`.
