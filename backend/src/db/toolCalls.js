import { getDb } from './client.js';

/**
 * Insert a tool call record
 * @param {Object} params - Tool call parameters
 * @param {string} params.id - Tool call ID (e.g., 'call_abc123')
 * @param {number} params.messageId - Message ID this tool call belongs to
 * @param {string} params.conversationId - Conversation ID
 * @param {number} params.callIndex - Order index of this tool call
 * @param {string} params.toolName - Name of the tool
 * @param {string|Object} params.arguments - Tool arguments (will be stringified if object)
 * @param {number|null} params.textOffset - Character offset in message content
 * @returns {Object} Inserted tool call record
 */
export function insertToolCall({ id, messageId, conversationId, callIndex = 0, toolName, arguments: args, textOffset = null }) {
  const db = getDb();
  const now = new Date().toISOString();
  const argsStr = typeof args === 'string' ? args : JSON.stringify(args);

  db.prepare(
    `INSERT INTO tool_calls (id, message_id, conversation_id, call_index, tool_name, arguments, text_offset, created_at)
     VALUES (@id, @messageId, @conversationId, @callIndex, @toolName, @arguments, @textOffset, @now)`
  ).run({
    id,
    messageId,
    conversationId,
    callIndex,
    toolName,
    arguments: argsStr,
    textOffset,
    now
  });

  return { id, messageId, conversationId, callIndex, toolName, arguments: argsStr, textOffset };
}

/**
 * Insert multiple tool calls for a message
 * @param {number} messageId - Message ID
 * @param {string} conversationId - Conversation ID
 * @param {Array} toolCalls - Array of tool call objects from OpenAI format
 * @returns {Array} Inserted tool call records
 */
export function insertToolCalls({ messageId, conversationId, toolCalls }) {
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
    return [];
  }

  const results = [];
  for (const toolCall of toolCalls) {
    const callIndex = typeof toolCall.index === 'number' ? toolCall.index : results.length;
    const textOffset = typeof toolCall.textOffset === 'number' ? toolCall.textOffset : null;

    const result = insertToolCall({
      id: toolCall.id,
      messageId,
      conversationId,
      callIndex,
      toolName: toolCall.function?.name || toolCall.name,
      arguments: toolCall.function?.arguments || toolCall.arguments || '{}',
      textOffset
    });

    results.push(result);
  }

  return results;
}

/**
 * Get tool calls for a specific message
 * @param {number} messageId - Message ID
 * @returns {Array} Tool calls for the message
 */
export function getToolCallsByMessageId(messageId) {
  const db = getDb();
  const toolCalls = db
    .prepare(
      `SELECT id, message_id, conversation_id, call_index, tool_name, arguments, text_offset, created_at
       FROM tool_calls
       WHERE message_id = @messageId
       ORDER BY call_index ASC`
    )
    .all({ messageId });

  return toolCalls;
}

/**
 * Get tool calls for multiple messages (batch query)
 * @param {Array<number>} messageIds - Array of message IDs
 * @returns {Object} Map of messageId -> array of tool calls
 */
export function getToolCallsByMessageIds(messageIds) {
  if (!Array.isArray(messageIds) || messageIds.length === 0) {
    return {};
  }

  const db = getDb();
  const placeholders = messageIds.map(() => '?').join(',');
  const toolCalls = db
    .prepare(
      `SELECT id, message_id, conversation_id, call_index, tool_name, arguments, text_offset, created_at
       FROM tool_calls
       WHERE message_id IN (${placeholders})
       ORDER BY message_id ASC, call_index ASC`
    )
    .all(...messageIds);

  // Group by message_id
  const grouped = {};
  for (const toolCall of toolCalls) {
    if (!grouped[toolCall.message_id]) {
      grouped[toolCall.message_id] = [];
    }
    grouped[toolCall.message_id].push(toolCall);
  }

  return grouped;
}

/**
 * Get tool calls for a conversation
 * @param {string} conversationId - Conversation ID
 * @param {number} limit - Maximum number of tool calls to return
 * @returns {Array} Tool calls for the conversation
 */
