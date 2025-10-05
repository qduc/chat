# Message Synchronization Refactoring Plan

## Executive Summary

The current `syncMessageHistory` implementation uses a clear-and-rewrite pattern that is simple but introduces tight coupling, performance overhead, and data loss risks. This document outlines a refactoring plan to migrate to a diff-based synchronization approach that addresses these architectural concerns while relying solely on the data we already persist (no new request fields required).

## Current Implementation Analysis

### How It Works Today

**Location**: `backend/src/lib/persistence/ConversationManager.js:82-129`

**Pattern**: Clear-and-rewrite with manual metadata preservation

1. Load all existing assistant tool data (`_loadExistingAssistantToolData`)
2. Clear all messages via `clearAllMessages` (line 86)
3. Rewrite messages sequentially from frontend array
4. Manually restore tool calls/outputs for assistant messages (lines 109-126)

### Verified Technical Debt Issues

#### 1. Tight Coupling
- **Problem**: Each new assistant metadata type requires manual preservation code
- **Current metadata**: tool calls, tool outputs
- **Future metadata**: reasoning traces, token usage, custom annotations
- **Impact**: High maintenance burden, easy to forget new fields

#### 2. Performance Overhead
- **Problem**: Full message sweep happens twice per request
- **Details**:
  - `_loadExistingAssistantToolData` pages through all messages (200/page)
  - Messages are then deleted and rewritten
- **Impact**: O(2n) for large conversations, unnecessary database load

#### 3. Data Loss Risk
- **Problem**: Frontend history is authoritative but potentially incomplete
- **Current behavior**:
  - `simplifiedPersistence.js:151` passes frontend `messages` array directly
  - If frontend drops messages (lag, state churn), they're silently deleted
- **Impact**: No validation, silent data loss possible

#### 4. Cascade Effects
- **Database**: `clearAllMessages` triggers cascading deletes via foreign keys
- **Related tables**: tool_calls, tool_outputs automatically deleted
- **Impact**: Tight coupling between message lifecycle and related data

### Code References

**Main sync function**:
```javascript
// ConversationManager.js:82-129
syncMessageHistory(conversationId, userId, messages) {
  const preservedAssistants = this._loadExistingAssistantToolData(conversationId);
  clearAllMessages({ conversationId, userId });
  // ... rewrite logic with manual preservation
}
```

**Call site**:
```javascript
// simplifiedPersistence.js:151
this.conversationManager.syncMessageHistory(this.conversationId, userId, messages);
```

**Database clear operation**:
```javascript
// db/messages.js:368-385
export function clearAllMessages({ conversationId, userId }) {
  // Validates ownership then: DELETE FROM messages WHERE conversation_id = ...
}
```

## Proposed Solution: Diff-Based Synchronization

### High-Level Approach

Replace clear-and-rewrite with incremental updates that infer alignment server-side:
1. Load existing messages once (not twice)
2. Align incoming history with stored records via suffix matching (handles truncated payloads)
3. Compute diff using stored `seq` anchors and classify inserts/updates/deletes
4. Apply changes transactionally; fall back to legacy clear-and-rewrite if alignment looks unsafe
5. Preserve message + tool metadata by updating rows in place instead of rehydrating manually

### Key Benefits

1. **Decoupling**: Metadata preserved automatically (no manual code per field)
2. **Performance**: Single sweep O(n) instead of double O(2n)
3. **Safety**: Alignment validation + fallback prevent silent data loss
4. **Maintainability**: Future metadata fields work automatically
5. **Compatibility**: No new request fields; existing clients continue working

## Implementation Plan

### Phase 1: Analysis & Design

**Tasks**:
- [ ] Analyze current message sync patterns and identify all call sites
- [ ] Design diff-based message sync algorithm (insert/update/delete logic)

**Deliverables**:
- Call site inventory
- Diff algorithm specification
- Alignment strategy spec (tail matching + fallback rules)

**Design Details**:

