# Message Intent Schema

## Overview

This document defines the strict message intent schema that eliminates all heuristic guessing in the backend message synchronization system.

## Core Principle

**The frontend MUST explicitly declare its intent for every message operation. The backend will reject any ambiguous requests.**

## Core Operations

The system provides **2 atomic operations** - all mutations must complete in a single transaction.

### 1. Append Message (`POST /v1/chat/completions`)

Adding a new message to a conversation (or creating new conversation).

**Required fields:**
```typescript
{
  conversation_id?: string,     // Optional - if missing, creates new conversation
  after_message_id?: string,    // Required if conversation_id provided
  after_seq?: number,           // Required if conversation_id provided (optimistic lock)
  truncate_after?: boolean,     // If true, delete messages with seq > after_seq BEFORE appending
  messages: [{
    role: "user",
    content: string | MixedContent[],
  }],
  // ... other chat completion params
}
```

**Backend behavior (ATOMIC TRANSACTION):**
- If `conversation_id` is null/missing:
  - Creates new conversation
  - Assigns `seq: 1` to user message
- If `conversation_id` provided:
  - **STRICT VALIDATION**:
    - Validates conversation exists and belongs to user
    - Validates `after_message_id` exists with `seq === after_seq`
    - If `truncate_after` is false: Validates `after_message_id` IS the last message (highest seq)
    - If `truncate_after` is true: Allow append even if not last message
  - **ATOMIC OPERATION**:
    - If `truncate_after`: Delete all messages with `seq > after_seq`
    - Insert user message with `seq: after_seq + 1`
    - Generate and insert assistant response with `seq: after_seq + 2`
- Returns conversation_id, user_message_id, assistant_message_id

**Validation errors:**
- `conversation_not_found`: conversation_id doesn't exist
- `message_not_found`: after_message_id doesn't exist
- `seq_mismatch`: after_seq doesn't match actual seq of after_message_id
- `not_last_message`: after_message_id is not last AND truncate_after is false
- `missing_required_field`: conversation_id provided but after_message_id or after_seq missing

**Use cases:**
- **Normal append**: `truncate_after: false` (default)
- **Regenerate**: `truncate_after: true` - atomically deletes future messages and appends new response

---

### 2. Edit Message (`PUT /v1/conversations/{id}/messages/{message_id}/edit`)

Editing an existing user message's content (already exists in codebase).

**Required fields:**
```typescript
{
  content: string | MixedContent[], // REQUIRED - new content
  expected_seq: number,             // REQUIRED - optimistic lock
}
```

**Backend behavior (ATOMIC TRANSACTION):**
- **STRICT VALIDATION**:
  - Validates message exists with `seq === expected_seq`
  - Validates message role is "user" (only user messages editable)
- **ATOMIC OPERATION**:
  - Update message content in-place (preserves seq and id)
  - Delete all messages with `seq > expected_seq`
  - Create fork conversation with deleted messages (preserves history)
- Returns new_conversation_id (the fork)

**Validation errors:**
- `message_not_found`: message_id doesn't exist in this conversation
- `seq_mismatch`: expected_seq doesn't match actual seq (concurrent edit)
- `edit_not_allowed`: trying to edit assistant/tool message

---

## Response Format

All successful operations return:

```typescript
{
  success: true,
  conversation_id: string,
  operations: {
    inserted: Array<{ id: string, seq: number }>,
    updated: Array<{ id: string, seq: number }>,
    deleted: Array<{ id: string, seq: number }>,
  },
  fork_conversation_id?: string, // Only for edit operations
}
```

## Error Format

All validation errors return HTTP 400 with:

```typescript
{
  error: "validation_error",
  error_code: string, // Specific error code from above
  message: string,    // Human-readable explanation
  details: {
    field: string,
    expected: any,
    actual: any,
  }
}
```

## Migration Strategy

1. **Phase 1**: Add optional `intent` field, backend supports both old and new
2. **Phase 2**: Frontend sends `intent` for all new requests
3. **Phase 3**: Backend warns when `intent` missing
4. **Phase 4**: Backend rejects requests without `intent` (strict mode)

## Benefits

1. **No ambiguity**: Every operation has explicit intent
2. **Optimistic locking**: seq validation prevents lost updates
3. **Better errors**: Frontend knows exactly what went wrong
4. **Easier debugging**: Intent is logged, no need to infer
5. **Safer concurrency**: Race conditions are detected and rejected
6. **Fork tracking**: Edit history is explicit and traceable
