# Feature Specification: Per-Account System Prompt Management

**Feature Branch**: `001-i-want-the`
**Created**: 2025-09-27
**Status**: Draft
**Input**: User description: "I want the user to be able to manage their system prompts per account. They can create/save/load prompts for multiple different use case. The system will provide a few builtin system prompts to getting stated. The builtin prompt is saved as seperate markdown files in the backend source code. All of this functionalities will be in the right sidebar."

## Execution Flow (main)
```
1. Parse user description from Input
   → If empty: ERROR "No feature description provided"
2. Extract key concepts from description
   → Identify: actors, actions, data, constraints
3. For each unclear aspect:
   → Mark with [NEEDS CLARIFICATION: specific question]
4. Fill User Scenarios & Testing section
   → If no clear user flow: ERROR "Cannot determine user scenarios"
5. Generate Functional Requirements
   → Each requirement must be testable
   → Mark ambiguous requirements
6. Identify Key Entities (if data involved)
7. Run Review Checklist
   → If any [NEEDS CLARIFICATION]: WARN "Spec has uncertainties"
   → If implementation details found: ERROR "Remove tech details"
8. Return: SUCCESS (spec ready for planning)
```

---

## ⚡ Quick Guidelines
- ✅ Focus on WHAT users need and WHY
- ❌ Avoid HOW to implement (no tech stack, APIs, code structure)
- 👥 Written for business stakeholders, not developers

### Section Requirements
- **Mandatory sections**: Must be completed for every feature
- **Optional sections**: Include only when relevant to the feature
- When a section doesn't apply, remove it entirely (don't leave as "N/A")

### For AI Generation
When creating this spec from a user prompt:
1. **Mark all ambiguities**: Use [NEEDS CLARIFICATION: specific question] for any assumption you'd need to make
2. **Don't guess**: If the prompt doesn't specify something (e.g., "login system" without auth method), mark it
3. **Think like a tester**: Every vague requirement should fail the "testable and unambiguous" checklist item
4. **Common underspecified areas**:
   - User types and permissions
   - Data retention/deletion policies
   - Performance targets and scale
   - Error handling behaviors
   - Integration requirements
   - Security/compliance needs

---

## User Scenarios & Testing *(mandatory)*

### Primary User Story
As an authenticated user, I want to create, view, select, update, and delete my own reusable "system prompts" (prompt presets) and quickly switch between them when starting or continuing a conversation so that I can adapt the assistant's behavior for different use cases without rewriting the same instructions.

### Acceptance Scenarios
1. **Given** I am logged in with no custom prompts yet, **When** I open the right sidebar "System Prompts" section, **Then** I see a list of built‑in prompts (starter set) and an affordance to create my first custom prompt.
2. **Given** I am viewing the prompt manager, **When** I click "New Prompt", enter a name and body text, and save, **Then** the new prompt appears in my personal list and is selectable.
3. **Given** I have at least one custom prompt, **When** I select a prompt, **Then** it becomes the active system prompt for subsequent assistant responses in the current conversation context (until changed) and the UI reflects it as active.
4. **Given** I have a custom prompt selected, **When** I edit its name or content and save, **Then** the changes persist and the updated values display immediately.
5. **Given** I have a custom prompt I no longer need, **When** I delete it and confirm, **Then** it is removed from my list without affecting built‑in prompts or other users' prompts.
6. **Given** Built‑in prompts exist, **When** I attempt to modify or delete a built‑in prompt, **Then** I am prevented with a clear message that built‑ins are read‑only (but I may duplicate to customize).
7. **Given** A built‑in prompt suits my needs with minor tweaks, **When** I choose an action like "Duplicate" (or "Save as custom"), **Then** a new editable custom prompt is created pre‑filled with the built‑in content.
8. **Given** I switch accounts (or log out and another user logs in), **When** I open the prompt manager, **Then** only that user's custom prompts plus the shared built‑ins are shown.
9. **Given** I select a different prompt mid‑conversation, **When** I send the next message, **Then** the system uses the newly selected prompt as the system instruction for that message onward (previous messages remain unchanged).
10. **Given** I have an active prompt selected and its full content is displayed in an editable text area, **When** I modify the content but do not explicitly save/update the underlying custom prompt, **Then** the modified (unsaved) version is used for the NEXT assistant response only (and subsequent ones until I change or revert), while the original saved version remains unchanged in my prompt library.
11. **Given** I have edited (but not saved) the active prompt's inline content, **When** I view the prompt list, **Then** the active prompt's name shows an asterisk (e.g., “My Prompt*”) indicating there are unsaved inline changes.
12. **Given** I have unsaved inline edits to the active prompt, **When** I refresh or reopen the application in the same browser, **Then** those unsaved edits reappear (temporarily preserved) so I can continue without losing work, until I explicitly save changes or discard them.
13. **Given** I have unsaved inline edits applied to the active prompt, **When** I select another prompt, **Then** the system prompts me to either discard the unsaved edits, save them as an update (if original is editable), or save them as a new custom prompt (if the original was a built‑in or read‑only) before switching.

