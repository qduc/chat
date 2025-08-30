# Persistence Simplification Plan

Goal: reduce complexity and write load of chat history while preserving OpenAI-compatible behavior and streaming UX.

## Current Issues
- Dual abstractions: `persistenceHandler` and `PersistenceManager` overlap and increase surface area.
- Draft + timer-based delta appends: creates assistant drafts and periodically appends deltas during streams, raising write frequency and failure modes.
- Schema heaviness: `sessions`, `conversations`, `messages` with many rarely used columns; pagination uses `created_at` cursor.
- Advanced features early: message edit+fork and soft delete add branching logic and extra endpoints.

## Guiding Principles
- Favor correctness and minimal diffs first; ship value incrementally.
- Keep API responses compatible for the frontend and OpenAI shape.
- Prefer final-only writes to the DB; reduce hot-path I/O.
- Consolidate to one persistence module entry point.

## Phased Plan

### Phase 1 — Final-only Writes (Low-risk, high ROI)
- Stop timer-based `appendAssistantContent` during streams.
- Continue writing the last user message immediately (as today).
- Buffer assistant text in-memory only; after completion:
  - Insert one assistant message with final content and finish reason.
  - Mark errors on failure paths.
- Keep schema and routes unchanged for compatibility.

Success criteria:
- Streaming to client remains unchanged.
- DB writes per assistant message drop from many to one.
- All tests stay green or require minimal updates focused on persistence timing.

### Phase 2 — Single Persistence Facade
- Collapse to one module (pick `PersistenceManager` or `persistenceHandler`, not both).
- Provide a narrow API: `initialize`, `recordUserMessage`, `recordAssistantFinal`, `markError`, `cleanup`.
- Remove unused exports and duplicate plumbing in callers.

Success criteria:
- `openaiProxy` and orchestration paths depend on a single, small interface.
- Code size and cognitive load reduced; fewer error branches.

### Phase 3 — Schema Simplification (choose one)
Option A: Turns table
- Replace two-row model with `turns(id, conversation_id, seq, user_text, assistant_text, created_at)`.
- Map list/get APIs to turns; drop `messages` table usage.

Option B: Messages JSON
- Keep `conversations`, add `messages_json TEXT` (JSON array of turns).
- Append-only writes on completion; read whole convo for UI pages (OK for MVP scale).

Common cleanups (either option):
- Drop `sessions` table; keep `session_id` on `conversations` only.
- Remove unused columns (tokens, tool_calls, function_call, content_json, updated_at).
- Paginate by `seq`/`id` not `created_at`.

Success criteria:
- Simpler queries; fewer joins; clearer invariants.
- No regression for list/get/delete endpoints used by the frontend.

### Phase 4 — API Surface Trim
- Deprecate or remove message edit+fork endpoints if not needed.
- Keep soft delete only if the UI uses it; otherwise hard delete with cascade.
- Update frontend helpers and tests to use `seq`-based pagination.

Success criteria:
- Smaller API; easier to maintain; unchanged UX.

### Phase 5 — Retention and Dev Experience
- Retention sweep: operate on conversations by age and optional `pinned` integer column.
- Optional dev mode: allow `DB_URL=filejson:./backend/data/` to persist conversations to JSON files to simplify local runs.
- Add observability counters for persisted messages and errors.

Success criteria:
- Clear retention behavior; easier local onboarding; better visibility.

## Risks and Mitigations
- Risk: Losing partial assistant text on crash mid-stream.
  - Mitigation: final-only writes accept this for simplicity; consider short-lived file buffer in future if needed.
- Risk: Test expectations on streaming-driven persistence timing.
  - Mitigation: adapt tests to assert final state only; avoid relying on intermediate DB content.
- Risk: Schema changes breaking queries.
  - Mitigation: ship Phase 1–2 first; introduce schema changes behind clearly updated queries and tests.

## Rollout
- Phase 1 and 2 in one PR; keep behavior flags stable.
- Phase 3+ in separate PRs with migration notes.
- Update README/docs as public API or env semantics change.

