# Conversation History Persistence — Delivery Plan

Classification: Medium-to-large feature. Deliver incrementally over small sprints with a feature flag.

Scope: Introduce opt-in conversation history persistence, streaming-safe writes, history endpoints, retention/deletion, and minimal observability — without changing the existing OpenAI-compatible proxy behavior.

Guardrails:
- PERSIST_TRANSCRIPTS defaults to false; when false, no writes occur and history endpoints return 501.
- Strip any non-upstream fields/headers before proxying to providers.

Sprints overview:
- Sprint 1: Foundations (persistence off by default)
- Sprint 2: Streaming persistence and read paths
- Sprint 3: Retention, deletion, and polish

---

Sprint 1 — Foundations (enable persistence off by default)
Objectives:
- Establish database schema and connection wiring for Postgres and local SQLite.
- Implement session identification.
- Add minimal conversation creation and fetch metadata.
- Ensure proxy safety: strip custom fields/headers before forwarding upstream.
- Everything gated behind PERSIST_TRANSCRIPTS=false by default.

Scope:
- DB schema setup: sessions, conversations, messages.
- Configuration flags and validation: DB_URL, PERSIST_TRANSCRIPTS, limits.
- Session resolver: honor x-session-id header or cf_session_id cookie (header wins).
- Endpoints (minimal):
  - POST /v1/conversations
  - GET /v1/conversations/:id (metadata only or stub messages)
- Proxy: remove conversation-related fields/headers before upstreaming.

Deliverables:
- Migrations for the three tables and indexes.
- Config loader with sane defaults and validation errors on misconfiguration.
- Session resolver middleware.
- Two minimal endpoints working under the feature flag.
- Unit/integration tests for schema writes and session identification precedence.
- Developer docs for local setup (including SQLite).

Acceptance criteria:
- With PERSIST_TRANSCRIPTS=false, history endpoints return 501 and no writes occur.
- With PERSIST_TRANSCRIPTS=true and a valid DB_URL, POST /v1/conversations creates a record and returns id/title/created_at.
- GET /v1/conversations/:id returns metadata for owned conversation (session-scoped).
- Proxy forwards requests without any added history fields/headers.
- Tests pass in CI.

Estimate:
- 1.0–1.5 weeks for 1–2 engineers.

Risks & mitigations:
- Cross-DB differences (JSON, timestamps): keep SQL conservative, test both backends locally.
- Config drift: centralized config loader with validation and clear errors.

---

Sprint 2 — Streaming persistence and read paths
Objectives:
- Persist user messages on chat requests.
- Implement streaming-safe assistant message lifecycle with batching and finalization.
- Provide list and paginated read endpoints.

Scope:
- Write path integration:
  - Persist user message when conversation_id is present on chat requests.
  - Create assistant message with status=streaming and append deltas; finalize with finish_reason on [DONE].
  - On errors or client aborts, mark status=error and retain partial content.
  - Monotonic seq assignment per conversation.
- Read path:
  - GET /v1/conversations (cursor + limit; newest first; excludes soft-deleted by default).
  - GET /v1/conversations/:id with messages and pagination (?after_seq=&limit=).
- Limits and guardrails:
  - Enforce MAX_CONVERSATIONS_PER_SESSION and MAX_MESSAGES_PER_CONVERSATION with clear errors.
  - HISTORY_BATCH_FLUSH_MS for write flush cadence; also flush by size threshold.

Deliverables:
- Message persistence service handling append/flush/finalize with batching.
- Updated proxy flow wiring to invoke persistence when enabled.
- List and fetch endpoints with pagination utilities.
- Frontend notes/hooks: session cookie bootstrap and passing conversation_id through requests.
- Tests: streaming append correctness, ordering, pagination, limits, error paths.

Acceptance criteria:
- During streaming, content is appended in batches; upon [DONE], status becomes final and finish_reason recorded when available.
- Pagination returns stable ordering by seq; next cursor/after_seq yields non-overlapping pages.
- Limits are enforced with 4xx errors and safe messaging.
- Concurrent messages for the same conversation preserve seq monotonicity.

Estimate:
- 1.0–2.0 weeks (streaming is the trickiest portion).

Risks & mitigations:
- Excessive write amplification: batching by time and size; consider coalescing updates.
- Concurrency races on seq: use atomic counters/transactions per conversation.
- Provider-specific streaming shapes: normalize delta handling behind an adapter.

---

Sprint 3 — Retention, deletion, and polish
Objectives:
- Implement soft delete and retention sweeping.
- Add optional observability and performance hardening.
- Finalize privacy guarantees when the feature flag is off.

Scope:
- DELETE /v1/conversations/:id sets deleted_at; default lists exclude unless include_deleted=1.
- Retention job: hard-delete conversations older than RETENTION_DAYS (skip pinned via metadata).
- Observability (optional): tokens_in/out, finish_reason capture; basic health metrics.
- Performance: tune batching thresholds and backpressure; verify indexes and query shapes.

Deliverables:
- Soft delete endpoint with proper scoping.
- Retention worker/cron with idempotent operation and logging.
- Health/metrics addons (non-sensitive counts).
- Docs for Docker Postgres option and example DB_URLs.

Acceptance criteria:
- Soft-deleted conversations are hidden from default lists and cannot be mutated unless restored (if supported) or included explicitly.
- Retention removes data beyond retention window without impacting recent items; dry-run mode for local verification is documented.
- With PERSIST_TRANSCRIPTS=false, history endpoints remain 501 and no background jobs write.

Estimate:
- 0.5–1.0 week.

Risks & mitigations:
- Retention deletes active data: use indexed queries with clear cutoffs; add dry-run and small batch deletes.
- Background worker reliability: idempotent operations and safe retries.

---

Story-level breakdown (sample)
- ADR: choose migration/ORM approach (e.g., Prisma vs Kysely/Knex) and document cross-DB constraints.
- Implement config loader and validation.
- Implement session resolver middleware (cookie/header precedence).
- Implement conversation create/list/get/delete handlers with scoping and pagination.
- Implement message persistence service (append, flush, finalize, error).
- Integrate with SSE streaming pipeline; ensure finalize-on-[DONE].
- Pagination utilities with cursor scheme and supporting indexes.
- Limits enforcement and error shaping.
- Retention worker and idempotent deletes.
- Observability: tokens_in/out and basic counters, wired to health endpoint.

Dependencies
- Decision on migration/ORM tool (ADR).
- Access to Postgres for validation (local Docker).
- CI that can run both SQLite and Postgres tests (if feasible).

Key risks to call out early
- Streaming persistence correctness (batching boundaries, finalize-on-[DONE], client disconnects).
- Ordering/seq under concurrency (parallel messages, retries).
- Cross-database behavior (SQLite vs Postgres differences).
- Privacy: ensuring “persistence off” is airtight and discoverable.
- Performance: avoiding too-frequent writes during streaming.
- Pagination and indexing for large datasets.

Milestones
- M1 (end Sprint 1): Feature-flagged create/fetch with DB wiring; no persistence when flag off.
- M2 (end Sprint 2): End-to-end streaming persistence with list/read; limits enforced.
- M3 (end Sprint 3): Retention, soft delete, and polish; minimal observability.
