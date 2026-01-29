# Backend Code Flow and Architecture

This document provides a comprehensive explanation of the ChatForge backend architecture, request flow, and key components.

## Table of Contents

1. [Entry Points and Server Initialization](#1-entry-points-and-server-initialization)
2. [Request Flow Architecture](#2-request-flow-architecture)
3. [Authentication and Middleware Flow](#3-authentication-and-middleware-flow)
4. [Request Handling - Chat API](#4-request-handling---chat-api)
5. [Database Access Patterns](#5-database-access-patterns)
6. [Tool System Architecture](#6-tool-system-architecture)
7. [Provider/Adapter System](#7-provideradapter-system)
8. [Persistence (Data Recording)](#8-persistence-data-recording)
9. [Streaming and Response Handling](#9-streaming-and-response-handling)
10. [Conversation Management](#10-conversation-management)
11. [Provider Routes - Configuration Management](#11-provider-routes---configuration-management)
12. [System Prompts](#12-system-prompts)
13. [Key Architectural Patterns](#13-key-architectural-patterns)

---

## 1. Entry Points and Server Initialization

**File**: `backend/src/index.js`

The main server file initializes Express with:
- CORS configuration with support for `x-session-id` header
- Global middleware stack (in order):
  1. **Session resolver** - Establishes session identity from headers/cookies
  2. **Request logger** - Logs all incoming requests
  3. **Rate limiting** - Protects against abuse
  4. **Authentication-protected routes** - Per-router auth middleware

### Key Initialization Flows

- **Database setup** - `getDb()` triggers migrations and seeders on first call
- **Retention worker** - Hourly cleanup job for conversation retention policies
- **Model cache worker** - Background refresh for model cache
  - Runs on `MODEL_CACHE_REFRESH_MS` interval (default 1 hour)
  - Refreshes model lists per user in background
  - Ensures model availability without blocking requests
- **Security headers** - HSTS, X-Frame-Options, etc. in production

---

## 2. Request Flow Architecture

The request processing follows a layered approach:

```
HTTP Request
    ↓
Session Resolution (session.js)
    ↓
Authentication Middleware (auth.js)
    ↓
Route Handler (e.g., chat.js, conversations.js)
    ↓
Request Validation & Sanitization
    ↓
Provider Selection & Context Building
    ↓
Persistence Initialization (SimplifiedPersistence)
    ↓
Tool Orchestration or Direct Proxy
    ↓
Streaming or JSON Response
    ↓
Database Persistence (checkpoint + final writes)
```

---

## 3. Authentication and Middleware Flow

**Location**: `backend/src/middleware/`

### Authentication Layers

#### 1. Session Resolver (`session.js`)
- **Precedence**: Header `x-session-id` > Cookie `cf_session_id` > Generate UUID
- Sets persistent HttpOnly cookie (365 days)
- Computes IP hash (SHA256 first 16 chars) for session tracking
- Does NOT require authentication

#### 2. Authentication Token (`auth.js`)
- **`authenticateToken()`** - Required auth, returns 401 if no token
  - Extracts JWT from `Authorization: Bearer <token>`
  - Verifies token with config secret
  - Validates user still exists in database
  - Populates `req.user` with id, email, displayName, emailVerified
  - Upserts session with user context
- **`optionalAuth()`** - Soft auth, sets `req.user = null` if no token
- **`getUserContext()`** - Delegated wrapper around `authenticateToken`

#### 3. User Data Isolation
- Every database query filters by `user_id`
- All database functions enforce `NOT NULL` constraints on `user_id`
- Prevents cross-user data access

---

## 4. Request Handling - Chat API

**Primary Route**: `/v1/chat/completions` (POST)
**Location**: `backend/src/lib/openaiProxy.js`

### Unified Handler Flow

```javascript
proxyOpenAIRequest(req, res)
  ├─ buildRequestContext()
  │  ├─ Resolve provider (DB or env-based)
  │  ├─ Extract conversation ID
  │  ├─ Sanitize incoming body
  │  ├─ Expand tool names to specs
  │  └─ Get default model if missing
  ├─ validateRequestContext()
  │  ├─ Check reasoning_effort, verbosity, etc.
  │  └─ Validate against model capabilities
  ├─ executeRequestHandler()
  │  ├─ Initialize SimplifiedPersistence
  │  ├─ Load conversation history (if applicable)
  │  ├─ Select execution path based on flags:
  │  │  ├─ Tools enabled → Tool orchestration
  │  │  │  ├─ Streaming → handleToolsStreaming()
  │  │  │  └─ JSON → handleToolsJson()
  │  │  └─ No tools → Direct proxy
  │  │     ├─ Streaming → handleRegularStreaming()
  │  │     └─ JSON → Direct JSON response
  │  ├─ Stream conversation metadata early
  │  ├─ Accumulate tool calls during streaming
  │  └─ Persist final message & tool calls
  └─ Update system prompt usage tracking
```

### Key Data Transformations

- System prompt is injected as first message
- Tool names (strings) expanded to full OpenAI specs
- Message history loaded from database with diff-based sync
- Response ID tracked for Responses API optimization
- **Prompt caching**: `addPromptCaching()` inserts cache breakpoints for Anthropic models
- **Reasoning format**: Transformed based on provider (e.g., `reasoning_format` parameter handling)

---

## 5. Database Access Patterns

**Location**: `backend/src/db/`

### Core Principle: User-Scoped Data Isolation

Every database function enforces user isolation:

```javascript
// Example pattern - conversations.js
export function getConversationById({ id, userId }) {
  if (!userId) throw new Error('userId is required');

  const db = getDb();
  return db.prepare(
    `SELECT ... FROM conversations
     WHERE id=@id AND user_id=@user_id AND deleted_at IS NULL`
  ).get({ id, user_id: userId });
}
```

### Key Tables

#### 1. **conversations** - Main conversation metadata
- **Fields**: id, session_id, user_id, title, provider_id, model, metadata (JSON)
- **Settings**: streaming_enabled, tools_enabled, reasoning_effort, verbosity
- **Tracks**: created_at, updated_at, deleted_at (soft delete)

#### 2. **messages** - Conversation messages
- **Fields**: conversation_id, role (user/assistant/tool), content, content_json
- **Tool data**: tool_calls (JSON array), function_call (legacy)
- **Reasoning**: reasoning_details (JSON), reasoning_tokens
- **Metadata**: seq (sequence number for ordering), finish_reason, status

#### 3. **tool_calls** - Tool invocation records
- **Links**: message_id → message
- **Data**: function name, arguments (JSON), index, id

#### 4. **tool_outputs** - Tool execution results
- **Links**: message_id → message, tool_call_id → tool_calls.id
- **Data**: output, status (success/error)

#### 5. **providers** - User-scoped API provider configurations
- **Fields**: id, name, provider_type, api_key, base_url, metadata (JSON)
- **User scoping**: user_id (enforced in all queries)
- **Flags**: enabled, is_default, deleted_at (soft delete)

#### 6. **users** - Authentication and user profiles
- **Fields**: id, email, display_name, email_verified

#### 7. **message_events** - Streaming events for progressive rendering
- **Links**: message_id -> messages
- **Fields**: type ('content', 'reasoning'), content, seq
- **Purpose**: Stores individual streaming chunks for replay/recovery

#### 8. **system_prompts** - Built-in and custom prompts
- **Fields**: id, name, content, is_builtin, user_id
- **User scoping**: Built-in prompts shared, custom prompts per user

#### 9. **journal** - Persistent AI memory entries
- **Fields**: id, user_id, content, created_at, updated_at
- **Purpose**: Enables AI to store and retrieve notes across conversations
- **User scoping**: Entries strictly scoped per user

#### 10. **user_settings** - Per-user settings and API keys
- **Fields**: id, user_id, key, value
- **Purpose**: Stores user-specific configuration (tool API keys, preferences)
- **Security**: API keys encrypted at rest

#### 11. **sessions** - Session tracking
- **Fields**: id, user_id, session_id, ip_hash, created_at, last_active_at
- **Purpose**: Track user sessions for security and analytics

### Access Patterns

1. **Reads** - Always filtered by `user_id AND deleted_at IS NULL`
2. **Writes** - Require explicit `user_id` parameter
3. **Updates** - Include `WHERE user_id=@userId` clause
4. **Soft Deletes** - Set `deleted_at` timestamp instead of removing

---

## 6. Tool System Architecture

**Location**: `backend/src/lib/tools/`

### Registry Pattern

```javascript
// tools/index.js
const registeredTools = [
  webSearchTool,
  webSearchExaTool,
  webSearchSearxngTool,
  webFetchTool,
  journalTool
];

const toolMap = new Map(); // name → tool implementation
export const tools = Object.fromEntries(toolMap.entries());
```

### Each Tool Exports

- **`name`** - Tool identifier
- **`spec`** - OpenAI-compatible function definition
- **`validate(args)`** - Input validation
- **`handler(args, context)`** - Async execution

### Tool Orchestration (`toolOrchestrationUtils.js`)

#### 1. Message History Building
- `buildConversationMessagesOptimized()` - Attempts Responses API optimization
- Falls back to full history if no previous_response_id
- Merges stored messages with request messages

#### 2. Tool Execution Flow
- `executeToolCall()` - Executes tool and returns output
- Passes user context for user-scoped tools
- Handles JSON parsing and validation errors gracefully

#### 3. Streaming Handlers
- `handleToolsStreaming()` - Real-time tool orchestration with SSE
- `handleToolsJson()` - Non-streaming tool orchestration

---

## 7. Provider/Adapter System

**Location**: `backend/src/lib/providers/`

### Provider Resolution (`index.js`)

```javascript
resolveProviderSettings(config, options)
  ├─ Check DB-backed provider (if providerId specified)
  ├─ Fall back to latest enabled provider
  └─ Fall back to env-based config

createProvider()
  ├─ Instantiate provider class (OpenAI/Anthropic/Gemini)
  └─ Inject resolved settings
```

### Provider Classes Hierarchy

- **BaseProvider** - Abstract base with common logic
  - `sendRequest()` - Send to upstream API
  - `supportsTools()` - Tool capability detection
  - `supportsReasoningControls()` - Advanced reasoning support
  - `getDefaultModel()` - Model resolution

- **OpenAIProvider** - OpenAI API (and OpenAI-compatible)
  - Supports: tools, reasoning_effort, verbosity
  - Custom logic for model filtering

- **AnthropicProvider** - Claude API
  - Supports: different parameter names and formats

- **GeminiProvider** - Google Gemini API
  - Supports: its own API format

### Adapter System (`adapters/`)

1. **BaseAdapter** - Request normalization
2. **ChatCompletionsAdapter** - Chat API handling
3. **ResponsesApiAdapter** - OpenAI Responses API (state management optimization)

---

## 8. Persistence (Data Recording)

**Location**: `backend/src/lib/simplifiedPersistence.js`

### Architecture: Hybrid Checkpoint Persistence

The persistence system uses a hybrid approach combining draft checkpoints during streaming with final writes on completion, enabling recovery if clients disconnect mid-stream.

### Initialization

```javascript
SimplifiedPersistence
  ├─ initialize(conversationId, sessionId, userId, req, bodyIn)
  ├─ _handleConversation() - Create or retrieve conversation
  ├─ _processMessageHistory() - Sync message diffs
  └─ _setupAssistantRecording() - Prepare for response
```

### Checkpoint System

The checkpoint system enables mid-stream recovery:

- **`shouldCheckpoint()`** - Determines if checkpoint needed based on:
  - Time threshold: 3000ms since last checkpoint
  - Size threshold: 500+ characters accumulated since last checkpoint
- **`performCheckpoint()`** - Writes draft message to database during streaming
- **`createDraftMessage()`** - Creates initial draft with `status='streaming'`

### Content Accumulation

- `appendContent(delta)` - Buffer assistant message chunks
- `appendReasoningText(delta)` - Buffer reasoning tokens
- `addToolCalls(toolCalls)` - Buffer tool calls
- `addToolOutputs(toolOutputs)` - Buffer tool outputs

### Finalization

- `recordAssistantFinal(finishReason, responseId)` - Write final assistant message
- `persistToolCallsAndOutputs()` - Write tool data to DB
- Tool outputs stored as separate messages with role="tool"
- Updates draft message status from `'streaming'` to `'complete'`

### Streaming Integration

- Early metadata emission (conversation ID before chunks)
- Tool call accumulation during streaming
- Periodic checkpoint writes during long streams
- Final database write at stream end
- Recovery of partial content if client disconnects

---

## 9. Streaming and Response Handling

**Location**: `backend/src/lib/streamingHandler.js`

### Regular Streaming (`handleRegularStreaming`)

#### 1. Setup
- Set SSE headers (`text/event-stream`)
- Emit conversation metadata early

#### 2. Data Processing
- Parse SSE chunks from upstream
- Pass through to client in real-time
- Accumulate in persistence buffer

#### 3. Capture Points
- `finish_reason` - Tracked per chunk
- `reasoning_content` - Captured from delta
- `tool_calls` - Accumulated with index tracking
- `response_id` - Captured from any chunk
- `reasoning_tokens` - Captured from usage

#### 4. Finalization
- On stream end: Call `recordAssistantFinal()`
- On stream error: Call `markError()`
- On client disconnect: Mark error

### Metadata Early Emission

```javascript
// Client receives conversation ID immediately
const conversationMeta = getConversationMetadata(persistence);
writeAndFlush(res, `data: ${JSON.stringify(conversationMeta)}\n\n`);
```

### Message Events Streaming

- **Event types**: `'content'` for regular text, `'reasoning'` for thinking content
- **Progressive rendering**: Events stored in `message_events` table for replay
- **Generated images**: DALL-E image responses handled with URL extraction

### Stream Abort Capability

- **Endpoint**: `POST /v1/chat/completions/stop`
- **Registry**: Active streams tracked by conversation ID
- **Client disconnect**: Handled via `req.on('close')` listener
- **Cleanup**: Removes stream from registry, triggers checkpoint persistence

### Client Disconnect Handling

```javascript
req.on('close', () => {
  // Persist buffered content as checkpoint
  // Remove from active stream registry
  // Mark message with appropriate status
});
```

---

## 10. Conversation Management

**Location**: `backend/src/db/conversations.js`

### Core Operations

#### 1. Create
- Generate UUID for ID
- Store with user_id, session_id
- Store settings snapshot (streaming_enabled, tools_enabled, etc.)

#### 2. Retrieve
- Always scoped by user_id
- Parse JSON metadata
- Extract active_tools from metadata

#### 3. Update
- Metadata updates (system_prompt, active_tools)
- Settings updates (streaming, tools, quality, reasoning, verbosity)
- Title generation (fire-and-forget background task)

#### 4. Fork
- Create new conversation with `parent_conversation_id` reference
- Copy all metadata from original
- Copy messages up to specified sequence number
- Enables exploration of alternative conversation paths

#### 5. Linked Conversations
- **Field**: `parent_conversation_id` for forking relationships
- **Model comparison**: Multiple conversations linked for side-by-side evaluation
- **Endpoint**: `GET /v1/conversations/:id/linked` - Retrieve linked conversations

#### 6. Soft Delete
- Set deleted_at timestamp
- Prevents retrieval in normal queries

### Pagination Pattern

- Cursor-based using created_at + id
- Handles 1-100 item limits
- Maintains order consistency

---

## 11. Provider Routes - Configuration Management

**Location**: `backend/src/routes/providers.js`

### CRUD Operations - All user-scoped

1. **GET /v1/providers** - List user's providers
2. **GET /v1/providers/:id** - Get specific provider
3. **POST /v1/providers** - Create new provider
4. **PUT /v1/providers/:id** - Update provider
5. **DELETE /v1/providers/:id** - Soft delete provider
6. **POST /v1/providers/:id/default** - Set as default
7. **GET /v1/providers/:id/models** - Fetch available models from provider's API

### Model Fetching

- Server-side only (API keys not exposed to client)
- Filters OpenRouter models (last 1 year only)
- Applies model filters from provider metadata
- Comprehensive error handling for connectivity issues

---

## 12. System Prompts

**Location**: `backend/src/lib/toolOrchestrationUtils.js`

### Resolution Priority (Async)

1. Inline override (in messages array)
2. Request parameter (system_prompt/systemPrompt)
3. Active system prompt ID (built-in or custom)
4. Legacy stored system_prompt
5. Empty string

### Prompt Structure

```
<system_instructions>
[Today's date]
[Shared modules for enabled tools]
</system_instructions>

<user_instructions>
[Prompt content]
</user_instructions>
```

### Shared Modules

Loaded based on enabled tools, wrapped with model filtering

---

## 13. Key Architectural Patterns

### Separation of Concerns

- Routes handle HTTP concerns
- Database layer enforces user isolation
- Persistence layer buffers and finalizes writes
- Tool system is modular and registry-based
- Providers abstract upstream API differences

### Explicit Dependencies

- Provider config injected into handlers
- User context passed through request object
- Database connection singleton via `getDb()`

### Composition Over Inheritance

- SimplifiedPersistence composes ConversationManager, ConversationValidator, etc.
- Providers use adapter pattern for API differences
- Tool system uses registry rather than inheritance

### User Data Isolation

- Enforced at query level (WHERE user_id=...)
- Enforced at parameter level (required userId)
- NOT NULL constraints in schema
- Every function validates userId before access

### Checkpoint-Based Recovery

- Draft messages created at stream start with `status='streaming'`
- Periodic checkpoints based on time (3000ms) or size (500 chars)
- Recovery of partial content on client disconnect
- Final status update to `'complete'` on successful finish

### Per-User Model Caching

- Model lists cached per user with TTL
- Background refresh worker updates cache proactively
- Avoids blocking requests on cache expiry
- Provider-specific model filtering applied

### Reasoning Format Handling

- `reasoning_format` parameter supported across compatible models
- Provider-specific transformations in adapter layer
- Reasoning content streamed separately from main content

### Conversation Forking

- `parent_conversation_id` tracks fork relationships
- Messages copied up to specified sequence number
- Independent conversation history after fork point
- Linked conversations for model comparison mode

### Stream Abort Registry

- Active streams tracked by conversation ID
- `POST /v1/chat/completions/stop` endpoint for client-initiated abort
- Automatic cleanup on client disconnect
- Checkpoint persistence triggered before cleanup

---

## Summary

The ChatForge backend implements a sophisticated **OpenAI-compatible proxy** with:

1. **Layered Security** - Session, authentication, and per-user data isolation
2. **Flexible Request Processing** - Adapts to tool orchestration vs. direct proxy based on flags
3. **Hybrid Checkpoint Persistence** - Draft checkpoints during streaming with final writes on completion
4. **Multi-Provider Support** - Factory pattern for different AI providers
5. **Real-time Streaming** - SSE-based with early metadata emission and abort capability
6. **Modular Tools** - Registry-based, decoupled tool system (web search, fetch, journal)
7. **User-Scoped Data** - Every operation filtered by authenticated user
8. **Conversation Settings Snapshots** - Complete state captured per conversation for reproducibility
9. **Conversation Forking** - Fork conversations at any point to explore alternative paths
10. **Model Comparison** - Linked conversations for side-by-side model evaluation
11. **Stream Recovery** - Checkpoint-based recovery for client disconnects
12. **Prompt Caching** - Automatic cache breakpoints for Anthropic models

The architecture prioritizes **separation of concerns**, **type safety**, and **user data isolation** while maintaining **OpenAI API compatibility** and **production reliability**.