**Diff Algorithm**:
```javascript
function computeMessageDiff(existing, incoming) {
  // 1. Align incoming array with stored records by scanning for the longest
  //    matching suffix (role + content) so truncated histories can still sync.
  // 2. Once aligned, walk the overlapping window in lockstep using the stored
  //    message seq values as the stable anchor.
  // 3. Classify differences:
  //      - toInsert: messages that extend beyond the stored tail
  //      - toUpdate: same seq but diverging payload (content/tool metadata)
  //      - toDelete: stored tail messages beyond the incoming length
  // 4. If no reasonable alignment is found, return { fallback: true } so the
  //    caller can fall back to clear-and-rewrite for safety.

  return {
    toInsert: [],
    toUpdate: [],
    toDelete: [],
    unchanged: [],
    fallback: false,
    anchorOffset: 0, // how many stored messages were skipped due to truncation
  };
}
```

**Alignment & Validation (Backend-Only)**:
- Use stored `seq` as the canonical identifier; clients are not required to send it.
- Detect truncated histories by matching contiguous suffixes; operate only on the overlapping window.
- Reject impossible reorderings (e.g., mismatched roles/content before the anchor) and signal fallback.
- Only tail deletions are applied automatically; earlier gaps trigger fallback to the legacy flow.

### Phase 2: Core Implementation

**Tasks**:
- [ ] Build alignment utility that matches incoming histories to stored sequences (handles truncation + fallback)
- [ ] Implement new `syncMessageHistoryDiff` method in ConversationManager with automatic fallback to legacy sync
- [ ] Reuse/Add database helpers for targeted updates (`updateMessageContent`, `deleteMessagesAfterSeq`, tool call/output upserts)
- [ ] Create metadata synchronization helper that first attempts granular diffs (`diffAssistantArtifacts`) and only falls back to replace-on-change when necessary

**File Structure**:

**New utility** (`backend/src/lib/utils/messageDiff.js`):
```javascript
export function computeMessageDiff(existing, incoming) { /* ... */ }
export function normalizeMessage(msg) { /* content normalization */ }
export function messagesEqual(msg1, msg2) { /* deep comparison */ }
```

**Enhanced ConversationManager**:
```javascript
// New method
syncMessageHistoryDiff(conversationId, userId, messages) {
  // 1. Load existing messages once
  const existing = this._loadAllMessages(conversationId);

  // 2. Compute diff (may signal fallback)
  const diff = computeMessageDiff(existing, messages);

  // 3. Fall back if alignment failed or safety checks require it
  if (diff.fallback) {
    return this._legacySyncMessageHistory(conversationId, userId, messages);
  }

  // 4. Apply changes transactionally with existing seq anchors
  this._applyMessageDiff(conversationId, userId, diff);
}

_loadAllMessages(conversationId) {
  // Single paginated read (replaces _loadExistingAssistantToolData)
}

_applyMessageDiff(conversationId, userId, diff) {
  const db = getDb();
  const transaction = db.transaction(() => {
    // Messages before diff.anchorOffset are already identical and skipped

    // INSERT new messages
    for (const msg of diff.toInsert) { /* ... */ }

    // UPDATE modified messages
    for (const msg of diff.toUpdate) {
      /*
       * 1. updateMessageContent(msg.id, ...)
       * 2. diffAssistantArtifacts(...) for fine-grained tool preservation
       * 3. If diffing signals fallback (structure changed wildly), use replaceAssistantArtifacts
       */
    }

    // DELETE from tail only
    if (diff.toDelete.length > 0) { /* ... */ }
  });

  transaction();
}

_legacySyncMessageHistory(conversationId, userId, messages) {
  // Thin wrapper around the current clear-and-rewrite logic for safety fallbacks
}
```

**Database helpers** (`db/messages.js`):
```javascript
export function getAllMessagesForSync({ conversationId, userId }) {
  // Thin wrapper over getMessagesPage to stream the full set once per sync
}

export function updateMessageContent(...) {
  // Already exists – reuse to keep content/content_json in sync
}

export function diffAssistantArtifacts({ messageId, nextToolCalls, nextToolOutputs }) {
  // Computes minimal INSERT/UPDATE/DELETE set keyed by call_index/tool_call_id
}

export function replaceAssistantArtifacts({ messageId, toolCalls, toolOutputs }) {
  // Fallback: clear + reinsert when structure changes too much to diff safely
}
```

