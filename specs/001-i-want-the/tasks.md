# Tasks: Per-Account System Prompt Management

**Input**: Design documents from `/specs/001-i-want-the/`
**Prerequisites**: plan.md (required), research.md, data-model.md, contracts/

## Execution Flow (generated)
Derived from plan, data-model, contracts, research, quickstart. Emphasizes TDD and constitutional principles.

## Phase 3.1: Setup
- [X] T001 Ensure Docker dev environment running; document baseline (no code change) (`./dev.sh up --build` verification)
  Dependency: none
- [X] T002 Add backend migration file for `system_prompts` table at `backend/src/db/migrations/010-system-prompts.js`
  Dependency: T001
- [X] T003 [P] Create backend built-ins directory and example markdown: `backend/src/prompts/builtins/README.md`, `backend/src/prompts/builtins/example.md` (with YAML front-matter)
  Dependency: T001
- [X] T004 Add placeholder frontend directories (if absent) for prompt manager: `frontend/app/(or components)/promptManager/` with README explaining structure
  Dependency: T001
- [X] T005 [P] Update `.github/copilot-instructions.md` via script `.specify/scripts/bash/update-agent-context.sh copilot` adding new feature context
  Dependency: T001

## Phase 3.2: Tests First (TDD) ⚠️ MUST COMPLETE BEFORE 3.3
Contract Tests (one per endpoint from `system-prompts.openapi.json`):
- [X] T006 [P] Contract test list prompts GET /v1/system-prompts in `backend/__tests__/system_prompts.contract.list.test.js`
- [X] T007 [P] Contract test create prompt POST /v1/system-prompts in `backend/__tests__/system_prompts.contract.create.test.js`
- [X] T008 [P] Contract test update prompt PATCH /v1/system-prompts/:id in `backend/__tests__/system_prompts.contract.update.test.js`
- [X] T009 [P] Contract test delete prompt DELETE /v1/system-prompts/:id in `backend/__tests__/system_prompts.contract.delete.test.js`
- [X] T010 [P] Contract test duplicate prompt POST /v1/system-prompts/:id/duplicate in `backend/__tests__/system_prompts.contract.duplicate.test.js`
- [X] T011 [P] Contract test select prompt POST /v1/system-prompts/:id/select in `backend/__tests__/system_prompts.contract.select.test.js`
- [X] T012 [P] Contract test clear selection POST /v1/system-prompts/none/select in `backend/__tests__/system_prompts.contract.clear.test.js`

Integration Tests (user stories & quickstart scenarios):
- [X] T013 [P] Integration: list built-ins + empty custom state in `backend/__tests__/system_prompts.integration.list_empty.test.js`
- [X] T014 [P] Integration: create + list + uniqueness suffix in `backend/__tests__/system_prompts.integration.create_suffix.test.js`
- [X] T015 [P] Integration: update custom prompt (timestamps, body) in `backend/__tests__/system_prompts.integration.update.test.js`
- [X] T016 [P] Integration: delete active prompt clears conversation selection in `backend/__tests__/system_prompts.integration.delete_active.test.js`
- [X] T017 [P] Integration: duplicate built-in then custom in `backend/__tests__/system_prompts.integration.duplicate.test.js`
- [X] T018 [P] Integration: select prompt and message send updates last_used_at & usage_count in `backend/__tests__/system_prompts.integration.selection_usage.test.js`
- [X] T019 [P] Integration: inline override (unsaved content) applied without updating stored body in `backend/__tests__/system_prompts.integration.inline_override.test.js`
- [X] T020 [P] Integration: switch prompt with unsaved edits forces decision flow (simulate API + state) in `backend/__tests__/system_prompts.integration.switch_unsaved.test.js`
- [X] T021 [P] Integration: built-in read failure fallback (simulate missing file) in `backend/__tests__/system_prompts.integration.builtin_failure.test.js`