### Edge Cases
- User deletes the currently active custom prompt → System should gracefully fall back to: no custom system prompt
- Duplicate prompt name attempted → Should append a number suffix like "My Prompt (1)". If the number suffix already exists, increment until unique.
- Very long prompt body entered → No hard body length limit enforced (business decision); extremely long bodies may be truncated only by downstream model/context constraints.
- Simultaneous edits in two browser tabs → Last save wins
- Built‑in prompt files missing or unreadable at runtime → Use no prompt.
- Attempt to create a prompt while unauthenticated (session expired) → Action should fail with auth message and no data loss.
- Network failure on save → User should see clear retry option and unsaved content retained locally.
- User has unsaved inline edits and closes the tab → Edits persist temporarily in browser-scoped storage; reopening restores them until explicitly saved or discarded.
- User has unsaved inline edits and switches active prompt → Must confirm discard / save-as-new / apply-as-update choice (default action: discard if user cancels the switch).
- Built‑in prompt edited inline (ephemeral) → Allowed for experimentation; cannot overwrite built‑in. User can choose to save as a new custom prompt; until then, changes are ephemeral.
- Unsaved ephemeral edits become very large → Still allowed; same contextual limitations apply as with saved prompts.

## Requirements *(mandatory)*

### Functional Requirements
- **FR-001**: System MUST allow an authenticated user to view a combined list of built‑in system prompts (read‑only) and that user's custom prompts (read/write) in the right sidebar.
- **FR-002**: System MUST clearly visually distinguish built‑in prompts from custom prompts by grouping them into separate labeled sections ("Built‑ins" pinned at the top, and "My Prompts" or similar below). The distinction must not rely solely on color and should include a visible header for each group.
- **FR-003**: System MUST allow a user to create a new custom prompt by specifying at minimum a name/title and prompt body text, then persist it to that user's account scope.
- **FR-004**: System MUST validate required fields (name, body) before saving; name length ≤ 255 characters (case-insensitive uniqueness handled via auto-suffixing), body accepts arbitrary length (no enforced hard limit) and is stored as provided.
- **FR-005**: System MUST allow selecting exactly one active system prompt at a time for use in subsequent assistant responses for the current conversation context.
- **FR-006**: System MUST apply the currently selected prompt's content as the system instruction for future AI responses only; historical messages are not retroactively changed.
- **FR-007**: System MUST persist the active prompt per conversation; a new conversation auto-initializes its active prompt to the user's last active prompt (if any) otherwise none (no prompt).
- **FR-008**: System MUST allow editing (updating name and body) of a user's custom prompts while preventing edits to built‑in prompts.
- **FR-009**: System MUST allow deletion of a user's custom prompts with a confirmation step to avoid accidental loss.
- **FR-010**: System MUST prevent deletion of built‑in prompts; attempted delete should produce a non-destructive notice.
- **FR-011**: System MUST allow duplicating a built‑in prompt into a new custom prompt pre-populated with the original content.
- **FR-012**: System MUST restrict visibility of custom prompts to their owning user; no other user can list or access them.
- **FR-013**: System MUST ensure built‑in prompts are identical for all users (shared canonical source files); changes to those files (deployment) reflect for all users on next load.
- **FR-014**: System MUST handle absence or read failure of built‑in prompt files by displaying an error state while still permitting creation of custom prompts.
- **FR-015**: System MUST provide feedback states: loading (initial fetch), empty custom list, error (fetch/save failure), and success (saved/updated/deleted).
 - **FR-016**: System MUST allow selecting "No System Prompt" (explicit "None" option visible in the prompt list) to revert to default behavior.
