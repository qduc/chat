
# Implementation Plan: Per-Account System Prompt Management

**Branch**: `001-i-want-the` | **Date**: 2025-09-27 | **Spec**: `/home/qduc/src/chat/specs/001-i-want-the/spec.md`
**Input**: Feature specification from `/specs/001-i-want-the/spec.md`

## Execution Flow (/plan command scope)
```
1. Load feature spec from Input path
   → If not found: ERROR "No feature spec at {path}"
2. Fill Technical Context (scan for NEEDS CLARIFICATION)
   → Detect Project Type from file system structure or context (web=frontend+backend, mobile=app+api)
   → Set Structure Decision based on project type
3. Fill the Constitution Check section based on the content of the constitution document.
4. Evaluate Constitution Check section below
   → If violations exist: Document in Complexity Tracking
   → If no justification possible: ERROR "Simplify approach first"
   → Update Progress Tracking: Initial Constitution Check
5. Execute Phase 0 → research.md
   → If NEEDS CLARIFICATION remain: ERROR "Resolve unknowns"
6. Execute Phase 1 → contracts, data-model.md, quickstart.md, agent-specific template file (e.g., `CLAUDE.md` for Claude Code, `.github/copilot-instructions.md` for GitHub Copilot, `GEMINI.md` for Gemini CLI, `QWEN.md` for Qwen Code or `AGENTS.md` for opencode).
7. Re-evaluate Constitution Check section
   → If new violations: Refactor design, return to Phase 1
   → Update Progress Tracking: Post-Design Constitution Check
8. Plan Phase 2 → Describe task generation approach (DO NOT create tasks.md)
9. STOP - Ready for /tasks command
```

**IMPORTANT**: The /plan command STOPS at step 7. Phases 2-4 are executed by other commands:
- Phase 2: /tasks command creates tasks.md
- Phase 3-4: Implementation execution (manual or via tools)

## Summary
Enable authenticated users to manage reusable system prompt presets (create/read/update/delete/duplicate/select, including ephemeral inline overrides) scoped per user, with a shared read‑only built‑in set sourced from repository markdown files, surfaced in the right sidebar and applied per conversation context (or when starting a new conversation) with persistence of active selection and unsaved inline edits locally until saved/discarded/logout.

Technical direction (initial):
- Backend: Introduce user‑scoped `system_prompts` table and a built‑ins loader reading markdown with YAML front‑matter at startup / on demand (non-blocking failure). Expose REST endpoints for CRUD, duplication, list (merged built‑ins + custom), and apply selection (conversation metadata key: `active_system_prompt_id` and ephemeral override content included on message send if present).
- Frontend: Extend right sidebar with prompt manager panel, maintain local ephemeral state (inline edits) via `localStorage` keyed by user+prompt id; integrate selection into conversation creation flow (active textarea content used when new conversation starts if present). Respect per-tab isolation for ephemeral edits.
- Conversation: Each message send collects current effective prompt text (saved or inline override) and sends as system instruction (no retroactive mutation). Last used ordering maintained via `last_used_at` updates triggered after message send with that prompt (including ephemeral variant).

## Technical Context
**Language/Version**: Backend Node.js (Express 5 ESM), Frontend Next.js 15 (Typescript)
**Primary Dependencies**: express, better-sqlite3, zod, next, react
**Storage**: SQLite (existing); built‑ins from markdown files in repo
**Testing**: Jest (backend & frontend), Testing Library (frontend)
**Target Platform**: Linux containers (Docker dev + prod)
**Project Type**: Web (frontend + backend separation)
**Performance Goals**: Prompt list retrieval p95 < 300ms (NFR-001)
**Constraints**: Service boundary isolation; OpenAI API compatibility for chat pipeline; p95 < 300ms for list; no cross-tab sync; ephemeral edits local only
**Scale/Scope**: MVP; typical user < 50 custom prompts (no enforced max); design scalable to hundreds

