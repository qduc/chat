# Frontend Architecture Cleanup Plan

## Goal
Reduce architectural risk in the frontend by shrinking `useChat` and `ChatV2` responsibilities without changing user-facing behavior.

## Scope
- `frontend/hooks/useChat.ts`
- `frontend/components/ChatV2.tsx`
- Related tests in `frontend/__tests__/`

Out of scope:
- Feature additions unrelated to architecture cleanup
- Backend API contract changes

## Success Criteria
- `useChat` external API remains backward-compatible during migration.
- Request lifecycle transitions are owned by a single flow (idle/streaming/error/reset).
- Conversation hydration logic is isolated from send pipeline logic.
- `ChatV2` no longer owns heavy side-effect orchestration directly (URL sync, resize, scroll controls split into dedicated hooks).
- Existing tests pass and new characterization tests cover high-risk flows.

## Work Plan

### Phase 0: Safety Net (Characterization Tests)
Status: `todo`

- [ ] Add/expand tests for send gating parity (text/image/file/audio, Enter vs Send button).
- [ ] Add tests for send pipeline failure recovery (no stuck streaming state).
- [ ] Add tests for compare-mode send/retry behavior.
- [ ] Add tests for `selectConversation` hydration behavior and linked conversation mapping.
- [ ] Run: `cd frontend && npm test -- --runInBand`.

Exit criteria:
- High-risk behaviors are pinned by tests before refactoring internals.

### Phase 1: Extract Send Pipeline
Status: `done`

- [x] Create `useMessageSendPipeline` (or similarly named hook/module).
- [x] Move payload building, streaming events, response finalization, and failure handling from `useChat` into the new module.
- [x] Keep `useChat` return shape unchanged.
- [x] Ensure one lifecycle owner for streaming state transitions.
- [x] Update tests to target extracted unit(s) + keep integration tests in `useChat`.

Exit criteria:
- `useChat` delegates send orchestration instead of implementing the full pipeline inline.

### Phase 2: Extract Conversation Hydration
Status: `todo`

- [ ] Create `useConversationHydration` for `selectConversation` and linked conversation assembly.
- [ ] Move model/provider/tool/settings restoration logic into hydration module.
- [ ] Keep conversation selection behavior unchanged.
- [ ] Add focused tests for hydration edge cases.

Exit criteria:
- `selectConversation` logic in `useChat` becomes thin orchestration only.

### Phase 3: Extract Draft Persistence
Status: `todo`

- [ ] Create `useDraftPersistence` for restore/save behavior.
- [ ] Move draft effects out of `useChat`.
- [ ] Preserve current user-scoped draft behavior.

Exit criteria:
- Draft persistence no longer implemented inline in `useChat`.

### Phase 4: Decompose `ChatV2` Controller Logic
Status: `todo`

- [ ] Extract URL sync behavior into `useConversationUrlSync`.
- [ ] Extract right-sidebar resize behavior into `useResizableRightSidebar`.
- [ ] Extract scroll-button visibility/controls into `useScrollControls`.
- [ ] Keep `ChatV2` focused on rendering/wiring.

Exit criteria:
- `ChatV2` is substantially smaller and side-effect logic is hook-based.

### Phase 5: Cleanup + Hardening
Status: `todo`

- [ ] Remove duplicate logic paths discovered during extraction.
- [ ] Add lightweight architecture notes to `docs/frontend_code_flow.md`.
- [ ] Run lint + tests:
  - `cd frontend && npm run lint`
  - `cd frontend && npm test -- --runInBand`

Exit criteria:
- Green CI locally and docs updated to reflect new structure.

## Tracking

### Progress Snapshot
- Overall status: `in progress`
- Current phase: `Phase 1 complete`
- Last updated: `2026-02-08`

### Change Log
- `2026-02-08`: Initial plan created.
- `2026-02-08`: Phase 1 complete — extracted send pipeline into `useMessageSendPipeline`.

## Risks and Controls
- Risk: Behavior regressions during extraction.
  - Control: characterization tests first, then incremental commits.
- Risk: API churn across components using `useChat`.
  - Control: freeze `useChat` external contract until final stabilization.
- Risk: Refactor stalls due to large scope.
  - Control: phase-based execution with strict exit criteria.
