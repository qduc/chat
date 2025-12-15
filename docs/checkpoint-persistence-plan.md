# Checkpoint Persistence Implementation Plan

## Overview

Implement a Draft-Checkpoint-Final persistence pattern to prevent data loss during client disconnects while maintaining good IO performance.

**Goal:** Balance data persistence with performance by periodically saving streaming content.

**Strategy:** Draft-Checkpoint-Final with Hybrid Triggers (time-based OR size-based checkpointing)

---

## Current State vs Target State

### Current Behavior
```
User message → Stream starts → Accumulate in memory → Stream completes → Single DB write
                                                    ↓
                                          Client disconnect → INSERT error row (empty content) ❌
```

### Target Behavior
```
User message → INSERT draft row → Stream starts → Accumulate + periodic UPDATE → Stream completes → Final UPDATE
                                                                               ↓
                                                                    Client disconnect → UPDATE to error (with partial content) ✅
```

---

## Implementation Steps

### Phase 1: Core Infrastructure

#### 1.1 Add Configuration
**File:** `backend/src/config.js`

Add checkpoint configuration to persistence section:

```javascript
persistence: {
  enabled: true,
  retentionDays: 30,
  checkpoint: {
    enabled: true,           // Master switch for checkpointing
    intervalMs: 3000,         // Checkpoint every 3 seconds
    minCharacters: 500,       // OR every 500 characters (whichever comes first)
  }
}
```

**Environment variables** (optional):
- `CHECKPOINT_ENABLED=true`
- `CHECKPOINT_INTERVAL_MS=3000`
- `CHECKPOINT_MIN_CHARACTERS=500`

---

#### 1.2 Extend SimplifiedPersistence Class
**File:** `backend/src/lib/simplifiedPersistence.js`

**Add to constructor:**

```javascript
constructor(config) {
  // ... existing code ...

  // Checkpoint state
  this.lastCheckpoint = 0;              // Timestamp of last checkpoint
  this.lastCheckpointLength = 0;        // Content length at last checkpoint
  this.checkpointConfig = {
    intervalMs: config?.persistence?.checkpoint?.intervalMs ?? 3000,
    minCharacters: config?.persistence?.checkpoint?.minCharacters ?? 500,
    enabled: config?.persistence?.checkpoint?.enabled ?? true,
  };
}
```

**New methods to add:**

```javascript
/**
 * Check if checkpoint is needed based on hybrid triggers
 * @returns {boolean} True if checkpoint should be performed
 */
shouldCheckpoint() {
  if (!this.checkpointConfig.enabled) return false;
  if (!this.persist || !this.currentMessageId) return false;

  const now = Date.now();
  const timeSinceCheckpoint = now - this.lastCheckpoint;
  const contentGrowth = this.assistantBuffer.length - this.lastCheckpointLength;

  // Checkpoint if EITHER condition met
  const timeThresholdMet = timeSinceCheckpoint >= this.checkpointConfig.intervalMs;
  const sizeThresholdMet = contentGrowth >= this.checkpointConfig.minCharacters;

  return timeThresholdMet || sizeThresholdMet;
}

/**
 * Perform checkpoint - save current state to database
 */
performCheckpoint() {
  if (!this.persist || !this.currentMessageId) return;
  if (this.finalized || this.errored) return; // Already finalized

  try {
    const { updateMessageContent } = require('../db/messages.js');

    updateMessageContent({
      messageId: this.currentMessageId,
      conversationId: this.conversationId,
      userId: this.userId,
      content: this.assistantBuffer,
      status: 'draft', // Still in progress
      // Include reasoning if available
      reasoningDetails: this.reasoningDetails || undefined,
      reasoningTokens: this.reasoningTokens || undefined,
    });

    this.lastCheckpoint = Date.now();
    this.lastCheckpointLength = this.assistantBuffer.length;

    logger.debug('[Checkpoint] Saved partial content', {
      conversationId: this.conversationId,
      messageId: this.currentMessageId,
      length: this.assistantBuffer.length,
      seq: this.assistantSeq,
    });
  } catch (error) {
    logger.error('[Checkpoint] Failed to save checkpoint:', error);
    // Don't throw - streaming must continue
  }
}

/**
 * Create initial draft message row
 * Called after user message is recorded, before streaming starts
 */
createDraftMessage() {
  if (!this.persist || !this.conversationId || this.assistantSeq === null) return;

  try {
    const db = getDb();
    const now = new Date().toISOString();

    const result = db.prepare(
      `INSERT INTO messages (conversation_id, role, status, content, seq, created_at, updated_at)
       VALUES (@conversationId, 'assistant', 'draft', '', @seq, @now, @now)`
    ).run({
      conversationId: this.conversationId,
      seq: this.assistantSeq,
      now,
    });

    this.currentMessageId = result.lastInsertRowid;
    this.lastCheckpoint = Date.now();
    this.lastCheckpointLength = 0;

    logger.debug('[Draft] Created draft message', {
      conversationId: this.conversationId,
      messageId: this.currentMessageId,
      seq: this.assistantSeq,
    });
  } catch (error) {
    logger.error('[Draft] Failed to create draft message:', error);
    // Don't throw - fall back to final-only writes
    this.currentMessageId = null;
  }
}
```