Frontend Component/State Tests:
- [X] T022 [P] Render Built-ins & My Prompts grouping in `frontend/__tests__/promptManager.render.test.tsx`
- [X] T023 [P] Inline edit asterisk + persistence via localStorage in `frontend/__tests__/promptManager.inlineEdits.test.tsx`
- [X] T024 [P] New conversation initiation uses active textarea prompt in `frontend/__tests__/promptManager.conversationInit.test.tsx`
- [X] T025 [P] Switch prompt with unsaved edits confirmation modal logic in `frontend/__tests__/promptManager.switchConfirm.test.tsx`
- [X] T026 [P] Clearing active prompt returns to None option in `frontend/__tests__/promptManager.clearSelection.test.tsx`
- [X] T027 [P] Last used ordering updated after message send simulation in `frontend/__tests__/promptManager.ordering.test.tsx`

Performance Test:
- [X] T028 [P] Backend performance test list p95 < 300ms (loop 10 calls) in `backend/__tests__/system_prompts.performance.list.test.js`

## Phase 3.3: Core Implementation (ONLY after tests above exist & fail)
Models / Migration / Loaders:
- [X] T029 Implement migration `010-system-prompts.js` logic (up/down) and register in migration runner
- [X] T030 [P] Add DB access module `backend/src/db/systemPrompts.js` (CRUD, uniqueness suffix logic, usage update)
- [X] T031 [P] Implement built-ins loader `backend/src/lib/builtInsPromptLoader.js` (parse YAML front-matter, cache, error handling)

Services / Business Logic:
- [X] T032 Service `backend/src/lib/promptService.js` (compose built-ins + custom list, duplicate, select, clear, inline override resolution helper)
- [X] T033 Update conversation message pipeline to inject effective system prompt (likely in `backend/src/lib/openaiProxy.js` or adjacent abstraction) without breaking compatibility
- [X] T034 Add usage tracking hook after successful assistant response (increment usage_count, update last_used_at) in message finalize path

Validation & Schemas:
- [X] T035 [P] Zod schemas `backend/src/lib/validation/systemPromptsSchemas.js` for create/update/select/clear

Routes / Controllers:
- [X] T036 Implement GET /v1/system-prompts route file `backend/src/routes/systemPrompts.js` (list)
- [X] T037 Implement POST /v1/system-prompts (create) in same route file
- [X] T038 Implement PATCH /v1/system-prompts/:id (update)
- [X] T039 Implement DELETE /v1/system-prompts/:id (delete custom)
- [X] T040 Implement POST /v1/system-prompts/:id/duplicate
- [X] T041 Implement POST /v1/system-prompts/:id/select (conversation metadata patch)
- [X] T042 Implement POST /v1/system-prompts/none/select
- [X] T043 Wire new route into backend/src/index.js after auth + rate limit, before error handler

Frontend State & UI:
- [X] T044 Prompt state hook `frontend/hooks/useSystemPrompts.ts` (fetch list, create/update/delete/select/duplicate, inline override management, localStorage persistence)
- [X] T045 [P] Prompt manager components: `PromptList.tsx`, `PromptEditor.tsx`, `UnsavedChangesModal.tsx` in `frontend/app/components/promptManager/`
- [X] T046 Integrate manager into right sidebar `frontend/app/components/RightSidebar.tsx` (add panel with groups, None option)
- [X] T047 Extend chat send path to include current inline override content from hook (likely in `frontend/lib/chat/ChatClient.ts`)
- [X] T048 Conversation creation flow to seed active textarea prompt (update relevant component / hook) `frontend/app/components/MessageInput.tsx` or conversation creation component
- [X] T049 Ordering logic in UI (last_used_at sort for custom) + pinned built-ins at top

Error & Edge Handling:
- [X] T050 [P] Graceful fallback when built-ins loader error (UI shows error + custom creation control) (frontend changes + backend list returns error flag)
- [X] T051 Prevent edit/delete built-in on backend & surface proper frontend disabled states
- [X] T052 Name deduplication backend logic with loop + test fixture adjustments
- [X] T053 Inline override snapshot on send: ensure message send uses snapshot not live editing state (frontend send handler adjustment)

