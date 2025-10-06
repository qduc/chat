# Phase 1: Analysis & Design - Completed

## Call Site Inventory

### Direct Call Sites
1. **`backend/src/lib/simplifiedPersistence.js:151`**
   - Method: `_processMessageHistory`
   - Context: Called during request initialization
   - Parameters: `(conversationId, userId, messages)`
   - Messages source: Filtered non-system messages from request body

### Implementation Location
1. **`backend/src/lib/persistence/ConversationManager.js:82-129`**
   - Method: `syncMessageHistory`
   - Private helper: `_loadExistingAssistantToolData` (lines 131-155)

### Database Dependencies
1. **`backend/src/db/messages.js`**
   - `clearAllMessages` (lines 368-385): Validates ownership, then deletes all messages
   - `insertUserMessage`: Creates user message with seq
   - `insertAssistantFinal`: Creates assistant message with seq
   - `getMessagesPage`: Paginated message retrieval (200/page)
   - `getNextSeq`: Returns next sequence number

2. **`backend/src/db/toolCalls.js`**
   - `insertToolCalls`: Inserts tool calls for a message
   - `insertToolOutputs`: Inserts tool outputs for a message
   - Foreign keys: CASCADE DELETE on message deletion

### Current Implementation Analysis

**Pattern**: Clear-and-rewrite with manual metadata preservation

**Flow**:
1. Load all assistant tool data via pagination (200/page)
2. Clear ALL messages (`DELETE FROM messages WHERE conversation_id = ...`)
3. Rewrite messages sequentially from frontend array
4. Manually restore tool calls/outputs by index matching

**Database Schema**:
```sql
messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  content_json TEXT NULL,  -- For mixed content (images)
  seq INTEGER NOT NULL,
  finish_reason TEXT NULL,
  UNIQUE(conversation_id, seq),
  FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
)

tool_calls (
  id TEXT PRIMARY KEY,
  message_id INTEGER NOT NULL,
  conversation_id TEXT NOT NULL,
  call_index INTEGER NOT NULL DEFAULT 0,
  tool_name TEXT NOT NULL,
  arguments TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY(message_id) REFERENCES messages(id) ON DELETE CASCADE
)

tool_outputs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tool_call_id TEXT NOT NULL,
  message_id INTEGER NOT NULL,
  conversation_id TEXT NOT NULL,
  output TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'success',
  FOREIGN KEY(tool_call_id) REFERENCES tool_calls(id) ON DELETE CASCADE,
  FOREIGN KEY(message_id) REFERENCES messages(id) ON DELETE CASCADE
)
```

**Identified Issues**:
1. **Performance**: O(2n) reads - messages loaded twice (once for tool data, once for deletion)
2. **Tight Coupling**: Each new metadata type requires manual preservation code
3. **Data Loss Risk**: Frontend history is authoritative without validation
4. **Cascade Effects**: Deletion triggers cascading deletes for tool_calls/tool_outputs

## Diff-Based Algorithm Design

### Core Algorithm