---

#### 1.3 Modify Existing Methods

**In `recordUserMessage()`:**

```javascript
async recordUserMessage({ content, images, files, clientMessageId }) {
  // ... existing user message recording ...

  // Reserve sequence number for assistant response
  this.assistantSeq = getNextSeq(this.conversationId);

  // NEW: Create draft message row immediately
  this.createDraftMessage();

  return { ... };
}
```

**In `appendDelta()`:**

```javascript
appendDelta(delta) {
  if (!this.persist) return;

  // ... existing content accumulation logic ...

  // NEW: Check if checkpoint needed
  if (this.shouldCheckpoint()) {
    this.performCheckpoint();
  }
}
```

**In `recordAssistantFinal()`:**

```javascript
recordAssistantFinal({ finishReason = 'stop', responseId = null } = {}) {
  if (!this.persist || !this.conversationId || this.assistantSeq === null) return;
  if (this.finalized || this.errored) return;

  try {
    // NEW: Update existing draft to final instead of INSERT
    if (this.currentMessageId) {
      // Draft already exists, update it
      const { updateMessageContent } = require('../db/messages.js');

      updateMessageContent({
        messageId: this.currentMessageId,
        conversationId: this.conversationId,
        userId: this.userId,
        content: this.assistantContentJson ?? this.assistantBuffer,
        status: 'final', // Mark as complete
        reasoningDetails: this._finalizeReasoningDetails(),
        reasoningTokens: this.reasoningTokens,
      });

      // Update response_id separately if needed
      if (responseId || this.responseId) {
        const db = getDb();
        db.prepare('UPDATE messages SET response_id = ? WHERE id = ?')
          .run(responseId || this.responseId, this.currentMessageId);
      }

      logger.debug('[Finalize] Updated draft to final', {
        conversationId: this.conversationId,
        messageId: this.currentMessageId,
        finishReason,
      });
    } else {
      // Fallback: Draft creation failed, use old INSERT behavior
      const result = this.conversationManager.recordAssistantMessage({
        conversationId: this.conversationId,
        content: this.assistantContentJson ?? this.assistantBuffer,
        seq: this.assistantSeq,
        finishReason,
        responseId: responseId || this.responseId,
        reasoningDetails: this._finalizeReasoningDetails(),
        reasoningTokens: this.reasoningTokens,
      });

      this.currentMessageId = result?.id || null;
    }

    this.assistantMessageId = this.currentMessageId;
    this.finalized = true;

    // Persist buffered tool calls and outputs
    this.persistToolCallsAndOutputs();
  } catch (error) {
    logger.error('[SimplifiedPersistence] Failed to record assistant final:', error);
    throw error;
  }
}
```

**In `markError()`:**

```javascript
markError() {
  if (!this.persist || !this.conversationId || this.assistantSeq === null) return;
  if (this.finalized || this.errored) return;

  try {
    if (this.currentMessageId) {
      // NEW: Update existing draft to error (preserves partial content!)
      const { updateMessageContent } = require('../db/messages.js');

      updateMessageContent({
        messageId: this.currentMessageId,
        conversationId: this.conversationId,
        userId: this.userId,
        content: this.assistantBuffer, // Preserve partial content
        status: 'error',
      });

      logger.info('[Error] Preserved partial content on disconnect', {
        conversationId: this.conversationId,
        messageId: this.currentMessageId,
        partialLength: this.assistantBuffer.length,
      });
    } else {
      // Fallback: Use old behavior if draft doesn't exist
      this.conversationManager.markAssistantError(this.conversationId, this.assistantSeq);
    }

    this.errored = true;
  } catch (error) {
    logger.error('[SimplifiedPersistence] Failed to mark error:', error);
    // Don't re-throw as this is cleanup
  }
}
```