Clarification Resolutions / Decisions:
- FR-024: New conversation uses whatever active textarea prompt (including unsaved edits) at creation time
- Open Q1 (categories/tags): Deferred (explicit future enhancement)
- Open Q2 (duplicate custom prompts): Accepted (allow duplication for custom + built‑ins)
- Open Q3 (rate limits): Deferred (no limit MVP; rely on global API rate limiting; add TODO)
- Open Q4 (i18n metadata): Store raw text only; no locale metadata
- Open Q5 (version history): Out of scope
- Open Q6 (TTL for unsaved edits): None; clear on save/discard/logout only
- Open Q7 (cross-tab sync): Per-tab only (no sync)
- Open Q8 (logout clears ephemerals): Yes
- Additional decisions: YAML front‑matter for built‑ins (slug, name, description, order); fields last_used_at + usage_count; name uniqueness trimming + case-insensitive; deselecting prompt does not update last_used_at; snapshot inline prompt at send time; ephemeral storage key pattern `prompt-inline-{userId}-{promptId}` (promptId='built:{slug}' for built‑ins or `custom:{uuid}`)

Outstanding Deferred Items (tracked, not blockers):
- Rate limiting strategy (document in tasks backlog if needed)
- Categories / tags taxonomy design

No remaining NEEDS CLARIFICATION markers block plan generation.

## Constitution Check
*Initial Assessment (Pre-Research)*

| Principle | Status | Notes |
|-----------|--------|-------|
| Service Boundary Isolation | PASS | All prompt CRUD & built‑in loading strictly backend; frontend consumes REST APIs only |
| OpenAI API Compatibility | PASS | Active prompt content injected as system message pre-processing; no contract changes to /v1/chat/completions body shape (add optional metadata only) |
| Test-First Development | PLANNED | Will add failing backend contract tests + frontend component tests before implementation |
| Server-Side Tool Execution | PASS | No new tools exposed; prompt logic is standard REST; validation via Zod on payloads |
| Docker-First Development | PASS | Will use existing dev.sh workflows & migrations |

Security considerations: user isolation enforced by user_id column; built‑ins read-only; input validation for name length and trimming; no logging of prompt content per spec FR-017. No constitutional violations requiring Complexity Tracking entries at this time.

## Project Structure

### Documentation (this feature)
```
specs/[###-feature]/
├── plan.md              # This file (/plan command output)
├── research.md          # Phase 0 output (/plan command)
├── data-model.md        # Phase 1 output (/plan command)
├── quickstart.md        # Phase 1 output (/plan command)
├── contracts/           # Phase 1 output (/plan command)
└── tasks.md             # Phase 2 output (/tasks command - NOT created by /plan)
```

### Source Code (repository root)
<!--
  ACTION REQUIRED: Replace the placeholder tree below with the concrete layout
  for this feature. Delete unused options and expand the chosen structure with
  real paths (e.g., apps/admin, packages/something). The delivered plan must
  not include Option labels.
-->
```
specs/001-i-want-the/
   plan.md
   research.md
   data-model.md
   quickstart.md
   contracts/

backend/
   src/
      db/               # add system_prompts table + migrations
      routes/           # new routes: /v1/system-prompts/*
      lib/              # builtInsPromptLoader.js, promptService.js
      middleware/       # (reuse existing auth/session)
   __tests__/          # new contract + integration tests (prompt CRUD, selection)

frontend/
   app/ (or components/)  # RightSidebar prompt manager components
   hooks/                 # useSystemPrompts hook (fetch, manage state)
   lib/chat/              # extend ChatClient to include system prompt content injection
   __tests__/             # component + state tests
```

**Structure Decision**: Web application (existing frontend + backend). Feature localized to new backend routes/services and new frontend sidebar components + hook.

## Phase 0: Outline & Research
1. **Extract unknowns from Technical Context** above:
   - For each NEEDS CLARIFICATION → research task
   - For each dependency → best practices task
   - For each integration → patterns task