```javascript
/**
 * Compute diff between existing and incoming message arrays
 * @param {Array} existing - Messages from database with full metadata
 * @param {Array} incoming - Messages from frontend request
 * @returns {Object} Diff result with insert/update/delete operations
 */
function computeMessageDiff(existing, incoming) {
  // Step 1: Alignment - Find longest matching suffix
  const alignment = findAlignment(existing, incoming);

  if (!alignment.valid) {
    return { fallback: true, reason: alignment.reason };
  }

  // Step 2: Classify changes
  const toInsert = [];
  const toUpdate = [];
  const toDelete = [];
  const unchanged = [];

  const { overlapStart, overlapLength } = alignment;

  // Messages before overlap are preserved (truncated history case)
  for (let i = 0; i < overlapStart; i++) {
    unchanged.push(existing[i]);
  }

  // Process overlapping window
  for (let i = 0; i < overlapLength; i++) {
    const existingMsg = existing[overlapStart + i];
    const incomingMsg = incoming[i];

    if (messagesEqual(existingMsg, incomingMsg)) {
      unchanged.push(existingMsg);
    } else {
      // Same position but different content - update
      toUpdate.push({
        id: existingMsg.id,
        seq: existingMsg.seq,
        ...incomingMsg
      });
    }
  }

  // Messages after overlap in incoming array - insert
  for (let i = overlapLength; i < incoming.length; i++) {
    toInsert.push(incoming[i]);
  }

  // Messages after overlap in existing array - delete
  const deleteAfterSeq = overlapStart + overlapLength - 1;
  if (deleteAfterSeq < existing.length - 1) {
    for (let i = overlapStart + overlapLength; i < existing.length; i++) {
      toDelete.push(existing[i]);
    }
  }

  return {
    toInsert,
    toUpdate,
    toDelete,
    unchanged,
    fallback: false,
    anchorOffset: overlapStart
  };
}
```

### Alignment Strategy

```javascript
/**
 * Find alignment between existing and incoming messages
 * Uses suffix matching to handle truncated histories
 * @param {Array} existing - Messages from database
 * @param {Array} incoming - Messages from frontend
 * @returns {Object} Alignment result
 */
function findAlignment(existing, incoming) {
  // Empty cases
  if (incoming.length === 0) {
    return { valid: true, overlapStart: existing.length, overlapLength: 0 };
  }

  if (existing.length === 0) {
    return { valid: true, overlapStart: 0, overlapLength: 0 };
  }

  // Try to find longest matching suffix
  // Start from the end and work backwards
  let maxMatchLength = 0;
  let bestStart = -1;

  // Try each possible starting position in existing array
  for (let start = 0; start < existing.length; start++) {
    const remainingExisting = existing.length - start;
    const maxPossibleMatch = Math.min(remainingExisting, incoming.length);

    let matchLength = 0;
    for (let i = 0; i < maxPossibleMatch; i++) {
      if (messagesMatchForAlignment(existing[start + i], incoming[i])) {
        matchLength++;
      } else {
        break; // Contiguous match required
      }
    }

    if (matchLength > maxMatchLength) {
      maxMatchLength = matchLength;
      bestStart = start;
    }
  }

  // Validation: Require minimum overlap percentage
  const MIN_OVERLAP_PERCENT = 0.8;
  const requiredOverlap = Math.ceil(Math.min(existing.length, incoming.length) * MIN_OVERLAP_PERCENT);

  if (maxMatchLength < requiredOverlap) {
    return {
      valid: false,
      reason: `Insufficient overlap: found ${maxMatchLength}, required ${requiredOverlap}`
    };
  }

  return {
    valid: true,
    overlapStart: bestStart,
    overlapLength: maxMatchLength
  };
}

/**
 * Check if two messages match for alignment purposes
 * Uses role + content matching (ignores metadata)
 * @param {Object} existing - Message from database
 * @param {Object} incoming - Message from frontend
 * @returns {boolean} True if messages match
 */
function messagesMatchForAlignment(existing, incoming) {
  if (existing.role !== incoming.role) {
    return false;
  }

  // Handle both string content and array content (images)
  const existingContent = normalizeContent(existing.content || existing.content_json);
  const incomingContent = normalizeContent(incoming.content);

  return existingContent === incomingContent;
}

/**
 * Normalize content for comparison
 * Handles both string and array (mixed) content
 * @param {string|Array} content - Message content
 * @returns {string} Normalized content
 */
function normalizeContent(content) {
  if (typeof content === 'string') {
    return content.trim();
  }

  if (Array.isArray(content)) {
    // For mixed content, serialize to JSON for comparison
    return JSON.stringify(content);
  }

  return '';
}
```

### Metadata Synchronization Helper