### Phase 3: Migration & Testing

**Tasks**:
- [ ] Write comprehensive tests for diff-based message sync
- [ ] Test edge cases (empty history, truncated tails, large conversations)
- [ ] Update `simplifiedPersistence` to use new diff-based sync with legacy fallback
- [ ] Performance benchmarks (compare old vs new)

**Test Coverage**:

**Unit Tests** (`__tests__/messageDiff.test.js`):
- Diff algorithm correctness
  - Empty existing + incoming messages
  - All new messages
  - All unchanged messages
  - Mixed insert/update/delete
  - Out-of-order incoming (should reject)
  - Mid-conversation gaps (should reject)

**Integration Tests** (`__tests__/conversation_sync.test.js`):
- Sync operation end-to-end
  - Fresh conversation (insert only)
  - Append messages (insert new)
  - Edit message content (update)
  - Regenerate last message (delete + insert)
  - Tool metadata preservation across updates (diff path + fallback)
  - Image metadata preservation across updates
  - Truncated history where only tail is provided (should align)
  - Alignment failure path (forces fallback)

**Performance Tests**:
- Small conversations (10 messages): old vs new
- Medium conversations (100 messages): old vs new
- Large conversations (1000+ messages): old vs new
- Worst case: all messages modified

**Edge Cases**:
| Scenario | Expected Behavior |
|----------|------------------|
| Empty incoming history | Delete all messages |
| Partial history (first N) | Align on suffix; fallback if overlap cannot be found |
| Reordered messages | Reject (alignment fails → fallback) |
| Modified message in middle | Update specific message, preserve rest |
| Deleted tail messages | Remove from seq > threshold |
| Content normalization | Whitespace/formatting differences ignored |

### Phase 4: Validation & Documentation

**Tasks**:
- [ ] Document backend alignment + fallback semantics (no client contract change)
- [ ] Add validation + structured logging around alignment outcomes and fallbacks
- [ ] Share best-practice guidance for clients (e.g., fetch latest convo before editing)

**Backend Alignment Contract**:
```javascript
function determineAlignment(existing, incoming) {
  // Returns { overlapStart, overlapLength } or { fallback: true }
  // Also records metrics (alignment_success, alignment_fallback)
}

function validateAlignedWindow(existingSlice, incomingSlice) {
  // Ensures roles/content match before applying updates
  // Rejects impossible reorderings → signals fallback
}
```

**Operational Notes**:
- No new request payload fields required; alignment is inferred server-side.
- Emit metrics/logs when falling back to legacy sync so we can monitor rollout health.
- Update `AGENTS.md` and tooling docs to describe tail-alignment behavior and recommend refreshing conversations before sending edits/regenerations.

### Phase 5: Deprecation & Cleanup

**Tasks**:
- [ ] Deprecate old `syncMessageHistory` with migration path
- [ ] Remove old implementation (next major version)

**Deprecation Strategy**:

**Step 1**: Mark as deprecated (v1.x)
```javascript
/**
 * @deprecated Use syncMessageHistoryDiff instead
 * Will be removed in v2.0
 */
syncMessageHistory(conversationId, userId, messages) {
  console.warn('syncMessageHistory is deprecated. Use syncMessageHistoryDiff.');
  // Keep old implementation for backward compatibility
}
```

**Step 2**: Feature flag rollout
```javascript
const USE_DIFF_SYNC = process.env.FEATURE_DIFF_SYNC === 'true';

if (USE_DIFF_SYNC) {
  conversationManager.syncMessageHistoryDiff(...);
} else {
  conversationManager.syncMessageHistory(...);
}
```

**Step 3**: Remove in v2.0
- Delete `syncMessageHistory`
- Delete `_loadExistingAssistantToolData`
- Update all call sites to new method

## Expected Outcomes

### Performance Improvements

| Metric | Current (Clear-and-Rewrite) | New (Diff-Based) | Improvement |
|--------|---------------------------|-----------------|-------------|
| Database reads (1000 msg) | 10 pages × 2 = 20 queries | 10 pages × 1 = 10 queries | 50% reduction |
| Database writes (1 new msg) | 1000 DELETEs + 1001 INSERTs | 1 INSERT | 99.9% reduction |
| Database writes (1 edit) | 1000 DELETEs + 1000 INSERTs | 1 UPDATE | 99.95% reduction |
| Memory usage | All messages loaded twice | All messages loaded once | 50% reduction |

