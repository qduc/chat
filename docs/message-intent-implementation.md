# Message Intent Schema - Implementation Guide

## Overview

The message intent schema implementation provides an explicit, unambiguous way to perform message operations in the chat API. This implementation follows the specification in [`docs/message-intent-schema.md`](../message-intent-schema.md).

## Status

✅ **Phase 1 Complete**: Backend compatibility release with backward compatibility

The backend now accepts both:
- **Intent envelope format** (new, recommended)
- **Legacy format** (existing, maintained for backward compatibility)

## Quick Start

### Append Message with Intent

```javascript
POST /v1/chat/completions
Authorization: Bearer <token>

{
  "intent": {
    "type": "append_message",
    "client_operation": "unique-op-id-123",
    "messages": [{
      "role": "user",
      "content": "Hello, AI!"
    }],
    "completion": {
      "model": "gpt-4",
      "max_tokens": 100
    }
  }
}
```

**Response:**
```json
{
  "success": true,
  "conversation_id": "conv-uuid",
  "client_operation": "unique-op-id-123",
  "operations": {
    "inserted": [
      { "id": "msg-uuid-1", "seq": 1, "role": "user" },
      { "id": "msg-uuid-2", "seq": 2, "role": "assistant" }
    ],
    "updated": [],
    "deleted": []
  }
}
```

### Append to Existing Conversation

```javascript
POST /v1/chat/completions
Authorization: Bearer <token>

{
  "intent": {
    "type": "append_message",
    "client_operation": "unique-op-id-456",
    "conversation_id": "existing-conv-uuid",
    "after_message_id": "last-msg-uuid",
    "after_seq": 10,
    "messages": [{
      "role": "user",
      "content": "Follow-up question"
    }],
    "completion": {
      "model": "gpt-4"
    }
  }
}
```

### Edit Message with Intent

```javascript
PUT /v1/conversations/:conversation_id/messages/:message_id/edit
Authorization: Bearer <token>

{
  "intent": {
    "type": "edit_message",
    "client_operation": "unique-op-id-789",
    "message_id": "msg-to-edit-uuid",
    "expected_seq": 5,
    "content": "Updated message content"
  }
}
```

**Response:**
```json
{
  "success": true,
  "conversation_id": "conv-uuid",
  "client_operation": "unique-op-id-789",
  "operations": {
    "inserted": [],
    "updated": [
      { "id": "msg-to-edit-uuid", "seq": 5, "role": "user" }
    ],
    "deleted": [
      { "id": "response-msg-uuid", "seq": 6, "role": "assistant" }
    ]
  },
  "fork_conversation_id": "forked-conv-uuid"
}
```

## Key Features

### Optimistic Locking

The intent system uses sequence numbers to prevent conflicting edits:

```javascript
// Client A and B both load message with seq=5
// Client A edits first - succeeds
// Client B tries to edit with stale seq=5 - fails with seq_mismatch error
{
  "success": false,
  "error": "validation_error",
  "error_code": "seq_mismatch",
  "client_operation": "client-b-op",
  "details": {
    "field": "expected_seq",
    "expected": 6,  // Current sequence
    "actual": 5     // Client's stale sequence
  }
}
```

### Truncate After

Use `truncate_after: true` to regenerate or branch conversations:

```javascript
{
  "intent": {
    "type": "append_message",
    "client_operation": "regenerate-op",
    "conversation_id": "conv-uuid",
    "after_message_id": "user-msg-uuid",
    "after_seq": 3,
    "truncate_after": true,  // Deletes seq > 3
    "messages": [{
      "role": "user",
      "content": "Same question"
    }],
    "completion": {}
  }
}
```

### Client Operation Tracking

Every operation requires a `client_operation` identifier:

- **Idempotency**: Retry the same operation with the same ID
- **Correlation**: Match async responses to requests
- **Debugging**: Track operations across logs

## Error Codes

| Error Code | Description | How to Fix |
|------------|-------------|------------|
| `conversation_not_found` | Conversation doesn't exist or doesn't belong to user | Verify conversation_id and user ownership |
| `message_not_found` | Referenced message doesn't exist | Verify after_message_id/message_id exists |
| `seq_mismatch` | Sequence number doesn't match (optimistic lock failure) | Reload conversation and retry with current seq |
| `not_last_message` | Trying to append after non-terminal message without truncate_after | Set truncate_after: true or append after the last message |
| `missing_required_field` | Required field missing | Add after_message_id and after_seq when conversation_id is provided |
| `edit_not_allowed` | Trying to edit non-user message | Only user messages can be edited |
| `invalid_intent` | Intent envelope malformed | Validate intent structure against schema |

## Backward Compatibility

The system maintains full backward compatibility. Legacy requests work unchanged:

```javascript
// Legacy format - still works
POST /v1/chat/completions
{
  "messages": [{ "role": "user", "content": "Hello" }],
  "model": "gpt-4"
}

// Returns legacy response format
{
  "id": "chatcmpl-...",
  "choices": [...],
  // No intent fields
}
```

## Implementation Details

### Files Added

- `backend/src/lib/validation/messageIntentSchemas.js` - Zod validation schemas
- `backend/src/lib/intentMiddleware.js` - Express middleware for intent handling
- `backend/src/lib/intentService.js` - Intent validation logic
- `backend/__tests__/messageIntentSchemas.test.js` - Schema tests (33 tests)
- `backend/__tests__/messageIntent.integration.test.js` - Integration tests

### Files Modified

- `backend/src/routes/chat.js` - Added intent middleware to POST /v1/chat/completions
- `backend/src/routes/conversations.js` - Added intent middleware to edit endpoint
- `backend/src/db/messages.js` - Added getMessageByIdAndSeq function

### Middleware Chain

```
Request → authenticateToken 
       → detectIntentEnvelope (checks for intent field)
       → validateAppendIntent or validateEditIntent (validates intent structure)
       → transformIntentToLegacy (converts to legacy format for existing handlers)
       → wrapIntentResponse (converts response back to intent format)
       → existing handler (unchanged!)
```

## Testing

### Unit Tests

```bash
npm test -- messageIntentSchemas.test.js
```

### Integration Tests

```bash
npm test -- messageIntent.integration.test.js
```

## Next Steps (Future Phases)

From `docs/message-intent-schema.md`:

- **Phase 2**: Frontend adoption with feature flags
- **Phase 3**: Warning mode for missing intents
- **Phase 4**: Strict enforcement (require intents for all mutations)

## Resources

- **Full Specification**: [`docs/message-intent-schema.md`](../message-intent-schema.md)
- **Schema Definitions**: [`backend/src/lib/validation/messageIntentSchemas.js`](../../backend/src/lib/validation/messageIntentSchemas.js)
- **Test Examples**: [`backend/__tests__/messageIntentSchemas.test.js`](../../backend/__tests__/messageIntentSchemas.test.js)