export function getToolCallsByConversationId(conversationId, limit = 100) {
  const db = getDb();
  const toolCalls = db
    .prepare(
      `SELECT id, message_id, conversation_id, call_index, tool_name, arguments, text_offset, created_at
       FROM tool_calls
       WHERE conversation_id = @conversationId
       ORDER BY created_at DESC, call_index ASC
       LIMIT @limit`
    )
    .all({ conversationId, limit });

  return toolCalls;
}

/**
 * Insert a tool output record
 * @param {Object} params - Tool output parameters
 * @param {string} params.toolCallId - Tool call ID this output belongs to
 * @param {number} params.messageId - Message ID
 * @param {string} params.conversationId - Conversation ID
 * @param {string|Object} params.output - Tool execution result
 * @param {string} params.status - Status: 'success', 'error', 'timeout'
 * @returns {Object} Inserted tool output record
 */
export function insertToolOutput({ toolCallId, messageId, conversationId, output, status = 'success' }) {
  const db = getDb();
  const now = new Date().toISOString();
  const outputStr = typeof output === 'string' ? output : JSON.stringify(output);

  const info = db.prepare(
    `INSERT INTO tool_outputs (tool_call_id, message_id, conversation_id, output, status, executed_at)
     VALUES (@toolCallId, @messageId, @conversationId, @output, @status, @now)`
  ).run({
    toolCallId,
    messageId,
    conversationId,
    output: outputStr,
    status,
    now
  });

  return { id: info.lastInsertRowid, toolCallId, messageId, conversationId, output: outputStr, status };
}

/**
 * Insert multiple tool outputs
 * @param {number} messageId - Message ID
 * @param {string} conversationId - Conversation ID
 * @param {Array} toolOutputs - Array of tool output objects
 * @returns {Array} Inserted tool output records
 */
export function insertToolOutputs({ messageId, conversationId, toolOutputs }) {
  if (!Array.isArray(toolOutputs) || toolOutputs.length === 0) {
    return [];
  }

  const results = [];
  for (const toolOutput of toolOutputs) {
    const result = insertToolOutput({
      toolCallId: toolOutput.tool_call_id,
      messageId,
      conversationId,
      output: toolOutput.output,
      status: toolOutput.status || 'success'
    });

    results.push(result);
  }

  return results;
}

/**
 * Get tool outputs for a specific tool call
 * @param {string} toolCallId - Tool call ID
 * @returns {Array} Tool outputs for the tool call
 */
export function getToolOutputsByToolCallId(toolCallId) {
  const db = getDb();
  const outputs = db
    .prepare(
      `SELECT id, tool_call_id, message_id, conversation_id, output, status, executed_at
       FROM tool_outputs
       WHERE tool_call_id = @toolCallId
       ORDER BY executed_at ASC`
    )
    .all({ toolCallId });

  return outputs;
}

/**
 * Get tool outputs for multiple tool calls (batch query)
 * @param {Array<string>} toolCallIds - Array of tool call IDs
 * @returns {Object} Map of toolCallId -> array of outputs
 */
export function getToolOutputsByToolCallIds(toolCallIds) {
  if (!Array.isArray(toolCallIds) || toolCallIds.length === 0) {
    return {};
  }

  const db = getDb();
  const placeholders = toolCallIds.map(() => '?').join(',');
  const outputs = db
    .prepare(
      `SELECT id, tool_call_id, message_id, conversation_id, output, status, executed_at
       FROM tool_outputs
       WHERE tool_call_id IN (${placeholders})
       ORDER BY tool_call_id ASC, executed_at ASC`
    )
    .all(...toolCallIds);

  // Group by tool_call_id
  const grouped = {};
  for (const output of outputs) {
    if (!grouped[output.tool_call_id]) {
      grouped[output.tool_call_id] = [];
    }
    grouped[output.tool_call_id].push(output);
  }

  return grouped;
}

/**
 * Get tool outputs for a specific message
 * @param {number} messageId - Message ID
 * @returns {Array} Tool outputs for the message
 */
export function getToolOutputsByMessageId(messageId) {
  const db = getDb();
  const outputs = db
    .prepare(
      `SELECT id, tool_call_id, message_id, conversation_id, output, status, executed_at
       FROM tool_outputs
       WHERE message_id = @messageId
       ORDER BY executed_at ASC`
    )
    .all({ messageId });

  return outputs;
}

