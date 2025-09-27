# Research & Decisions: Per-Account System Prompt Management

Date: 2025-09-27
Branch: 001-i-want-the
Source Spec: ./spec.md

## Method
Collected unresolved questions from spec, received clarifications, performed architectural alignment against existing codebase (Express backend + Next.js frontend, SQLite persistence). Validated constitutional principles (service isolation, API compatibility, TDD, server-side execution, Docker-first).

## Key Decisions
| Topic | Decision | Rationale | Alternatives Considered | Impact |
|-------|----------|-----------|--------------------------|--------|
| Built‑in prompts storage | Markdown files w/ YAML front‑matter (slug, name, description, order) | Editorial simplicity, version control, no DB migration | DB seeded rows; JSON bundle | Hot-reload on deploy; consistent across users |
| Custom prompts persistence | New `system_prompts` table, user-scoped | Need CRUD + isolation + ordering | Embed in conversations metadata | Clear model; scalable |
| Ordering | Custom: last_used_at DESC; Built‑ins: fixed order field | Matches FR-020 and editorial control | Alphabetical; manual drag | Satisfies spec requirement |
| Name uniqueness | Case-insensitive suffix `(n)` | Matches FR-019 | Reject duplicates; UUID display | Predictable user experience |
| Active selection storage | Conversation.metadata.active_system_prompt_id (nullable) | Avoid schema change to conversations table | New column | Faster delivery; reuse merge patch util |
| Ephemeral inline edits | localStorage per user+prompt key; not cross-tab | Simplicity; FR-031, FR-033 | Cross-tab BroadcastChannel sync | Reduces complexity + race risk |
| Apply prompt to new conversation | Use current right-sidebar textarea content | FR-024 resolution; intuitive continuity | Force choose saved prompt only | Flexibility for quick experimentation |
| last_used update trigger | After user sends a message referencing prompt (ephemeral or saved) | FR-035 nuance | On selection click | More semantically meaningful usage metric |
| Duplicate custom prompts | Allowed (copy & tweak) | User workflow symmetry | Only built‑ins duplicable | Minimal additional complexity |
| Rate limiting | Deferred (no per-feature limit MVP) | Low immediate abuse risk | Implement writes/hour | Simplicity now; add if needed |
| i18n metadata | Not tracked (raw text only) | Out-of-scope; no locale logic | Per-locale versions | Avoid premature complexity |
| TTL for ephemerals | None (cleared on save/discard/logout) | FR-031 clarity; user expectation | Time-based expiry (24h) | Predictable persistence |
| Snapshot timing | Snapshot inline content at send time | Avoid streaming mid-edit ambiguity | Lock on focus blur | Simple + deterministic |
| Built‑in load failure | Non-fatal; show error + allow customs | Resilience (FR-014) | Hard fail | Keeps core feature usable |
| Logging policy | No action logs (FR-017) | Privacy spec requirement | Verbose audit logging | Reduced storage noise |

## Data Model Additions (Preview)
See `data-model.md` for full schema; highlights:
- system_prompts(id TEXT PK, user_id TEXT NULL, name TEXT, body TEXT, usage_count INTEGER DEFAULT 0, last_used_at DATETIME NULL, created_at, updated_at)
- Indexes: (user_id, last_used_at DESC), (user_id, lower(name)) for uniqueness check logic.

## API Surface (Preview)
(Details in contracts/):
- GET /v1/system-prompts -> { built_ins: [...], custom: [...] }
- POST /v1/system-prompts -> create
- PATCH /v1/system-prompts/:id -> update (custom only)
- DELETE /v1/system-prompts/:id -> delete (custom only)
- POST /v1/system-prompts/:id/duplicate -> clone (custom or built-in via slug mapping)
- POST /v1/system-prompts/:id/select -> set active for conversation (body: { conversation_id, inline_override? })
- POST /v1/system-prompts/none/select -> clear active (body: { conversation_id })

Message send integration: existing chat completion path enriched with resolved system prompt text (inline override > saved custom > built-in) – no contract break.

## Risks & Mitigations
| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|-----------|
| Large prompt bodies degrade context efficiency | Medium | Medium | Document guidance; no hard limit now |
| Built‑in file parse errors | Low | Low | Wrap loader try/catch; surface non-blocking error state |
| Race: two tabs editing same prompt | Medium | Low | Last save wins; ephemeral per-tab isolation reduces conflict |
| Name uniqueness race (concurrent create) | Low | Low | Re-check transactionally; on conflict increment suffix again |
| Inline edits lost on crash before save | Medium | Low | localStorage write on each keystroke (debounced) |

## Performance Considerations
- p95 < 300ms list: Built‑ins loaded/cached in-process; custom prompts query uses index; total expected O(n) with n ~ < 100.
- Minimal additional overhead in chat pipeline: simple string injection for system prompt.

## Security & Privacy
- Enforce user ownership on CRUD by user_id.
- No exposure of filesystem paths for built‑ins (only slug/name/description/order).
- No logging of prompt content (sanitize logs).
- Validation: Zod schemas for create/update/select endpoints.

## Deferred / Future Enhancements
- Categories / tags for discovery
- Rate limiting (per-user write ops)
- Version history / rollback
- Cross-tab sync of ephemeral edits
- Client-side search/filter

## Conclusion
All required clarifications resolved or consciously deferred without blocking initial implementation. Ready for Phase 1 design & contract generation.
