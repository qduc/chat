# Message Intent Schema - Architecture Diagram

## Request Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                           CLIENT REQUEST                             │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│ POST /v1/chat/completions                                           │
│ {                                                                    │
│   "intent": {                                                        │
│     "type": "append_message",                                        │
│     "client_operation": "op-123",                                    │
│     "conversation_id": "conv-uuid",                                  │
│     "after_message_id": "msg-uuid",                                  │
│     "after_seq": 5,                                                  │
│     "messages": [...],                                               │
│     "completion": {...}                                              │
│   }                                                                  │
│ }                                                                    │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      MIDDLEWARE STACK                                │
├─────────────────────────────────────────────────────────────────────┤
│  1. authenticateToken        ✅ Verify user identity                │
│  2. detectIntentEnvelope     ✅ Check for intent field              │
│  3. validateAppendIntent     ✅ Validate intent structure           │
│  4. transformIntentToLegacy  ✅ Convert to legacy format            │
│  5. wrapIntentResponse       ✅ Prepare response wrapper            │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      VALIDATION SERVICE                              │
├─────────────────────────────────────────────────────────────────────┤
│  • validateAppendMessageIntent()                                     │
│    ├─ Check conversation exists                                     │
│    ├─ Verify after_message_id exists                                │
│    ├─ Validate after_seq matches (optimistic lock)                  │
│    └─ Ensure after_message_id is last (if !truncate_after)         │
│                                                                      │
│  Error Codes:                                                        │
│  • conversation_not_found                                            │
│  • message_not_found                                                 │
│  • seq_mismatch (optimistic lock failure)                           │
│  • not_last_message                                                  │
│  • missing_required_field                                            │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                         ✅ Valid │ ❌ Invalid
                                  │
                    ┌─────────────┴─────────────┐
                    ▼                           ▼
    ┌───────────────────────────┐   ┌──────────────────────┐
    │   EXISTING HANDLER        │   │   ERROR RESPONSE     │
    │   (unchanged logic)       │   │   {                  │
    │                           │   │     "success": false,│
    │   proxyOpenAIRequest()    │   │     "error": "...",  │
    │                           │   │     "error_code": ...│
    │   • Insert user message   │   │   }                  │
    │   • Call AI provider      │   └──────────────────────┘
    │   • Insert assistant msg  │
    │   • Track operations      │
    └───────────────────────────┘
                    │
                    ▼
    ┌───────────────────────────────────────────┐
    │      OPERATIONS TRACKER                   │
    ├───────────────────────────────────────────┤
    │  inserted: [                              │
    │    { id: "msg-1", seq: 6, role: "user" }, │
    │    { id: "msg-2", seq: 7, role: "asst" } │
    │  ],                                        │
    │  updated: [],                              │
    │  deleted: []                               │
    └───────────────────────────────────────────┘
                    │
                    ▼
    ┌───────────────────────────────────────────┐
    │      RESPONSE WRAPPER                     │
    ├───────────────────────────────────────────┤
    │  • Intercepts res.json()                  │
    │  • Transforms to intent format            │
    │  • Adds client_operation                  │
    │  • Includes operations list               │
    └───────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         SUCCESS RESPONSE                             │
├─────────────────────────────────────────────────────────────────────┤
│ {                                                                    │
│   "success": true,                                                   │
│   "conversation_id": "conv-uuid",                                    │
│   "client_operation": "op-123",                                      │
│   "operations": {                                                    │
│     "inserted": [                                                    │
│       { "id": "msg-1", "seq": 6, "role": "user" },                  │
│       { "id": "msg-2", "seq": 7, "role": "assistant" }              │
│     ],                                                               │
│     "updated": [],                                                   │
│     "deleted": []                                                    │
│   }                                                                  │
│ }                                                                    │
└─────────────────────────────────────────────────────────────────────┘
```

## Edit Message Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│ PUT /v1/conversations/:id/messages/:msgId/edit                      │
│ {                                                                    │
│   "intent": {                                                        │
│     "type": "edit_message",                                          │
│     "client_operation": "op-456",                                    │
│     "message_id": "msg-to-edit",                                     │
│     "expected_seq": 3,                                               │
│     "content": "Updated content"                                     │
│   }                                                                  │
│ }                                                                    │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      VALIDATION                                      │
├─────────────────────────────────────────────────────────────────────┤
│  • Message exists?                                                   │
│  • Seq matches? (optimistic lock)                                   │
│  • Role is "user"?                                                   │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      ATOMIC OPERATION                                │
├─────────────────────────────────────────────────────────────────────┤
│  1. Update message content                                           │
│  2. Get all messages after seq=3                                     │
│  3. Fork conversation with those messages                            │
│  4. Delete messages > seq=3 from original                            │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         RESPONSE                                     │
├─────────────────────────────────────────────────────────────────────┤
│ {                                                                    │
│   "success": true,                                                   │
│   "conversation_id": "original-conv",                                │
│   "client_operation": "op-456",                                      │
│   "operations": {                                                    │
│     "inserted": [],                                                  │
│     "updated": [{ "id": "msg-to-edit", "seq": 3, "role": "user" }], │
│     "deleted": [{ "id": "msg-4", "seq": 4, "role": "assistant" }]   │
│   },                                                                 │
│   "fork_conversation_id": "forked-conv"                              │
│ }                                                                    │
└─────────────────────────────────────────────────────────────────────┘
```

