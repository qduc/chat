# Debugging `seq` Issues in Existing Conversations

This guide helps you debug why `seq` values might be missing when sending follow-up messages in existing conversations.

## Debug Flow Overview

I've added debug logging at 6 critical checkpoints in the message flow. Open your browser console and follow these steps:

## Step-by-Step Debugging

### 1. Load an Existing Conversation

**Action:** Click on an existing conversation in the sidebar

**What to check in console:**

```
[DEBUG] Backend messages: [...]
```
- ✅ **PASS**: Each message should have `seq` defined (1, 2, 3, etc.)
- ❌ **FAIL**: If `seq: undefined` → Backend is not returning seq values (backend issue)

```
[DEBUG] Local messages after load: [...]
```
- ✅ **PASS**: `seq` should match the backend values exactly
- ❌ **FAIL**: If `seq: undefined` → Frontend mapping issue in `conversationActions.ts:76`

```
[DEBUG] SET_MESSAGES reducer - incoming payload: [...]
```
- ✅ **PASS**: `seq` values should still be present
- ❌ **FAIL**: If `seq: undefined` → Reducer is not receiving seq (dispatch issue)

### 2. Send a Follow-up Message

**Action:** Type a message and click send

**What to check in console:**

```
[DEBUG] State messages before send: [...]
```
- ✅ **PASS**: All existing messages should have `seq` values
- ❌ **FAIL**: If `seq: undefined` → State was corrupted after loading

```
[DEBUG] START_STREAMING - existing messages: [...]
```
- ✅ **PASS**: Messages should still have `seq` before adding new ones
- ❌ **FAIL**: If `seq: undefined` → State corruption between send and reducer

```
[DEBUG] START_STREAMING - new user message seq: undefined
```
- ✅ **EXPECTED**: New messages always have `seq: undefined` initially
- ❌ **UNEXPECTED**: If it has a seq value somehow

```
[DEBUG] Message to send: { ... }
```
- ✅ **PASS**: Should be the last **user** message with `seq` defined (from state)
- ❌ **FAIL**: If `seq: undefined` → Message selection logic is wrong

```
[DEBUG] Adding seq to outgoing message: <number>
```
- ✅ **PASS**: You should see this log with the seq number
- ❌ **FAIL**: If you see "No seq on message" → `seq` was lost in config building

```
[DEBUG] Final outgoing message to backend: { ... }
```
- ✅ **PASS**: Should include `seq` in the object and in `allKeys` array
- ❌ **FAIL**: If `hasSeq: false` → seq was lost during spread operation

## Common Issues and Solutions

### Issue 1: Backend not returning seq
**Symptoms:** First log shows `seq: undefined` for all messages

**Solution:** Check backend database and message serialization
```bash
./dev.sh exec backend npm run test -- __tests__/db.test.js
```

### Issue 2: Frontend mapping drops seq
**Symptoms:** Backend has seq, but "Local messages after load" doesn't

**Solution:** Check `conversationActions.ts:76` - the spread operator should include seq:
```typescript
...(m.seq !== undefined && { seq: m.seq })
```

### Issue 3: State corruption
**Symptoms:** Messages have seq when loaded, but lose it before sending

**Solution:** Check if any reducer is transforming messages without preserving seq. Search for:
```bash
grep -r "messages.map" frontend/hooks/useChatState/reducers/
```

### Issue 4: Wrong message selected
**Symptoms:** seq exists in state, but wrong message selected for sending

**Solution:** Check `useChatHelpers.ts:96-100` - should select latest USER message:
```typescript
const latestUserMessage = [...normalizedMessages]
  .reverse()
  .find((message) => message.role === 'user');
```

### Issue 5: New chat vs existing chat confusion
**Symptoms:** Works for new chats but not existing ones (or vice versa)

**Solution:** Check if `conversationId` is being set correctly:
- New chat: `conversationId` should be `null` initially
- Existing chat: `conversationId` should be the conversation ID

## Expected Console Output (Success Case)

For an existing conversation with 2 messages (seq 1, 2) sending a 3rd message:

```
[DEBUG] Backend messages: [
  { id: 1, role: 'user', seq: 1, hasSeq: true },
  { id: 2, role: 'assistant', seq: 2, hasSeq: true }
]

[DEBUG] Local messages after load: [
  { id: '1', role: 'user', seq: 1, hasSeq: true },
  { id: '2', role: 'assistant', seq: 2, hasSeq: true }
]

[DEBUG] SET_MESSAGES reducer - incoming payload: [
  { id: '1', role: 'user', seq: 1, hasSeq: true },
  { id: '2', role: 'assistant', seq: 2, hasSeq: true }
]

[DEBUG] State messages before send: [
  { id: '1', role: 'user', seq: 1, hasSeq: true },
  { id: '2', role: 'assistant', seq: 2, hasSeq: true }
]

[DEBUG] START_STREAMING - existing messages: [
  { id: '1', role: 'user', seq: 1, hasSeq: true },
  { id: '2', role: 'assistant', seq: 2, hasSeq: true }
]

[DEBUG] START_STREAMING - new user message seq: undefined

[DEBUG] Message to send: {
  id: '1', role: 'user', seq: 1, hasSeq: true
}

[DEBUG] Adding seq to outgoing message: 1

[DEBUG] Final outgoing message to backend: {
  role: 'user',
  seq: 1,
  hasSeq: true,
  allKeys: ['role', 'content', 'seq']
}
```

## After Debugging

Once you identify the issue:

1. Remove the debug logs:
```bash
# Find all debug logs
grep -r "\[DEBUG\]" frontend/
```

2. Fix the root cause based on the checkpoint where seq was lost

3. Verify fix with the existing test suite:
```bash
./dev.sh exec frontend npm test -- messageSeq.test.ts
```

## Quick Test Script

Run this in browser console to check current state:

```javascript
// Assuming you have access to the chat state
console.log('Current messages:', window.__chatState?.messages?.map(m => ({
  id: m.id,
  role: m.role,
  seq: m.seq,
  hasSeq: m.seq !== undefined
})));
```