/**
 * Get tool outputs for multiple messages (batch query)
 * @param {Array<number>} messageIds - Array of message IDs
 * @returns {Object} Map of messageId -> array of outputs
 */
export function getToolOutputsByMessageIds(messageIds) {
  if (!Array.isArray(messageIds) || messageIds.length === 0) {
    return {};
  }

  const db = getDb();
  const placeholders = messageIds.map(() => '?').join(',');
  const outputs = db
    .prepare(
      `SELECT id, tool_call_id, message_id, conversation_id, output, status, executed_at
       FROM tool_outputs
       WHERE message_id IN (${placeholders})
       ORDER BY message_id ASC, executed_at ASC`
    )
    .all(...messageIds);

  // Group by message_id
  const grouped = {};
  for (const output of outputs) {
    if (!grouped[output.message_id]) {
      grouped[output.message_id] = [];
    }
    grouped[output.message_id].push(output);
  }

  return grouped;
}

/**
 * Delete tool calls and outputs for a specific message
 * This is automatically handled by CASCADE, but provided for explicit control
 * @param {number} messageId - Message ID
 * @returns {Object} Deletion results
 */
export function deleteToolCallsAndOutputsByMessageId(messageId) {
  const db = getDb();

  const outputsDeleted = db.prepare(
    `DELETE FROM tool_outputs WHERE message_id = @messageId`
  ).run({ messageId });

  const callsDeleted = db.prepare(
    `DELETE FROM tool_calls WHERE message_id = @messageId`
  ).run({ messageId });

  return {
    toolCallsDeleted: callsDeleted.changes,
    toolOutputsDeleted: outputsDeleted.changes
  };
}

/**
 * Update a tool call record
 * @param {Object} params - Tool call parameters
 * @param {string} params.id - Tool call ID to update
 * @param {string} params.conversationId - Conversation ID (required for composite key lookup)
 * @param {string} params.toolName - Name of the tool
 * @param {string|Object} params.arguments - Tool arguments
 * @returns {boolean} True if updated
 */
export function updateToolCall({ id, conversationId, toolName, arguments: args }) {
  const db = getDb();
  const argsStr = typeof args === 'string' ? args : JSON.stringify(args);

  const result = db.prepare(
    `UPDATE tool_calls SET tool_name = @toolName, arguments = @arguments WHERE id = @id AND conversation_id = @conversationId`
  ).run({ id, conversationId, toolName, arguments: argsStr });

  return result.changes > 0;
}

/**
 * Update a tool output record
 * @param {Object} params - Tool output parameters
 * @param {number} params.id - Tool output ID to update
 * @param {string|Object} params.output - Tool execution result
 * @param {string} params.status - Status
 * @returns {boolean} True if updated
 */
export function updateToolOutput({ id, output, status }) {
  const db = getDb();
  const outputStr = typeof output === 'string' ? output : JSON.stringify(output);

  const result = db.prepare(
    `UPDATE tool_outputs SET output = @output, status = @status WHERE id = @id`
  ).run({ id, output: outputStr, status });

  return result.changes > 0;
}

/**
 * Replace assistant artifacts (tool calls/outputs) for a message
 * Fallback strategy: clear + reinsert when structure changes too much to diff safely
 * @param {Object} params - Parameters
 * @param {number} params.messageId - Message ID
 * @param {string} params.conversationId - Conversation ID
 * @param {Array} params.toolCalls - Tool calls to insert
 * @param {Array} params.toolOutputs - Tool outputs to insert
 */
export function replaceAssistantArtifacts({ messageId, conversationId, toolCalls = [], toolOutputs = [] }) {
  // Delete existing artifacts
  deleteToolCallsAndOutputsByMessageId(messageId);

  // Insert new artifacts
  if (toolCalls.length > 0) {
    insertToolCalls({ messageId, conversationId, toolCalls });
  }

  if (toolOutputs.length > 0) {
    insertToolOutputs({ messageId, conversationId, toolOutputs });
  }
}
