/**
 * Message Diff Utility
 *
 * Provides diff-based synchronization between stored and incoming message arrays.
 * Uses suffix matching to handle truncated histories and provides fallback to
 * legacy clear-and-rewrite when alignment is unsafe.
 */

/**
 * Compute diff between existing and incoming message arrays
 * @param {Array} existing - Messages from database with full metadata
 * @param {Array} incoming - Messages from frontend request
 * @returns {Object} Diff result with insert/update/delete operations
 */
export function computeMessageDiff(existing, incoming) {
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

/**
 * Find alignment between existing and incoming messages
 * Uses suffix matching to handle truncated histories
 * Alignment is based on role matching, with content validation for safety
 * @param {Array} existing - Messages from database
 * @param {Array} incoming - Messages from frontend
 * @returns {Object} Alignment result
 */
export function findAlignment(existing, incoming) {
  // Empty cases
  if (incoming.length === 0) {
    return { valid: true, overlapStart: existing.length, overlapLength: 0 };
  }

  if (existing.length === 0) {
    return { valid: true, overlapStart: 0, overlapLength: 0 };
  }

  // Try to find longest matching suffix based on ROLES (not content)
  // This allows us to detect updates within the aligned window
  let maxMatchLength = 0;
  let bestStart = -1;
  let bestContentMatchCount = 0;

  // Try each possible starting position in existing array
  for (let start = 0; start < existing.length; start++) {
    const remainingExisting = existing.length - start;
    const maxPossibleMatch = Math.min(remainingExisting, incoming.length);

    let matchLength = 0;
    let contentMatchCount = 0;
    for (let i = 0; i < maxPossibleMatch; i++) {
      // Only match on role for alignment purposes
      if (existing[start + i].role === incoming[i].role) {
        matchLength++;
        // Also track content matches for validation
        if (messagesMatchForAlignment(existing[start + i], incoming[i])) {
          contentMatchCount++;
        }
      } else {
        break; // Contiguous match required
      }
    }

    if (matchLength > maxMatchLength) {
      maxMatchLength = matchLength;
      bestStart = start;
      bestContentMatchCount = contentMatchCount;
    }
  }

  // Validation 1: Require minimum overlap percentage based on role alignment
  const MIN_OVERLAP_PERCENT = 0.8;
  const requiredOverlap = Math.ceil(Math.min(existing.length, incoming.length) * MIN_OVERLAP_PERCENT);

  if (maxMatchLength < requiredOverlap) {
    return {
      valid: false,
      reason: `Insufficient overlap: found ${maxMatchLength}, required ${requiredOverlap}`
    };
  }

  // Validation 2: Require at least some content matches to prevent completely bogus alignments
  // If ALL content differs, this is likely a completely different conversation
  const MIN_CONTENT_MATCH_PERCENT = 0.3; // At least 30% of messages should have matching content
  const requiredContentMatches = Math.ceil(maxMatchLength * MIN_CONTENT_MATCH_PERCENT);

  if (bestContentMatchCount < requiredContentMatches) {
    return {
      valid: false,
      reason: `Insufficient content overlap: found ${bestContentMatchCount} content matches, required ${requiredContentMatches}`
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
export function messagesMatchForAlignment(existing, incoming) {
  if (existing.role !== incoming.role) {
    return false;
  }

  // Handle both string content and array content (images)
  const existingContent = normalizeContent(existing.content || existing.content_json);
  const incomingContent = normalizeContent(incoming.content);

  return existingContent === incomingContent;
}

/**
 * Check if two messages are completely equal (including metadata)
 * @param {Object} msg1 - First message
 * @param {Object} msg2 - Second message
 * @returns {boolean} True if messages are equal
 */
export function messagesEqual(msg1, msg2) {
  // Basic field comparison
  if (msg1.role !== msg2.role) {
    return false;
  }

  // Content comparison
  const content1 = normalizeContent(msg1.content || msg1.content_json);
  const content2 = normalizeContent(msg2.content);

  if (content1 !== content2) {
    return false;
  }

  // Tool calls comparison
  const toolCalls1 = msg1.tool_calls || [];
  const toolCalls2 = msg2.tool_calls || [];

  if (toolCalls1.length !== toolCalls2.length) {
    return false;
  }

  for (let i = 0; i < toolCalls1.length; i++) {
    if (!toolCallsEqual(toolCalls1[i], toolCalls2[i])) {
      return false;
    }
  }

  // Tool outputs comparison
  const toolOutputs1 = msg1.tool_outputs || [];
  const toolOutputs2 = msg2.tool_outputs || [];

  if (toolOutputs1.length !== toolOutputs2.length) {
    return false;
  }

  for (let i = 0; i < toolOutputs1.length; i++) {
    if (!toolOutputsEqual(toolOutputs1[i], toolOutputs2[i])) {
      return false;
    }
  }

  return true;
}

/**
 * Normalize content for comparison
 * Handles both string and array (mixed) content
 * @param {string|Array} content - Message content
 * @returns {string} Normalized content
 */
export function normalizeContent(content) {
  if (typeof content === 'string') {
    try {
      // If it's a JSON string, parse and re-stringify for consistent formatting
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) {
        return JSON.stringify(parsed);
      }
      return content.trim();
    } catch {
      return content.trim();
    }
  }

  if (Array.isArray(content)) {
    // For mixed content, serialize to JSON for comparison
    return JSON.stringify(content);
  }

  return '';
}

/**
 * Check if two tool calls are equal
 * @param {Object} tc1 - First tool call
 * @param {Object} tc2 - Second tool call
 * @returns {boolean} True if tool calls are equal
 */
export function toolCallsEqual(tc1, tc2) {
  const name1 = tc1.tool_name || tc1.function?.name;
  const name2 = tc2.tool_name || tc2.function?.name;

  if (name1 !== name2) {
    return false;
  }

  const args1 = tc1.arguments || tc1.function?.arguments || '{}';
  const args2 = tc2.arguments || tc2.function?.arguments || '{}';

  // Normalize JSON arguments for comparison
  try {
    const parsed1 = typeof args1 === 'string' ? JSON.parse(args1) : args1;
    const parsed2 = typeof args2 === 'string' ? JSON.parse(args2) : args2;
    return JSON.stringify(parsed1) === JSON.stringify(parsed2);
  } catch {
    // If parsing fails, do string comparison
    return args1 === args2;
  }
}

/**
 * Check if two tool outputs are equal
 * @param {Object} to1 - First tool output
 * @param {Object} to2 - Second tool output
 * @returns {boolean} True if tool outputs are equal
 */
export function toolOutputsEqual(to1, to2) {
  if (to1.tool_call_id !== to2.tool_call_id) {
    return false;
  }

  if (to1.status !== to2.status) {
    return false;
  }

  return to1.output === to2.output;
}

/**
 * Diff assistant artifacts (tool calls/outputs) for granular updates
 * @param {Object} params - Diff parameters
 * @param {Array} params.existingToolCalls - Current tool calls from DB
 * @param {Array} params.existingToolOutputs - Current tool outputs from DB
 * @param {Array} params.nextToolCalls - Incoming tool calls
 * @param {Array} params.nextToolOutputs - Incoming tool outputs
 * @returns {Object} Diff result or fallback signal
 */
export function diffAssistantArtifacts({
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
