# Persistence Simplification Tasks

> Scope: implement Phase 1 (Final-only writes) and Phase 2 (Single facade), then stage follow-ups.

## Phase 1 — Final-only Writes
- Backend: add helper to insert final assistant message
  - db/index.js: add `insertAssistantFinal({ conversationId, content, seq, finishReason })` or reuse existing finalize path without draft row.
- Backend: stop creating assistant drafts and periodic delta appends
  - lib/persistenceHandler.js: remove usage of `createAssistantDraft`, `appendAssistantContent`, interval-based flushing for the non-tool path.
  - lib/openaiProxy.js: buffer assistant deltas in memory only; on completion call `insertAssistantFinal` and set finish reason; on error call `markAssistantError` if a user message was persisted.
- Tests: update expectations to assert final persistence only
  - backend/__tests__: adjust any tests depending on intermediate `streaming` status rows.
- Docs: update backend/README.md persistence section to describe final-only strategy.

## Phase 2 — Single Persistence Facade
- Choose one module (recommended: keep `PersistenceManager`) and fold logic into it.
  - Move minimal helpers (`recordUserMessage`, `recordAssistantFinal`, `markError`, `cleanup`).
  - Replace imports in `openaiProxy.js`, `streamingHandler.js`, and tool orchestration paths.
  - Remove unused exports from `persistenceHandler.js` or delete the file if fully migrated.
- Tests: ensure both streaming and non-streaming paths pass.

## Phase 3 — Schema Simplification (tracked, not executed yet)
- Decide between Turns table or Messages JSON.
- Draft migration plan and compatibility changes to list/get/delete routes.
- Update queries and pagination to use `seq`/`id` cursors.

## Phase 4 — API Surface Trim (tracked)
- Remove or deprecate edit+fork endpoints and helpers if not required.
- Consider hard delete with cascade if soft delete isn’t needed.

## Phase 5 — Retention & Dev Experience (tracked)
- Replace JSON `metadata.pinned` with a simple `pinned INTEGER` if retention is kept.
- Optional dev `filejson:` backend for local persistence.
- Add simple counters/logs for persisted messages and errors.

## Rollback Plan
- Revert to prior commit if any production regression occurs.
- Feature flag: keep `PERSIST_TRANSCRIPTS` gate; optionally add `PERSIST_STREAMING_DELTAS` (default false) if we need an escape hatch.

## Done Criteria
- Phase 1+2 merged with green tests; unchanged streaming UX; DB writes reduced to one per assistant message.
- Documentation updated; clear path for Phase 3+.