- **FR-017**: System MUST NOT log user prompt management actions (create, update, delete, select); this feature will not record an audit trail.
 - **FR-018**: System MUST NOT include search or filtering in the MVP (explicitly out of scope); users browse the full list. (Future enhancement: lightweight client-side name filter once average user > threshold prompts.)
- **FR-019**: System MUST auto-deduplicate custom prompt names case-insensitively by appending the smallest available numeric suffix in the form "Name (n)" starting at 1.
 - **FR-020**: System MUST display custom prompts ordered by Last Used (most recently used first); alternative sort modes (alphabetical, manual) are out of scope for MVP.
- **FR-021**: System MUST not expose implementation details (file paths, internal IDs) directly in the user interface.
 - **FR-022**: System MUST allow changing the selected prompt while a response is streaming; the change takes effect only for the NEXT user message (current in-flight generation continues using the previously active prompt; no cancellation/restart).
- **FR-023**: System MUST gracefully handle session expiration during prompt actions by prompting re-authentication without losing unsaved form data.
- **FR-024**: System MUST provide a way to quickly apply a prompt when starting a new conversation (pre-select or choose during conversation creation). [NEEDS CLARIFICATION: Is integration with new conversation modal required?]
- **FR-025**: System MUST surface built‑in prompts even when user has many custom prompts, pinning all built‑ins as a fixed, non-collapsible block at the top in a predefined editorial order.
- **FR-026**: When a user deletes the active prompt for a conversation, that conversation's active prompt MUST revert to none (no prompt) without affecting other conversations or the user's last-active reference.
- **FR-027**: System MUST display the full content of the currently active prompt in an always-visible editable text area within the right sidebar (or equivalent prompt management panel).
- **FR-028**: Inline edits to the active prompt's content MUST take effect for subsequent assistant responses WITHOUT requiring an explicit save action (ephemeral override behavior) while leaving the underlying stored custom or built‑in prompt definition unchanged.
- **FR-029**: System MUST visually denote that the active prompt has unsaved inline changes by appending an asterisk to its displayed name (or an equivalent non-color-only indicator) until those changes are either saved or discarded.
- **FR-030**: System MUST allow the user to explicitly save inline edits to a custom prompt (updating that prompt) OR save them as a new custom prompt when the source is a built‑in or read‑only prompt.
- **FR-031**: System MUST preserve unsaved inline edits for the active prompt across page reloads within the same browser using temporary client-side persistence, clearing them when (a) the user saves the changes, (b) discards them, or (c) logs out.
- **FR-032**: System MUST prompt the user with clear choices when switching away from an active prompt that has unsaved inline edits: (1) Discard edits and switch, (2) Save changes (update existing if allowed), or (3) Save as new (if source not editable).
- **FR-033**: System MUST ensure ephemeral inline edits are scoped to the user and not visible to other users; they are not committed to shared storage until saved.
- **FR-034**: System MUST provide an action to revert the active prompt's inline content back to the last saved version (or original built‑in) in a single step.
- **FR-035**: System MUST NOT treat ephemeral inline edits as a new saved prompt for purposes of ordering (Last Used) until the user sends at least one message with them applied; at that point, the underlying prompt's Last Used timestamp updates (but still without overwriting content unless saved).