## Phase 3.4: Integration
- [ ] T054 Run migration, seed example built-in, execute all contract & integration tests (they should now pass) – adjust as needed
- [ ] T055 Verify system prompt injection does not break existing chat tests; update or extend `backend/__tests__/chat_proxy.*` as necessary for new metadata
- [ ] T056 Add security review: ensure no logging of prompt bodies (scan logger usage) and add comment in sensitive areas
- [ ] T057 Add docs snippet to `README.md` (backend + frontend sections) describing prompt management feature

## Phase 3.5: Polish
- [ ] T058 [P] Additional fine-grained unit tests for name suffix function in `backend/__tests__/system_prompts.unit.naming.test.js`
- [ ] T059 [P] Unit tests for Zod schemas (invalid cases) `backend/__tests__/system_prompts.unit.validation.test.js`
- [ ] T060 [P] Frontend unit tests for hook localStorage logic `frontend/__tests__/promptManager.hookStorage.test.tsx`
- [ ] T061 Accessibility pass: ensure aria labels for sections & modal `frontend/app/components/promptManager/` updates
- [ ] T062 [P] Performance re-check list endpoint (measure & log) update performance doc comment in migration or service
- [ ] T063 Update quickstart.md with any endpoint path changes or additional scenarios discovered during implementation
- [ ] T064 Refactor pass: remove duplication in service & route (consolidate error mapping) `promptService.js`
- [ ] T065 Final green build & lint run; mark feature ready for review

## Dependencies Summary
- Setup (T001-T005) precedes tests.
- All test tasks (T006-T028) precede implementation tasks (T029+).
- Migration (T029) needed before DB operations; DB module (T030) depends on migration.
- Service (T032) depends on DB module (T030) + built-ins loader (T031).
- Routes (T036-T043) depend on validation (T035) + service (T032).
- Frontend hook (T044) depends on backend routes existing (but can scaffold earlier; keep after core backend to respect TDD focus).
- UI components (T045-T049) depend on hook (T044).
- Error handling tasks (T050-T053) depend on initial implementation of loader, service, routes, UI.
- Integration tasks (T054-T057) after core feature code.
- Polish tasks (T058-T065) last.

## Parallel Execution Guidance
Example parallel batch after T005 (tests phase start):
```
Run in parallel:
  T006, T007, T008, T009, T010, T011, T012  (contract tests)
  T013, T014, T015, T016, T017, T018, T019, T020, T021 (integration tests)
  T022, T023, T024, T025, T026, T027 (frontend component tests)
  T028 (performance test)
```
Example parallel batch during implementation:
```
Run in parallel:
  T030 (DB module), T031 (built-ins loader), T035 (schemas)
Then sequential: T032 (service) -> T033 (pipeline injection) -> T034 (usage tracking)
Parallel after service ready: T036-T042 (routes) mostly sequential in same file except internal function helpers - keep sequential to avoid merge conflicts.
Frontend parallel: T045 (components), T050 (fallback UI) once T044 (hook) done.
```

## Validation Checklist
- [ ] All contracts have corresponding test tasks (T006-T012)
- [ ] All endpoints have implementation tasks (T036-T042 + T041/T042 special cases)
- [ ] Entity system_prompts has model & migration tasks (T029, T030)
- [ ] Tests precede implementation (numbering enforces)
- [ ] Parallel tasks only touch distinct files (marked [P])
- [ ] Performance target test included (T028)
- [ ] Quickstart scenarios mapped (T013-T021 backend, T022-T027 frontend)

## Notes
- Keep TDD discipline: do not implement before all tests exist and fail.
- Avoid coupling built-ins loader with service beyond a simple interface for easier test stubbing.
- Ensure route wiring order respects existing middleware chain (auth → logging → rate limit → routers).
