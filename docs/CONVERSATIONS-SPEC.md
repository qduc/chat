# Conversation History Persistence Spec (MVP)

Status: Draft — 2025-08-18

## Summary
Add first-class support for saving and retrieving past conversations in a database while keeping the existing OpenAI-compatible proxy behavior and streaming. The feature must be opt-in, privacy-aware, and compatible with a future auth layer.

## Goals
- Persist chat conversations and messages so users can revisit past sessions.
- Support both anonymous sessions (no auth) and future authenticated users.
- Work with streaming responses: persist assistant messages as they stream and finalize on completion.
- Keep the proxy’s OpenAI-compatible API intact; introduce new endpoints for history and optional fields/headers to link requests to a conversation.
- Provide a clear local dev path (Docker Postgres or SQLite) and retention controls.

## Non‑Goals (MVP)
- Implementing auth/identity beyond anonymous sessions.
- Full-text search or vector search over messages.
- Cross-tenant ACLs or orgs.
- Multi-tenant billing.

## Terminology
- Session: Anonymous browser/client identity (UUID), set by frontend as a cookie (e.g., cf_session_id) or header.
- User: Future authenticated principal; nullable in MVP.
- Conversation: A named thread containing ordered messages.
- Message: A single entry in a conversation with role=user|assistant|system|tool.

## High-level Design
- Ownership: A conversation belongs to either a user_id (future) or a session_id (anonymous). Both may be stored; at least one must be present.
- Write path: When frontend starts a conversation, it calls Create Conversation or provides conversation_id in the chat completion request. The backend persists the user message, forwards to provider, and persists assistant message while streaming as draft/streaming, then finalizes on [DONE].
- Read path: List conversations for the current session/user; fetch a conversation with messages (paginated).
- Privacy: Persistence is disabled by default. When enabled, retention policies and scrubbing options apply.

```mermaid
sequenceDiagram
    participant UI as Frontend
    participant API as Backend (Express)
    participant DB as DB
    participant LLM as OpenAI-compatible

    UI->>API: POST /v1/conversations (title optional)
    API->>DB: insert conversation (session_id)
    API-->>UI: { id, ... }

    UI->>API: POST /v1/chat/completions { messages, conversation_id, stream:true }
    API->>DB: insert message (user)
    API->>LLM: proxy request
    LLM-->>API: SSE deltas
    API->>DB: upsert assistant message (status=streaming, append content)
    LLM-->>API: [DONE]
    API->>DB: update assistant message (status=final)
    API-->>UI: stream ends
```

## Data Model (SQL-oriented)
Target prod DB: Postgres. Dev: Postgres via Docker, or SQLite fallback for local.

- sessions
  - id UUID PK
  - user_id UUID NULL (future)
  - created_at TIMESTAMPTZ DEFAULT now()
  - last_seen_at TIMESTAMPTZ
  - user_agent TEXT NULL, ip_hash TEXT NULL
  - UNIQUE (id)

- conversations
  - id UUID PK
  - session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE
  - user_id UUID NULL
  - title TEXT NULL
  - model TEXT NULL
  - metadata JSONB DEFAULT '{}'::jsonb
  - created_at TIMESTAMPTZ DEFAULT now()
  - updated_at TIMESTAMPTZ DEFAULT now()
  - deleted_at TIMESTAMPTZ NULL
  - INDEX (session_id, created_at DESC)

- messages
  - id BIGSERIAL PK
  - conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE
  - role TEXT CHECK (role IN ('system','user','assistant','tool')) NOT NULL
  - status TEXT CHECK (status IN ('draft','streaming','final','error')) NOT NULL DEFAULT 'final'
  - content TEXT NOT NULL DEFAULT ''
  - content_json JSONB NULL  -- optional richer structure
  - seq INT NOT NULL          -- monotonic per conversation
  - parent_message_id BIGINT NULL REFERENCES messages(id)
  - tokens_in INT NULL, tokens_out INT NULL, finish_reason TEXT NULL
  - tool_calls JSONB NULL, function_call JSONB NULL
  - created_at TIMESTAMPTZ DEFAULT now()
  - updated_at TIMESTAMPTZ DEFAULT now()
  - UNIQUE (conversation_id, seq)
  - INDEX (conversation_id, id)

Notes:
- seq is assigned by API to maintain stable ordering even with streaming.
- content_json allows storing multimodal messages later.

## API Surface (MVP additions)
The existing OpenAI-compatible proxy remains unchanged. We add optional parameters and new history endpoints.