## Optimistic Locking Example

```
Time    Client A                  Client B                  Server State
────────────────────────────────────────────────────────────────────────
t0      Load conversation         Load conversation         seq=5
        (msg-5, seq=5)           (msg-5, seq=5)           

t1      Edit msg-5                                          seq=5
        with expected_seq=5      
        ✅ Success!                                         seq=5→6
                                                            (new fork)

t2                                Edit msg-5                seq=6
                                  with expected_seq=5      
                                  ❌ seq_mismatch!          seq=6
                                  
                                  Error: {
                                    "error_code": "seq_mismatch",
                                    "details": {
                                      "expected": 6,
                                      "actual": 5
                                    }
                                  }

t3                                Reload conversation       seq=6
                                  (msg-5, seq=6)           
                                  
                                  Edit with expected_seq=6  
                                  ✅ Success!               seq=6→7
```

## Backward Compatibility

```
┌─────────────────────────┐         ┌─────────────────────────┐
│   Legacy Client         │         │   Intent Client         │
│   (no changes needed)   │         │   (new format)          │
└───────────┬─────────────┘         └───────────┬─────────────┘
            │                                   │
            │ POST /v1/chat/completions         │ POST /v1/chat/completions
            │ {                                 │ {
            │   "messages": [...],              │   "intent": {
            │   "model": "gpt-4"                │     "type": "append_message",
            │ }                                 │     "client_operation": "...",
            │                                   │     "messages": [...],
            │                                   │     "completion": {...}
            │                                   │   }
            │                                   │ }
            │                                   │
            ▼                                   ▼
┌───────────────────────────────────────────────────────────────────┐
│                          BACKEND                                  │
│                                                                   │
│  detectIntentEnvelope                                             │
│  ├─ No intent? → Skip validation, use legacy handler             │
│  └─ Has intent? → Validate & transform                           │
│                                                                   │
└───────────────────────────────────────────────────────────────────┘
            │                                   │
            │ Legacy Response                   │ Intent Response
            │ {                                 │ {
            │   "id": "chatcmpl-...",           │   "success": true,
            │   "choices": [...],               │   "conversation_id": "...",
            │   ...                             │   "client_operation": "...",
            │ }                                 │   "operations": {...}
            │                                   │ }
            ▼                                   ▼
┌─────────────────────────┐         ┌─────────────────────────┐
│   Legacy Client         │         │   Intent Client         │
│   (works unchanged)     │         │   (new format)          │
└─────────────────────────┘         └─────────────────────────┘
```

## Key Components

### Validation Schemas (Zod)
- `appendMessageIntentSchema`
- `editMessageIntentSchema`
- `intentEnvelopeSchema`
- `intentSuccessResponseSchema`
- `intentErrorResponseSchema`

### Middleware Functions
- `detectIntentEnvelope` - Parses and validates envelope
- `validateAppendIntent` - Business logic validation
- `validateEditIntent` - Business logic validation
- `transformIntentToLegacy` - Backward compatibility
- `wrapIntentResponse` - Response formatting

### Service Functions
- `validateAppendMessageIntent()` - Append validation
- `validateEditMessageIntent()` - Edit validation
- `OperationsTracker` - Track changes
- `createIntentError()` - Error factory
- `createIntentSuccess()` - Success factory

### Error Codes
- `conversation_not_found`
- `message_not_found`
- `seq_mismatch`
- `not_last_message`
- `missing_required_field`
- `edit_not_allowed`
- `invalid_intent`