---

### Phase 2: Testing

#### 2.1 Unit Tests
**File:** `backend/__tests__/simplifiedPersistence.test.js` (create if doesn't exist)

Test cases needed:

```javascript
describe('Checkpoint Persistence', () => {
  test('creates draft message immediately after user message', async () => {
    // Assert draft row inserted with status='draft'
  });

  test('performs checkpoint when time threshold met', async () => {
    // Simulate 3+ second delay
    // Assert content updated in database
  });

  test('performs checkpoint when size threshold met', async () => {
    // Append 500+ characters
    // Assert content updated in database
  });

  test('does not checkpoint when both thresholds not met', async () => {
    // Append 100 chars within 1 second
    // Assert no UPDATE called
  });

  test('updates draft to final on successful completion', async () => {
    // Assert status changed from 'draft' to 'final'
  });

  test('preserves partial content on disconnect', async () => {
    // Simulate client disconnect
    // Assert error message has partial content, not empty
  });

  test('respects checkpoint.enabled=false config', async () => {
    // Set config.persistence.checkpoint.enabled = false
    // Assert no checkpoints performed
  });

  test('falls back to INSERT if draft creation fails', async () => {
    // Mock createDraftMessage to fail
    // Assert recordAssistantFinal uses old INSERT behavior
  });
});
```

#### 2.2 Integration Tests
**File:** `integration/checkpoint-persistence.test.js`

Test full streaming flow:

```javascript
describe('Checkpoint Persistence Integration', () => {
  test('preserves content on real client disconnect', async () => {
    // Start streaming response
    // Abort request mid-stream
    // Query database
    // Assert partial content saved with status='error'
  });

  test('normal completion updates to final status', async () => {
    // Complete full streaming response
    // Query database
    // Assert full content saved with status='final'
  });
});
```

#### 2.3 Manual Testing Checklist

- [ ] Start streaming response, disconnect client mid-stream
  - Check database: message should exist with partial content, status='error'
- [ ] Complete streaming response normally
  - Check database: message should have full content, status='final'
- [ ] Test with checkpoint disabled (config.persistence.checkpoint.enabled=false)
  - Verify old behavior (no draft, single final write)
- [ ] Test with very long responses (5000+ characters)
  - Verify multiple checkpoints occur
- [ ] Test with very short responses (<100 characters)
  - Verify minimal checkpoints (maybe 0-1)
- [ ] Check logs for checkpoint frequency
  - Tune intervalMs and minCharacters if needed

---

### Phase 3: Configuration & Deployment

#### 3.1 Environment Variables

Add to `.env.example` and deployment docs:

```bash
# Checkpoint persistence (optional, defaults shown)
CHECKPOINT_ENABLED=true
CHECKPOINT_INTERVAL_MS=3000
CHECKPOINT_MIN_CHARACTERS=500
```

#### 3.2 Migration (if needed)

Check if `messages.status` column supports 'draft' value. Current values: 'final', 'error'.

**If migration needed:**
```sql
-- No migration needed if status is TEXT without constraints
-- Current schema should already support any TEXT value
```

#### 3.3 Database Query Performance

Add index if not exists (likely already covered by existing indexes):

```sql
-- Check if index exists on (conversation_id, seq)
-- This is critical for fast checkpoint UPDATEs
CREATE INDEX IF NOT EXISTS idx_messages_conversation_seq
  ON messages(conversation_id, seq);
```

---

### Phase 4: Monitoring & Tuning

#### 4.1 Metrics to Track

Add logging/metrics for:
- Checkpoint frequency per response
- Average response length when checkpointed
- Disconnect rate with/without partial content
- Database write latency for checkpoints

#### 4.2 Performance Benchmarks

Before/after comparison:
- Measure p50, p95, p99 latency for streaming responses
- Measure SQLite write throughput
- Check for any noticeable client-side latency

#### 4.3 Tuning Guidelines

**If too many checkpoints (>10 per response):**
- Increase `intervalMs` to 5000
- Increase `minCharacters` to 1000

**If still losing significant content on disconnect:**
- Decrease `intervalMs` to 2000
- Decrease `minCharacters` to 300

**Default values (3s, 500 chars) are good starting points for most use cases.**

---

## Rollout Plan

### Stage 1: Development
1. Implement changes in `simplifiedPersistence.js`
2. Add unit tests
3. Test locally with manual disconnects
4. Review logs for checkpoint frequency

### Stage 2: Staging
1. Deploy to staging environment
2. Run integration tests
3. Monitor checkpoint frequency and performance
4. Collect metrics on partial content preservation

### Stage 3: Production (with feature flag)
1. Deploy with `CHECKPOINT_ENABLED=false` initially
2. Enable for 10% of users
3. Monitor for issues
4. Gradually increase to 100%

### Stage 4: Cleanup
1. Remove feature flag if stable
2. Document in architecture docs
3. Add to onboarding guide

---

## Rollback Plan

If issues arise:

**Immediate rollback:**
```bash
CHECKPOINT_ENABLED=false
```

**Partial rollback:**
- Increase `intervalMs` to very high value (e.g., 300000 = 5 minutes)
- Effectively disables time-based checkpointing while keeping size-based

**Code rollback:**
- Revert changes to `simplifiedPersistence.js`
- Old behavior: final-only writes
- No data loss risk (only feature loss)

---

## Success Criteria

✅ Partial content preserved on client disconnect (status='error')
✅ Normal completions still work (status='final')
✅ No noticeable performance degradation (<50ms added latency)
✅ Checkpoint frequency reasonable (2-10 per response for long responses)
✅ Configuration works (can enable/disable, tune thresholds)
✅ Tests pass (unit + integration)

---

## Future Enhancements

### Option 1: Adaptive Checkpointing
- Checkpoint more frequently for slow responses
- Checkpoint less frequently for rapid streaming

### Option 2: Tool Call Checkpointing
- Checkpoint after each tool execution completes
- Preserves tool outputs even if later steps fail

### Option 3: Client-Side Resume
- Send checkpoint indicators to client
- Client can resume from last checkpoint on reconnect

### Option 4: Debounced Checkpointing
- Add debounce timer (checkpoint only during pauses)
- Reduces writes during rapid continuous streaming

---

## Files Modified Summary

| File | Changes |
|------|---------|
| `backend/src/config.js` | Add checkpoint configuration |
| `backend/src/lib/simplifiedPersistence.js` | Add checkpoint logic (4 new methods, 3 modified methods) |
| `backend/__tests__/simplifiedPersistence.test.js` | Add checkpoint tests |
| `integration/checkpoint-persistence.test.js` | Add integration tests |
| `.env.example` | Add checkpoint env vars |
| `docs/checkpoint-persistence-plan.md` | This document |

---

## Estimated Effort

- **Implementation:** 4-6 hours
- **Testing:** 3-4 hours
- **Documentation:** 1-2 hours
- **Deployment & monitoring:** 2-3 hours

**Total:** 10-15 hours

---

## Questions & Decisions

### Q: Should we checkpoint reasoning content separately?
**A:** Yes, include reasoning in checkpoints using existing fields (`reasoningDetails`, `reasoningTokens`).

### Q: What about tool calls during streaming?
**A:** Tool calls are already buffered and saved at the end. For now, keep this behavior. Future enhancement could checkpoint tool calls separately.

### Q: Should we clean up old draft messages?
**A:** Existing retention sweep handles all messages. Draft messages with status='error' will be cleaned up normally.

### Q: What if database is slow?
**A:** Checkpoint is non-blocking - errors are logged but don't stop streaming. If UPDATE takes >1s, next checkpoint will be delayed naturally.

---

## References

- Current persistence implementation: `backend/src/lib/simplifiedPersistence.js`
- Message database schema: `backend/scripts/migrations/`
- Tool orchestration: `docs/tool_orchestration_deep_dive.md`
- updateMessageContent: `backend/src/db/messages.js:526`