```javascript
/**
 * Diff assistant artifacts (tool calls/outputs) for granular updates
 * @param {Object} params - Diff parameters
 * @param {number} params.messageId - Message ID
 * @param {Array} params.existingToolCalls - Current tool calls from DB
 * @param {Array} params.existingToolOutputs - Current tool outputs from DB
 * @param {Array} params.nextToolCalls - Incoming tool calls
 * @param {Array} params.nextToolOutputs - Incoming tool outputs
 * @returns {Object} Diff result or fallback signal
 */
function diffAssistantArtifacts({
  messageId,
  existingToolCalls = [],
  existingToolOutputs = [],
  nextToolCalls = [],
  nextToolOutputs = []
}) {
  // Check if structure changed significantly
  if (existingToolCalls.length !== nextToolCalls.length) {
    return { fallback: true, reason: 'Tool call count changed' };
  }

  const toolCallsToUpdate = [];
  const toolCallsToInsert = [];
  const toolOutputsToUpdate = [];
  const toolOutputsToInsert = [];

  // Compare tool calls by index
  for (let i = 0; i < nextToolCalls.length; i++) {
    const existing = existingToolCalls.find(tc => tc.call_index === i);
    const incoming = nextToolCalls[i];

    if (!existing) {
      toolCallsToInsert.push({ ...incoming, call_index: i });
    } else if (!toolCallsEqual(existing, incoming)) {
      toolCallsToUpdate.push({ id: existing.id, ...incoming });
    }
  }

  // Compare tool outputs by tool_call_id
  for (const incomingOutput of nextToolOutputs) {
    const existing = existingToolOutputs.find(
      to => to.tool_call_id === incomingOutput.tool_call_id
    );

    if (!existing) {
      toolOutputsToInsert.push(incomingOutput);
    } else if (!toolOutputsEqual(existing, incomingOutput)) {
      toolOutputsToUpdate.push({ id: existing.id, ...incomingOutput });
    }
  }

  return {
    fallback: false,
    toolCallsToUpdate,
    toolCallsToInsert,
    toolOutputsToUpdate,
    toolOutputsToInsert
  };
}

function toolCallsEqual(tc1, tc2) {
  return tc1.tool_name === tc2.function?.name &&
         tc1.arguments === (tc2.function?.arguments || tc2.arguments);
}

function toolOutputsEqual(to1, to2) {
  return to1.output === to2.output &&
         to1.status === to2.status;
}
```

## Fallback Conditions

The algorithm will fall back to legacy clear-and-rewrite in these cases:

1. **Insufficient alignment**: Less than 80% overlap between existing and incoming
2. **Impossible reordering**: Role mismatch in overlapping window
3. **Mid-conversation gaps**: Missing messages in the middle (not tail deletion)
4. **Tool structure changes**: Tool call count changed (handled in artifact diff)

## Safety Guarantees

1. **Transactional**: All changes applied atomically or rolled back
2. **Validation**: Alignment validation before applying changes
3. **Fallback**: Safe degradation to current behavior when uncertain
4. **Logging**: Structured logging for alignment outcomes and fallbacks

## Performance Expectations

| Metric | Current | New (Diff) | Improvement |
|--------|---------|-----------|-------------|
| DB reads (1000 msg) | 10 pages × 2 = 20 queries | 10 pages × 1 = 10 queries | 50% reduction |
| DB writes (1 new msg) | 1000 DELETEs + 1001 INSERTs | 1 INSERT | 99.9% reduction |
| DB writes (1 edit) | 1000 DELETEs + 1000 INSERTs | 1 UPDATE | 99.95% reduction |
| Memory | All messages × 2 | All messages × 1 | 50% reduction |

## Next Steps

1. Implement core utility functions in `backend/src/lib/utils/messageDiff.js`
2. Implement new `syncMessageHistoryDiff` in `ConversationManager.js`
3. Add database helpers for targeted updates
4. Write comprehensive tests
5. Feature flag rollout