### Identification
- Anonymous session via cookie `cf_session_id` (UUID v4) or header `x-session-id`. If both provided, header wins.
- Future user: `x-user-id` header (string) may be provided; server trusts only when auth is implemented.

### Optional fields for chat proxy
- Request body additions (optional; ignored by upstream):
  - conversation_id: string (UUID) — associates the request with a conversation. If absent and persistence enabled, server may create one.
- Optional headers:
  - x-conversation-id: same semantics as body field.

The proxy must strip these before forwarding upstream.

### New endpoints
- POST /v1/conversations
  - Body: { title?: string, model?: string }
  - Response: { id, title, created_at }
- GET /v1/conversations?cursor&limit
  - Lists conversations for current session/user, newest first.
  - Response: { items: [...], next_cursor: string|null }
- GET /v1/conversations/:id
  - Returns conversation metadata and first page of messages (or specify pagination: ?after_seq=&limit=)
  - Response: { id, title, model, messages: [{ id, seq, role, content, status, created_at }], next_after_seq }
- DELETE /v1/conversations/:id
  - Soft delete: sets deleted_at; subsequent lists exclude unless include_deleted=1.
- POST /v1/conversations/:id/messages
  - Body: { role: 'user'|'system', content: string }
  - Response: { id, seq, ... }

Rate limiting: apply existing per-IP limiter; later migrate to per-session/user.

### Streaming persistence details
- On receipt of a streaming response, create or upsert an assistant message:
  - Insert assistant message with status=streaming, content=''.
  - Append delta content as it arrives (batched to avoid excessive writes; e.g., flush every 250ms or 512 chars).
  - On [DONE], set status=final, finish_reason as provided.
- If stream errors or client aborts, mark status=error and keep partial content (configurable).

## Configuration
Backend env (extend SECURITY.md list):
- DB_URL: connection string (postgres://... or file:./dev.db for SQLite)
- PERSIST_TRANSCRIPTS: boolean (default: false)
- RETENTION_DAYS: integer (default: 30)
- MAX_CONVERSATIONS_PER_SESSION: integer (default: 100)
- MAX_MESSAGES_PER_CONVERSATION: integer (default: 1000)
- HISTORY_BATCH_FLUSH_MS: integer (default: 250)

Behavior:
- If PERSIST_TRANSCRIPTS=false, history endpoints return 501 Not Implemented and proxy does not write to DB.

## Local Development
Two options:
1) Docker Postgres
- Add to docker-compose.dev.yml a postgres service with volume, expose 5432.
- Example DB_URL: postgres://postgres:postgres@localhost:5432/chatforge
2) SQLite (simplest)
- Use file at backend/data/dev.db and a lightweight migration tool. Avoid in prod.

Migration strategy (tool TBD):
- Option A: Prisma (developer-friendly, cross-db)
- Option B: Kysely or Knex (SQL-first)
- Decision to be captured in an ADR; this spec provides SQL shape irrespective of tool.

## Frontend Integration (notes)
- On first load, ensure a session id: if no cf_session_id cookie, generate UUID and set cookie (HttpOnly not required for client JS access; consider secure in prod).
- Conversation list view (basic): call GET /v1/conversations to show titles; allow select to load messages.
- Chat flow:
  - When starting new chat, POST /v1/conversations to get id; store in client state.
  - Include conversation_id in POST /v1/chat/completions body or x-conversation-id header.
  - For user turns not using the proxy endpoint, optionally POST /v1/conversations/:id/messages first to persist the user message; the proxy may also persist user messages automatically when receiving the request.

## Retention & Deletion
- Soft delete conversations (deleted_at). Messages remain but excluded from default lists.
- Retention job deletes (hard) conversations older than RETENTION_DAYS (unless pinned in metadata).
- Redaction: optionally strip system prompts from persisted copies via config (future toggle).

## Security & Privacy
- Default is no persistence, matching current SECURITY.md.
- When enabled, document to users that transcripts are stored locally.
- Do not persist provider API keys or headers; strip extra fields before proxying upstream.
- CORS and origin restrictions continue to apply.

## Backward Compatibility
- If no conversation_id is provided and persistence is disabled, behavior is unchanged.
- If persistence is enabled and no conversation_id is provided, server may auto-create one and return it via a response header x-conversation-id (non-breaking addition).

## Observability (optional)
- Record tokens_in/out and finish_reason when available.
- Expose counts via GET /healthz additions (non-sensitive aggregate).

## Open Questions / Future Work
- Choose ORM/migration tool (create ADR).
- Schema evolution for attachments and tools.
- Per-user auth integration and ACLs.
- End-to-end export/import of conversations (JSONL).