### Code Quality Improvements

**Maintainability**:
- New metadata fields require **zero** preservation code (automatic)
- Diff logic centralized in one utility (not scattered)
- Clear separation of concerns (diff computation vs application)

**Safety**:
- Validation prevents silent data loss
- Sequence number checks catch inconsistencies
- Transaction guarantees atomicity

**Testability**:
- Diff algorithm pure function (easy to test)
- Mock-free unit tests (no database needed)
- Deterministic behavior (no side effects)

## Risks & Mitigations

### Risk 1: Diff Logic Bugs Could Corrupt History

**Impact**: High
**Probability**: Medium (during initial implementation)

**Mitigation**:
- Comprehensive test coverage (>95% for diff logic)
- Feature flag rollout (gradual adoption)
- Database backups before deployment
- Monitoring/alerting for sequence validation failures

### Risk 2: Breaking Changes to Frontend Contract

**Impact**: Medium
**Probability**: Low (contract is backward compatible)

**Mitigation**:
- Maintain backward compatibility during transition
- Deprecation period with warnings
- Frontend can continue sending full history (works with both)

### Risk 3: Performance Regression for Small Conversations

**Impact**: Low
**Probability**: Low (diff overhead minimal)

**Mitigation**:
- Benchmark small, medium, large conversations
- Optimize diff algorithm if needed
- Consider fast path for append-only operations

### Risk 4: Foreign Key Cascade Behavior Changes

**Impact**: Medium
**Probability**: Medium (UPDATE vs DELETE+INSERT)

**Mitigation**:
- Review all foreign key constraints
- Ensure UPDATE preserves related data (tool_calls, tool_outputs)
- Test cascade behavior explicitly

## Success Criteria

**Performance**:
- [ ] 50%+ reduction in database queries for large conversations
- [ ] 99%+ reduction in writes for single message edits
- [ ] No performance regression for small conversations (<100 messages)

**Correctness**:
- [ ] All existing tests pass
- [ ] New diff tests achieve >95% coverage
- [ ] Zero data loss in production (monitored for 30 days)

**Code Quality**:
- [ ] No manual metadata preservation code in sync logic
- [ ] Clear separation between diff computation and application
- [ ] Contract validation prevents invalid states

## Timeline

| Phase | Duration | Dependencies |
|-------|----------|--------------|
| Phase 1: Analysis & Design | 1 day | None |
| Phase 2: Core Implementation | 2 days | Phase 1 |
| Phase 3: Testing | 1 day | Phase 2 |
| Phase 4: Documentation | 0.5 days | Phase 2 |
| Phase 5: Deprecation | 0.5 days | Phase 3 |
| **Total** | **5 days** | Sequential |

## References

**Code Locations**:
- Current implementation: `backend/src/lib/persistence/ConversationManager.js:82-155`
- Call site: `backend/src/lib/simplifiedPersistence.js:151`
- Database layer: `backend/src/db/messages.js:368-385`

**Related Documents**:
- `AGENTS.md` - Architecture overview
- `ADR/0001-use-openai-compatible.md` - API compatibility decisions

**Related Issues**:
- Performance overhead in large conversations
- Tool call preservation brittleness
- Future metadata requirements (reasoning traces)

## Areas Needing Clarification

  1. Alignment Threshold (Phase 1)
  - What defines "no reasonable alignment found"?
  - Suggest: Specify minimum overlap percentage (e.g., 80% suffix match) to trigger fallback

  2. Tool Metadata Handling (Phase 2, line 211-214)
  - replaceAssistantArtifacts still does clear+reinsert
  - This partially contradicts the goal of avoiding deletes
  - Consider: Could tool calls/outputs also be diffed instead of replaced?

## Next Steps

1. Review this plan with team for feedback
2. Create feature branch: `refactor/diff-based-message-sync`
3. Begin Phase 1 (Analysis & Design)
4. Update this document as implementation progresses
