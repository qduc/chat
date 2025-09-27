# Data Model: System Prompt Management

## Entities

### 1. system_prompts (Custom Prompts)
Represents user-owned reusable prompt presets.

| Field | Type | Constraints | Notes |
|-------|------|------------|-------|
| id | TEXT (UUID) | PK | Generated client or server (server recommended) |
| user_id | TEXT | FK -> users.id (nullable? No: required for custom) | Enforces ownership |
| name | TEXT | NOT NULL, length <=255, unique per user (case-insensitive after trim) | Auto-suffix duplicates |
| body | TEXT | NOT NULL | Arbitrary length |
| usage_count | INTEGER | DEFAULT 0 | Increment when used to send a message (post-send) |
| last_used_at | DATETIME | NULL | Update when message includes this prompt |
| created_at | DATETIME | DEFAULT CURRENT_TIMESTAMP |  |
| updated_at | DATETIME | DEFAULT CURRENT_TIMESTAMP | Touch on update |

Indexes:
- ix_system_prompts_user_last_used (user_id, last_used_at DESC)
- ix_system_prompts_user_name_unique (user_id, lower(trim(name))) (enforced logically via pre-insert check due to SQLite virtual expression)

### 2. built_in_prompts (Virtual / In-Memory)
Loaded from markdown files on startup or first request.

Front-matter schema (YAML):
```
slug: classification
name: Classification Assistant
order: 10
description: Helps categorize text.
```
Body: markdown content after front-matter; turned into plain text body.

Derived fields:
- id: `built:{slug}` (not persisted in DB)
- read_only: true

### 3. Conversation (Existing)
Augmented by metadata keys:
- active_system_prompt_id: TEXT (can reference `custom:{uuid}` or `built:{slug}`); null means None.
- inline_system_prompt_override: TEXT (optional ephemeral override – not persisted in DB; only sent in message request body; DO NOT store here).

No schema change required; extends JSON stored in `conversations.metadata` column via merge patch.

### 4. Message (Existing)
On send, server resolves effective system prompt text (inline override > custom body > built-in body) and injects into upstream provider call as the system message. No DB schema change.

## Validation Rules
| Rule | Component |
|------|-----------|
| Name required, <=255 chars | Create/Update |
| Body required (non-empty after trim) | Create/Update |
| Duplicate detection case-insensitive | Create (retry suffix) |
| Built-ins are read-only | Update/Delete guards |
| last_used_at update only after successful message send | Post-send hook/service |
| usage_count increment only if message includes effective prompt text | Post-send |
| Duplicating built-in/custom copies name (collision -> suffix) | Duplicate endpoint |

## Name Deduplication Algorithm
Pseudo:
```
base = trim(originalName)
if not exists(user_id, base, case_insensitive): return base
n = 1
while exists(user_id, f"{base} ({n})", case_insensitive): n += 1
return f"{base} ({n})"
```

## Migration (Forward)
Add new table:
```
CREATE TABLE system_prompts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  body TEXT NOT NULL,
  usage_count INTEGER NOT NULL DEFAULT 0,
  last_used_at DATETIME NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE INDEX ix_system_prompts_user_last_used ON system_prompts(user_id, last_used_at DESC);
CREATE INDEX ix_system_prompts_user_name ON system_prompts(user_id, name);
```
(Unique name constraint enforced at application layer with case-insensitive check.)

## Deletion Behavior
- Soft delete not required (FR does not mention restore). Hard delete row.
- If deleted prompt is active for any conversation, conversation metadata updated to clear `active_system_prompt_id`.

## State Transitions
Custom Prompt lifecycle:
```
Created -> (Updated)* -> (Used)* -> Deleted
```
Built-in Prompt lifecycle:
```
Defined in repo -> Loaded -> (Duplicated → Custom Prompt)
```

## Error Conditions
| Condition | HTTP | Message |
|-----------|------|---------|
| Name missing | 400 | "name required" |
| Body missing | 400 | "body required" |
| Not found (id) | 404 | "prompt not found" |
| Attempt modify built-in | 400 | "built-in prompt is read-only" |
| Attempt delete built-in | 400 | "built-in prompt is read-only" |
| Unauthorized user access | 403 | "forbidden" |

## Open/Deferred
- Rate limiting (write ops) – add future migration only if storing counters needed beyond usage_count.
- Categories/tags – would require additional table or column.
