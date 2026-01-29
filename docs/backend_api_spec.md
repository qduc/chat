# ChatForge Backend API Specification

Version: 2026-01-24
Status: Draft (authoritative for current code on branch `refactor/frontend_rewrite`)
Base URL: `https://<host>` (all endpoints are prefixed with `/v1` except health which also supports `/health`/`/healthz`)
Authentication: JSON Web Tokens (JWT) via `Authorization: Bearer <accessToken>` unless explicitly marked Public.
Content Type: `application/json` unless stated (multipart for image upload, SSE for streaming chat if enabled by client request headers).

## Table of Contents
- [Conventions](#conventions)
- [Authentication & Users](#authentication--users)
- [Health](#health)
- [Providers](#providers)
- [Conversations](#conversations)
- [Chat (Proxy Completions & Tools)](#chat-proxy-completions--tools)
- [System Prompts](#system-prompts)
- [Images](#images)
- [Files](#files)
- [User Settings](#user-settings)
- [Error Codes](#error-codes-non-exhaustive)
- [Security Notes](#security-notes)
- [Rate Limiting](#rate-limiting)
- [Streaming Chat Protocol](#streaming-chat-protocol)
- [Versioning & Compatibility](#versioning--compatibility)
- [Change Log](#change-log-since-initial-spec)

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

### POST /v1/auth/electron
Auto-login for Electron desktop app. Only available when server is running with `IS_ELECTRON=true`.
Request body: none.
Behavior:
- Creates a default user on first launch if no users exist.
- Returns existing user credentials for subsequent launches.
Success 200:
```
{
  "user": {"id":"...","email":"...","displayName":"...","emailVerified":false,"createdAt":"...","lastLoginAt":"..."},
  "tokens": {"accessToken":"...","refreshToken":"..."}
}
```
Errors: 400 electron_login_failed (when `IS_ELECTRON` is not enabled or auto-login fails).

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

### GET /v1/models
Batch fetch models from all enabled providers.
Query params: `refresh?=true` to force cache refresh (bypasses in-memory cache).
Returns aggregated models from all enabled providers with caching metadata.
Success 200:
```
{
  "providers": [
    {
      "provider": {
        "id": "uuid",
        "name": "string",
        "provider_type": "openai|anthropic|..."
      },
      "models": [ { id, ...upstream model data } ]
    },
    ...
  ],
  "cached": true|false,
  "cachedAt": "ISO8601 timestamp" | null,
  "errors": [ { "providerId": "...", "providerName": "...", "error": "..." } ]
}
```
Errors: 400 refresh_in_progress (if refresh already running), 500 internal_server_error.
Note: Individual provider failures are included in the response with empty models array and error field.

### GET /v1/providers/{id}/models
Fetch upstream models via stored credentials. Applies optional model filtering.
Note: If provider's `base_url` is not set, defaults are used based on `provider_type`. Authentication headers are automatically set based on provider type (Anthropic uses `x-api-key`, others use `Authorization: Bearer`).
Success: `{ provider: { id, name, provider_type }, models: [ { id, ...upstream } ] }`
Errors: 400 invalid_provider | disabled | bad request reasons; 404 not_found; 502 bad_gateway/provider_error; 500 internal_server_error.

### POST /v1/providers/test
Test a provider configuration without saving.
Body requires: `name`, `provider_type`, `api_key`; optional `base_url`, `extra_headers`, `metadata.model_filter`.
Note: If `base_url` is omitted, defaults are used based on `provider_type` (e.g., Anthropic → `https://api.anthropic.com`, OpenAI → `https://api.openai.com`).
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
  "items": [ { id, title, model, provider_id, created_at, ... } ],
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
  "reasoningEffort?": "low|medium|high",
  "verbosity?": "...",
  "system_prompt?": "string"  // or legacy systemPrompt
}
```
201: Full conversation record including metadata.
Errors: 500 db_error/internal_error.

### GET /v1/conversations/{id}
Query params: `after_seq?=N` (default 0), `limit?=50`, `include_linked?=messages`.
Returns conversation metadata plus paginated messages.
When `include_linked=messages` is specified, linked comparison conversation messages are included in the response.
200 Response shape:
```
{
  "id": "uuid",
  "title": "...",
  "model": "...",
  "provider_id": "uuid",
  "system_prompt": "..." | null,
  "active_system_prompt_id": "uuid" | null,
  "custom_request_params_id": "uuid" | null,
  "messages": [ { id, seq, role, content, created_at, ... } ],
  "evaluations": [ { id, user_id, conversation_id, model_a_conversation_id, model_a_message_id, model_b_conversation_id, model_b_message_id, judge_model_id, criteria, score_a, score_b, winner, reasoning, created_at } ],
  "next_after_seq": <next seq or null>,
  "linked_conversations": [ { id, title, model, provider_id, messages: [...] }, ... ] // Only if include_linked=messages
}
```
Errors: 404 not_found, 500 internal_error.

### DELETE /v1/conversations/{id}
Soft delete (marks deleted_at). 204 or 404 not_found.

### GET /v1/conversations/{id}/linked
Get linked comparison conversations for a given conversation.
Returns conversations that are linked via model comparison mode.
Success 200:
```
{
  "conversations": [
    { id, title, model, provider_id, created_at, updated_at, ... },
    ...
  ]
}
```
Errors: 404 not_found, 500 internal_error.

### PUT /v1/conversations/{id}/messages/{messageId}/edit
Edits message content then forks conversation starting from that message; deletes subsequent messages in original.
Body:
- `content`: string OR mixed-content array (objects with type `text`, `image_url`, or `input_audio`)
Validation: must not be empty (at least one text, image, or audio element).
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
See [Chat Completions Spec](./backend_api_chat_completions_spec.md) for full details.
Supports multimodal inputs (text, images, audio) and image generation.

### POST /v1/chat/completions/stop
Abort an in-progress streaming response.
Request body: `{ "request_id": "..." }` or provide request ID via `x-client-request-id` header.
The request_id should match the one used when initiating the chat completion.
Success 200:
```
{
  "stopped": true|false
}
```
- `stopped: true` indicates the streaming response was successfully aborted.
- `stopped: false` indicates no matching active stream was found.
Errors: 400 missing_request_id (when no request_id provided in body or header).

### POST /v1/chat/judge
Evaluate and compare multiple model responses using a judge model.

**New API format (recommended):**
```
{
  "models": [                                 // All models to compare (2 or more)
    {
      "model_id": "gpt-4o",                   // Actual model name (used in judge prompt)
      "conversation_id": "uuid",
      "message_id": "uuid"
    },
    {
      "model_id": "claude-3-opus",
      "conversation_id": "uuid",
      "message_id": "uuid"
    }
  ],
  "judge_model": "model-id",                  // Judge model identifier
  "judge_provider_id": "provider-uuid",       // Optional: specific provider for judge model
  "criteria": "string"                        // Optional: evaluation criteria
}
```

**Legacy API format (comparison_models with implicit primary):**
```
{
  "conversation_id": "uuid",                  // Main conversation ID (implicit primary)
  "message_id": "uuid",                       // Primary assistant response
  "comparison_models": [                      // Comparison responses
    {
      "model_id": "model-key",                // Model identifier (optional)
      "conversation_id": "uuid",
      "message_id": "uuid"
    }
  ],
  "judge_model": "model-id",
  "judge_provider_id": "provider-uuid",
  "criteria": "string"
}
```

**Oldest legacy API format (pairwise only):**
```
{
  "conversation_id": "uuid",
  "comparison_conversation_id": "uuid",
  "message_id": "uuid",
  "comparison_message_id": "uuid",
  "judge_model": "model-id",
  "judge_provider_id": "provider-uuid",
  "criteria": "string"
}
```

Behavior:
- Returns cached evaluation if one exists for the same model set, judge model, and criteria
- Fetches all messages and the previous user prompt
- Sends evaluation request to judge model with JSON response format using actual model names
- Streams the judge's response as SSE events
- Stores evaluation result in database

Success 200 (SSE stream):
```
data: {"id":"judge-...","object":"chat.completion.chunk","choices":[{"delta":{"content":"..."},"index":0}]}
data: {"id":"judge-...","object":"chat.completion.chunk","choices":[{"delta":{},"index":0,"finish_reason":"stop"}]}
data: {"type":"evaluation","evaluation":{"id":"...","user_id":"...","conversation_id":"...","model_a_conversation_id":"...","model_a_message_id":"...","model_b_conversation_id":"...","model_b_message_id":"...","judge_model_id":"...","criteria":"...","score_a":8,"score_b":7,"winner":"gpt-4o","reasoning":"...","created_at":"...","models":[{"model_id":"gpt-4o","conversation_id":"...","message_id":"...","score":8}]}}
data: [DONE]
```

Evaluation object structure:
- `id` - Evaluation UUID
- `user_id` - User who created the evaluation
- `conversation_id` - Main conversation ID
- `model_a_conversation_id` / `model_a_message_id` - First message being evaluated
- `model_b_conversation_id` / `model_b_message_id` - Second message being compared
- `judge_model_id` - Model used for judging
- `criteria` - Optional evaluation criteria (null if not specified)
- `score_a` / `score_b` - Numeric scores for first two models (null if not provided by judge)
- `winner` - Actual model name (e.g., "gpt-4o") or "tie"
- `reasoning` - Judge's explanation
- `created_at` - ISO timestamp
- `models` - Array of per-model scores (model_id, conversation_id, message_id, score)

Errors:
- 400 bad_request (missing required fields or invalid judge_model)
- 401 unauthorized
- 404 not_found (messages not found)
- 500 internal_error
- 501 not_implemented (when persistence is disabled)

### DELETE /v1/chat/judge/:id
Delete an evaluation by ID.
Success 204: No content (evaluation deleted successfully).
Errors:
- 401 unauthorized
- 404 not_found (evaluation doesn't exist or doesn't belong to user)
- 500 internal_error

---

### GET /v1/tools
Returns registered tool specifications and API key status for tools requiring external API keys.
200:
```
{
  "tools": [ { type: "function", function: { name, description, parameters } }, ...],
  "available_tools": ["tool_name", ...],
  "tool_api_key_status": {
    "tool_name": { "hasApiKey": true|false, "requiresApiKey": true|false, "missingKeyLabel": "..." },
    ...
  }
}
```
The `tool_api_key_status` field indicates which tools require API keys and whether the user has configured them.
Errors: 500 { error: "Failed to generate tool specifications" }.

## System Prompts
Manage built-in and custom system prompts and selection per conversation.
All routes require auth.

### GET /v1/system-prompts
List built-ins and custom prompts.
200:
```
{
  "built_ins": [ { id, name, body, ... } ],
  "custom": [ { id, name, body, ... } ],
  "error": null | "partial_failure_reason"
}
```

### POST /v1/system-prompts
Create custom prompt.
Body (validated): `name` (string), `body` (string), optional metadata per schema.
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

## Files
File upload & retrieval for text-based files (user isolated). All routes require auth.

### GET /v1/files/config
Public config for client validation of file uploads.
200:
```
{
  "maxFileSize": <bytes>,
  "maxFilesPerMessage": <int>,
  "allowedExtensions": [".txt", ".md", ".json", ...],
  "allowedMimeTypes": ["text/plain", "application/json", ...],
  "uploadRateLimit": <int>,
  "storageLimitPerUser": <bytes>
}
```

### POST /v1/files/upload
Multipart form-data with field name `files` (1..maxFilesPerMessage).
Accepts text-based files (source code, markdown, JSON, etc.).
Returns:
- 200 `{ success: true, files: [ { id, url, filename, originalFilename, size, type, content } ] }`
- 207 Multi-Status if partial success: `{ success: true, files: [...], errors: [ { filename, error } ] }`
Errors: 400 no_files|upload_failed|invalid_file_type, 413 file_too_large|too_many_files, 500 upload_failed.

### GET /v1/files/{fileId}
Serve uploaded file (must belong to user). Handles ETag / 304.
Responses:
- 200 file data with appropriate content-type headers.
- 304 not modified.
- 400 invalid_file_id
- 404 not_found
- 500 serve_failed

## User Settings
Per-user settings for API keys and preferences. All routes require auth.

### GET /v1/user-settings
Get all user settings.
200:
```
{
  "tavily_api_key": "..." | null,
  "exa_api_key": "..." | null,
  "searxng_api_key": "..." | null,
  "searxng_base_url": "..." | null,
  "chore_model": "..." | null,
  "max_tool_iterations": <int> | null
}
```
Note: API keys are returned masked (e.g., `"sk-...xxxx"`) for security.

### PUT /v1/user-settings
Update user settings (API keys, preferences).
Body (all fields optional):
```
{
  "tavily_api_key?": "string" | null,
  "exa_api_key?": "string" | null,
  "searxng_api_key?": "string" | null,
  "searxng_base_url?": "string" | null,
  "chore_model?": "string" | null,
  "max_tool_iterations?": <int> | null
}
```
Success 200:
```
{
  "success": true,
  "updated": { ...updated fields with masked API keys }
}
```
Errors: 400 validation_error, 500 internal_server_error.

## Error Codes (Non-exhaustive)
- authentication: invalid_token, refresh_token_expired, invalid_refresh_token, electron_login_failed
- validation: validation_error, invalid_request, bad_request, weak_password, invalid_email
- rate_limiting: too_many_requests, registration_limit
- providers: conflict, not_found, disabled, test_failed, provider_error, bad_gateway, invalid_provider, refresh_in_progress
- conversations: not_implemented, internal_error, db_error
- chat: missing_request_id
- prompts: not_found, validation_error, internal_server_error
- images: no_files, file_too_large, too_many_files, invalid_image_id, serve_failed, upload_failed
- files: no_files, file_too_large, too_many_files, invalid_file_type, invalid_file_id, serve_failed, upload_failed

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
- 2025-10-16: Added initial documentation and health endpoints.
- 2025-11-23: Refined provider model fetching and error handling.
- 2026-01-07: Added specifications for image generation, linked conversations (model comparison), mixed-content messages (audio/images), and streaming abort.

---
For questions or proposing changes, open a PR updating this file alongside corresponding tests in `backend/__tests__/*`.