2. **Generate and dispatch research agents**:
   ```
   For each unknown in Technical Context:
     Task: "Research {unknown} for {feature context}"
   For each technology choice:
     Task: "Find best practices for {tech} in {domain}"
   ```

3. **Consolidate findings** in `research.md` using format:
   - Decision: [what was chosen]
   - Rationale: [why chosen]
   - Alternatives considered: [what else evaluated]

**Output**: research.md (produced — see generated file) consolidating decisions & rationale; all blocking clarifications resolved; deferred items documented.

## Phase 1: Design & Contracts
*Prerequisites: research.md complete*

1. **Extract entities from feature spec** → `data-model.md`:
   - Entity name, fields, relationships
   - Validation rules from requirements
   - State transitions if applicable

2. **Generate API contracts** from functional requirements:
   - For each user action → endpoint
   - Use standard REST/GraphQL patterns
   - Output OpenAPI/GraphQL schema to `/contracts/`

3. **Generate contract tests** from contracts:
   - One test file per endpoint
   - Assert request/response schemas
   - Tests must fail (no implementation yet)

4. **Extract test scenarios** from user stories:
   - Each story → integration test scenario
   - Quickstart test = story validation steps

5. **Update agent file incrementally** (O(1) operation):
   - Run `.specify/scripts/bash/update-agent-context.sh copilot`
     **IMPORTANT**: Execute it exactly as specified above. Do not add or remove any arguments.
   - If exists: Add only NEW tech from current plan
   - Preserve manual additions between markers
   - Update recent changes (keep last 3)
   - Keep under 150 lines for token efficiency
   - Output to repository root

**Output**: data-model.md, /contracts/* (OpenAPI-style JSON/YAML or JS schema stubs), failing tests (TDD), quickstart.md, agent-specific context update (copilot).

## Phase 2: Task Planning Approach
*This section describes what the /tasks command will do - DO NOT execute during /plan*

**Task Generation Strategy**:
- Load `.specify/templates/tasks-template.md` as base
- Generate tasks from Phase 1 design docs (contracts, data model, quickstart)
- Each contract → contract test task [P]
- Each entity → model creation task [P]
- Each user story → integration test task
- Implementation tasks to make tests pass

**Ordering Strategy**:
- TDD order: Tests before implementation
- Dependency order: Models before services before UI
- Mark [P] for parallel execution (independent files)

**Estimated Output**: 25-30 numbered, ordered tasks in tasks.md

**IMPORTANT**: This phase is executed by the /tasks command, NOT by /plan

## Phase 3+: Future Implementation
*These phases are beyond the scope of the /plan command*

**Phase 3**: Task execution (/tasks command creates tasks.md)
**Phase 4**: Implementation (execute tasks.md following constitutional principles)
**Phase 5**: Validation (run tests, execute quickstart.md, performance validation)

## Complexity Tracking
*Fill ONLY if Constitution Check has violations that must be justified*

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [e.g., 4th project] | [current need] | [why 3 projects insufficient] |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient] |


## Progress Tracking
*This checklist is updated during execution flow*

**Phase Status**:
- [x] Phase 0: Research complete (/plan command)
- [x] Phase 1: Design complete (/plan command)
- [x] Phase 2: Task planning complete (/plan command - approach described; tasks.md not generated)
- [ ] Phase 3: Tasks generated (/tasks command)
- [ ] Phase 4: Implementation complete
- [ ] Phase 5: Validation passed

**Gate Status**:
- [x] Initial Constitution Check: PASS
- [x] Post-Design Constitution Check: PASS (no new violations)
- [x] All NEEDS CLARIFICATION resolved (deferred items explicitly deferred)
- [ ] Complexity deviations documented (N/A currently)

---
*Based on Constitution v1.1.0 - See `/memory/constitution.md`*