### Non-Functional / Constraints (implicit from feature)
- **NFR-001**: Prompt list retrieval and display SHOULD complete within an acceptable UI latency threshold. [NEEDS CLARIFICATION: Target latency?]
- **NFR-002**: No hard maximum enforced on prompt body length; operational guidance: extremely large bodies may reduce model context efficiency but are permitted.
- **NFR-003**: Built‑in prompt definitions MUST be maintainable without requiring database changes (source-controlled markdown). (Business reasoning: allows editorial iteration.)
- **NFR-004**: Access control MUST enforce per-user isolation for custom prompts (authorization requirement).
- **NFR-005**: System MUST remain usable (core create/select) under intermittent network conditions via clear retry UX (resilience expectation).
- **NFR-006**: Temporary client-side persistence of unsaved inline edits SHOULD be lightweight and cleared deterministically upon explicit save, discard, or user logout to avoid stale data accumulation.

### Open Questions / Clarifications Needed
1. Should there be categories/tags for prompts (future grouping) or defer?
2. Should duplication be available for custom prompts as well (clone & tweak)?
3. Need rate limits on prompt creation/updates to prevent abuse?
4. Internationalization: are prompt names/bodies multi-language; any locale metadata?
5. Is version history / undo for prompt edits in scope or out of scope (future)?
6. Retention window for unsaved inline edits if a user remains inactive—should there be an automatic expiry? (Currently unspecified.)
7. Should ephemeral inline edits propagate to other concurrently open tabs (real-time sync) or remain tab-local until saved?
8. When a user logs out and logs back in, should ephemeral edits be fully cleared (current assumption: yes)?

### Key Entities *(include if feature involves data)*
- **System Prompt (Custom)**: Represents a user-defined reusable system instruction preset (Attributes: owner user reference, name/title, body text/content, created timestamp, updated timestamp, optional usage count, optional last used timestamp, possibly is_active if global vs. conversation-scoped selection design).
- **System Prompt (Built‑in)**: Predefined shared prompt descriptor sourced from repository-managed markdown (Attributes: identifier/slug, display name, body text, optional category/description, read-only flag).
- **Conversation Prompt Selection**: Association mapping a conversation to the chosen system prompt ID (or null) plus timestamp of selection. New conversation rows initialize by copying the user's last active prompt reference (if any) but future changes are isolated per conversation.

## Clarifications

### Session 2025-09-27
- Q: How should the “active system prompt” be scoped? → A: Per conversation; new conversation inherits last active prompt or none.
- Q: How should duplicate custom prompt names be handled? → A: Auto-deduplicate with numeric suffix (case-insensitive).
- Q: What are the maximum lengths and content constraints for prompt name and body? → A: Name ≤255 chars; body unlimited.
- Q: Should search/filter be included in the initial MVP? → A: Out of scope for MVP.
- Q: How should built‑in prompts be ordered/presented relative to custom prompts? → A: Built‑ins pinned top (fixed order); customs by last used.
 - Q: What happens if user changes prompt during an in-flight generation? → A: Allow change; applies to next message only (current stream unaffected).
 - Q: What audit logging and retention is required for prompt actions? → A: No audit; no retention period.
 - Q: How should built‑in prompts be visually distinguished from custom prompts? → A: Grouped sections with headers (Built‑ins / My Prompts).

---

## Review & Acceptance Checklist
*GATE: Automated checks run during main() execution*

### Content Quality
- [ ] No implementation details (languages, frameworks, APIs)
- [ ] Focused on user value and business needs
- [ ] Written for non-technical stakeholders
- [ ] All mandatory sections completed

### Requirement Completeness
- [ ] No [NEEDS CLARIFICATION] markers remain
- [ ] Requirements are testable and unambiguous
- [ ] Success criteria are measurable
- [ ] Scope is clearly bounded
- [ ] Dependencies and assumptions identified

---

## Execution Status
*Updated by main() during processing*

- [ ] User description parsed
- [ ] Key concepts extracted
- [ ] Ambiguities marked
- [ ] User scenarios defined
- [ ] Requirements generated
- [ ] Entities identified
- [ ] Review checklist passed

---
