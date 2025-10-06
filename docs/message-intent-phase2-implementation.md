# Message Intent Schema - Phase 2 Implementation

This document describes the Phase 2 implementation of the Message Intent Schema as defined in `docs/message-intent-schema.md`.

## Overview

Phase 2 implements frontend adoption of the intent envelope structure. All message mutations from the frontend now include explicit intent envelopes with client operation IDs, making the communication between frontend and backend deterministic and traceable.

## Changes Made

### 1. Intent Type Definitions (`frontend/lib/chat/intent.ts`)

Created a new module with:
- Type definitions for intent envelopes (`AppendMessageIntent`, `EditMessageIntent`)
- Utility functions to generate client operation IDs
- Factory functions to create intent envelopes
- Type guards for validating intent responses

### 2. ChatClient Updates (`frontend/lib/chat/client.ts`)

Modified `buildRequestBody()` to:
- Wrap all chat completion requests in `append_message` intent envelopes
- Extract `after_message_id` and `after_seq` from messages with seq numbers
- Include all completion parameters in the intent's `completion` field
- Generate unique `client_operation` IDs for request correlation

### 3. ConversationManager Updates (`frontend/lib/chat/conversations.ts`)

Modified `editMessage()` to:
- Accept `expectedSeq` parameter for optimistic locking
- Wrap edit requests in `edit_message` intent envelopes
- Generate unique `client_operation` IDs

### 4. Message Editing Hook Updates (`frontend/hooks/useMessageEditing.ts`)

Updated `handleSaveEdit()` to:
- Extract `seq` from the original message
- Pass `expectedSeq` to the `editMessage` API call

### 5. Test Updates

- Updated `__tests__/lib.chat.test.ts` to verify intent envelope structure
- Created `__tests__/intent.test.ts` with comprehensive tests for intent utilities

## Intent Envelope Structure

### Append Message (New or Follow-up)

```typescript
{
  intent: {
    type: "append_message",
    client_operation: "uuid-v4",
    messages: [{ role: "user", content: "..." }],
    completion: {
      model: "gpt-4",
      stream: true,
      provider_id: "...",
      // ... other completion parameters
    },
    // Optional fields for existing conversations:
    conversation_id: "conv-123",
    after_message_id: "msg-456",
    after_seq: 5,
    truncate_after: false
  }
}
```

### Edit Message

```typescript
{
  intent: {
    type: "edit_message",
    client_operation: "uuid-v4",
    message_id: "msg-789",
    expected_seq: 3,
    content: "Updated message content",
    // Optional:
    conversation_id: "conv-123"
  }
}
```

## Backend Compatibility

The backend (Phase 1) already supports both:
- Intent envelope format (new)
- Legacy format (for backward compatibility)

This frontend implementation sends only intent envelopes, relying on the backend's Phase 1 compatibility layer to handle the requests.

## Migration Path

Per the schema document, Phase 2 rollout involves:
1. ✅ Deploy intent-enabled frontend
2. ⏳ Monitor telemetry to verify all requests include intents
3. ⏳ Once 100% adoption for 24+ hours, proceed to Phase 3

## Testing

Run the test suite:

```bash
cd frontend
npm test -- --testPathPatterns="(lib.chat|intent)" --no-coverage
```

All tests should pass, verifying:
- Intent envelope generation
- Correct parameter extraction
- Type guards
- Backward compatibility

## Success Criteria

- [x] All chat mutations include well-formed intent envelopes
- [x] `client_operation` is unique per request
- [x] `after_seq` and `after_message_id` extracted from message history
- [x] `expected_seq` passed for edit operations
- [x] Tests verify intent structure
- [x] No regressions in existing functionality

## Next Steps (Phase 3)

Once 100% of production requests include intents for 24+ hours:
1. Backend emits warnings for missing intents
2. Monitor warning volume
3. If warnings remain at ~0% for one week, proceed to Phase 4 (strict enforcement)
