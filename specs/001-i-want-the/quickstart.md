# Quickstart: System Prompt Management

This guide walks through validating the feature end-to-end once implemented (after tasks execution).

## Prerequisites
- Docker dev environment running: `./dev.sh up --build`
- Authenticated user session (login flow implemented in repo)
- At least one built-in prompt markdown file present (e.g., `backend/src/prompts/builtins/classification.md` with YAML front-matter)

## 1. List Prompts
Request: `GET /v1/system-prompts`
Expected JSON:
```
{
  "built_ins": [ { "id": "built:classification", "name": "Classification", ... } ],
  "custom": [],
  "error": null
}
```
Latency: p95 < 50ms typical (latest run: avg ≈ 7.5ms, p95 ≈ 33ms across 10 calls).

## 2. Create Custom Prompt
`POST /v1/system-prompts`
```
{ "name": "My Helper", "body": "You are precise." }
```
Expect 201, response includes id, timestamps.

## 3. Duplicate Built-in
`POST /v1/system-prompts/built:classification/duplicate`
Expect new custom prompt with unique name (suffix if clash).

## 4. Update Custom Prompt
`PATCH /v1/system-prompts/{id}` body:
```
{ "name": "My Helper Updated", "body": "You are precise and concise." }
```
Expect 200 with updated fields.

## 5. Select Prompt for Conversation
`POST /v1/system-prompts/{id}/select`
```
{ "conversation_id": "<conversation-uuid>", "inline_override": "(optional session-only edits)" }
```
Conversation metadata now has `active_system_prompt_id` set.

## 6. Inline Edit (Ephemeral)
Frontend: Change text in textarea (do NOT save). Send a message.
Chat request (`POST /api/v1/chat/completions`) will include `inline_system_prompt_override` alongside `conversation_id` so the backend injects the temporary system message without mutating the stored prompt. After send, `usage_count` increments & `last_used_at` updates.

## 7. Save Ephemeral Changes
Click “Save Permanently” in the inline notice or exit edit mode -> triggers `PATCH` updating prompt body; inline change indicator clears and localStorage draft removed.

## 8. Clear Active Prompt
`POST /v1/system-prompts/none/select`
```
{ "conversation_id": "<conversation-uuid>" }
```
Active cleared; subsequent messages omit system prompt.

## 9. Delete Active Prompt
`DELETE /v1/system-prompts/{id}` while same conversation uses it. After deletion, conversation metadata should no longer reference it.

## 10. Duplicate Custom Prompt
`POST /v1/system-prompts/{customId}/duplicate` -> name auto-suffixed if conflict.

## 11. Error Cases
- Modify built-in: `PATCH /v1/system-prompts/built:classification` -> 400
- Delete built-in: `DELETE /v1/system-prompts/built:classification` -> 400
- Create missing name: 400

## 12. Performance Check
Call list endpoint 10x; verify average < 100ms and p95 < 50ms (see Jest performance test for automated measurement).

## 13. Frontend State
- Built-ins pinned at top.
- Custom section sorted by last_used_at desc (after interactions).
- Active prompt name gets asterisk when inline edits unsaved.
- Switching prompts with unsaved edits triggers modal with: Discard / Save / Save as New.

## 14. Regression Tests Reference
Backend regression suite:
- `backend/__tests__/system_prompts.contract.*.test.js`
- `backend/__tests__/system_prompts.integration.*.test.js`
- `backend/__tests__/system_prompts.performance.list.test.js`
- `backend/__tests__/chat_proxy.*.test.js` (verifies system prompt injection path)

Frontend regression suite:
- `frontend/__tests__/promptManager.render.test.tsx`
- `frontend/__tests__/promptManager.hookStorage.test.tsx`
- `frontend/__tests__/promptManager.switchConfirm.test.tsx`

## Done Criteria
All acceptance scenarios in spec validated manually or via automated tests; no console errors; contract tests passing; performance target achieved.
