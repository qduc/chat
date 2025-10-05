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
  const toInsert = [];
  const toUpdate = [];
  const toDelete = [];
  const unchanged = [];

  const minLength = Math.min(existing.length, incoming.length);

  for (let i = 0; i < minLength; i++) {
    const existingMsg = existing[i];
    const incomingMsg = incoming[i];

    if (messagesEqual(existingMsg, incomingMsg)) {
      unchanged.push(existingMsg);
      continue;
    }

    if (existingMsg.role !== incomingMsg.role) {
      toDelete.push(existingMsg);
      toInsert.push(incomingMsg);
      continue;
    }

    toUpdate.push({
      id: existingMsg.id,
      seq: existingMsg.seq,
      ...incomingMsg
    });
  }

  for (let i = minLength; i < incoming.length; i++) {
    toInsert.push(incoming[i]);
  }

  for (let i = minLength; i < existing.length; i++) {
    toDelete.push(existing[i]);
  }

  return {
    toInsert,
    toUpdate,
    toDelete,
    unchanged,
    fallback: false,
    anchorOffset: 0
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
// messagesMatchForAlignment and findAlignment were removed as the diff now
// performs straightforward positional comparisons.

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
  const toolCalls2Raw = msg2.tool_calls;
  const toolCalls2 = toolCalls2Raw === undefined ? toolCalls1 : (toolCalls2Raw || []);

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
  const toolOutputs2Raw = msg2.tool_outputs;
  const toolOutputs2 = toolOutputs2Raw === undefined ? toolOutputs1 : (toolOutputs2Raw || []);

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
