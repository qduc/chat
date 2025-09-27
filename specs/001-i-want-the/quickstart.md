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
  "custom": []
}
```
Latency: p95 < 300ms (check logs / measure locally <50ms typical).

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
{ "conversation_id": "<conversation-uuid>" }
```
Conversation metadata now has `active_system_prompt_id` set.

## 6. Inline Edit (Ephemeral)
Frontend: Change text in textarea (do NOT save). Send a message.
Backend message request should include system message with inline edited body. Underlying prompt record unchanged. After send, usage_count increment & last_used_at updated.

## 7. Save Ephemeral Changes
Click "Save" -> triggers `PATCH` updating prompt body; inline change indicator cleared.

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
Call list endpoint 10x; verify average < 100ms and p95 < 300ms.

## 13. Frontend State
- Built-ins pinned at top.
- Custom section sorted by last_used_at desc (after interactions).
- Active prompt name gets asterisk when inline edits unsaved.
- Switching prompts with unsaved edits triggers modal with: Discard / Save / Save as New.

## 14. Regression Tests Reference
Backend tests (to be created):
- system_prompts.contract.test.js (schema validation)
- system_prompts.crud.test.js
- system_prompts.selection.test.js
- system_prompts.inline_override.test.js (message pipeline)

Frontend tests (to be created):
- PromptManager.render.test.tsx
- PromptManager.inlineEdits.test.tsx
- PromptSelection.conversationInit.test.tsx

## Done Criteria
All acceptance scenarios in spec validated manually or via automated tests; no console errors; contract tests passing; performance target achieved.
