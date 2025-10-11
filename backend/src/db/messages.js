import { getDb } from './client.js';
import { logger } from '../logger.js';

function extractTextFromMixedContent(content) {
  if (!Array.isArray(content)) return '';
  const segments = [];
  for (const part of content) {
    if (!part) continue;
    if (typeof part === 'string') {
      segments.push(part);
      continue;
    }
    if (typeof part === 'object') {
      if (typeof part.text === 'string') {
        segments.push(part.text);
        continue;
      }
      if (typeof part.value === 'string') {
        segments.push(part.value);
        continue;
      }
      if (typeof part.content === 'string') {
        segments.push(part.content);
      }
    }
  }
  return segments.join('');
}

function normalizeMessageContent(content) {
  if (Array.isArray(content)) {
    return {
      textContent: extractTextFromMixedContent(content),
      jsonContent: JSON.stringify(content),
    };
  }

  if (typeof content === 'string') {
    return { textContent: content, jsonContent: null };
  }

  if (content && typeof content === 'object') {
    try {
      return {
        textContent: '',
        jsonContent: JSON.stringify(content),
      };
    } catch {
      return { textContent: '', jsonContent: null };
    }
  }

  return { textContent: '', jsonContent: null };
}

function serializeReasoningDetails(details) {
  if (details === undefined) return { json: undefined };
  if (details === null) return { json: null };

  try {
    return { json: JSON.stringify(details) };
  } catch {
    return { json: null };
  }
}

function normalizeReasoningTokens(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const asNumber = Number(value);
  if (!Number.isFinite(asNumber)) return null;
  return Math.max(0, Math.trunc(asNumber));
}

function parseJsonField(raw, messageId, fieldName) {
  if (raw == null) return null;
  try {
    return JSON.parse(raw);
  } catch (error) {
    logger.warn(`Failed to parse ${fieldName} for message ${messageId}`, error);
    return null;
  }
}

export function getNextSeq(conversationId) {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT COALESCE(MAX(seq), 0) + 1 as nextSeq FROM messages WHERE conversation_id=@conversationId`
    )
    .get({ conversationId });
  return row?.nextSeq || 1;
}

export function countMessagesByConversation(conversationId) {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT COUNT(1) as c FROM messages WHERE conversation_id=@conversationId`
    )
    .get({ conversationId });
  return row?.c || 0;
}

export function insertUserMessage({ conversationId, content, seq, clientMessageId = null }) {
  const db = getDb();
  const now = new Date().toISOString();

  // Handle mixed content (array) or plain text (string)
  let textContent = '';
  let jsonContent = null;

  if (Array.isArray(content)) {
    // Mixed content format: extract text and store full JSON
    jsonContent = JSON.stringify(content);
    // Extract text parts for the content column (backward compatibility)
    textContent = content
      .filter(part => part.type === 'text')
      .map(part => part.text)
      .join('\n');
  } else {
    // Plain text format
    textContent = content || '';
  }

  const info = db
    .prepare(
      `INSERT INTO messages (conversation_id, role, status, content, content_json, seq, client_message_id, created_at, updated_at)
     VALUES (@conversationId, 'user', 'final', @content, @contentJson, @seq, @clientMessageId, @now, @now)`
    )
    .run({
      conversationId,
      content: textContent,
      contentJson: jsonContent,
      seq,
      clientMessageId,
      now
    });
  return { id: info.lastInsertRowid, seq, clientMessageId };
}

export function createAssistantDraft({ conversationId, seq }) {
  const db = getDb();
  const now = new Date().toISOString();
  const info = db
    .prepare(
      `INSERT INTO messages (conversation_id, role, status, content, seq, created_at, updated_at)
     VALUES (@conversationId, 'assistant', 'streaming', '', @seq, @now, @now)`
    )
    .run({ conversationId, seq, now });
  return { id: info.lastInsertRowid, seq };
}

export function appendAssistantContent({ messageId, delta }) {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE messages SET content = COALESCE(content,'') || @delta, updated_at=@now WHERE id=@messageId`
  ).run({ messageId, delta: delta || '', now });
}

export function finalizeAssistantMessage({
  messageId,
  finishReason = null,
  status = 'final',
  responseId = null,
}) {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE messages SET status=@status, finish_reason=@finishReason, response_id=@responseId, updated_at=@now WHERE id=@messageId`
  ).run({ messageId, finishReason, status, responseId, now });
}

export function markAssistantError({ messageId }) {
  finalizeAssistantMessage({
    messageId,
    finishReason: 'error',
    status: 'error',
  });
}

export function insertAssistantFinal({
  conversationId,
  content,
  seq,
  finishReason = 'stop',
  responseId = null,
  reasoningDetails = undefined,
  reasoningTokens = undefined,
  clientMessageId = null,
}) {
  const db = getDb();
  const now = new Date().toISOString();

  const { textContent, jsonContent } = normalizeMessageContent(content);
  const { json: reasoningJson } = serializeReasoningDetails(reasoningDetails);
  const normalizedTokens = normalizeReasoningTokens(reasoningTokens);

  const info = db
    .prepare(
      `INSERT INTO messages (conversation_id, role, status, content, content_json, seq, finish_reason, response_id, reasoning_details, reasoning_tokens, client_message_id, created_at, updated_at)
     VALUES (@conversationId, 'assistant', 'final', @content, @contentJson, @seq, @finishReason, @responseId, @reasoningDetails, @reasoningTokens, @clientMessageId, @now, @now)`
    )
    .run({
      conversationId,
      content: textContent || '',
      contentJson: jsonContent,
      seq,
      finishReason,
      responseId,
      reasoningDetails: reasoningJson === undefined ? null : reasoningJson,
      reasoningTokens: normalizedTokens ?? null,
      clientMessageId,
      now,
    });
  return { id: info.lastInsertRowid, seq, clientMessageId };
}

export function insertToolMessage({ conversationId, content, seq, status = 'success', clientMessageId = null }) {
  const db = getDb();
  const now = new Date().toISOString();
  const info = db
    .prepare(
      `INSERT INTO messages (conversation_id, role, status, content, seq, client_message_id, created_at, updated_at)
     VALUES (@conversationId, 'tool', @status, @content, @seq, @clientMessageId, @now, @now)`
    )
    .run({
      conversationId,
      status,
      content: typeof content === 'string' ? content : JSON.stringify(content ?? ''),
      seq,
      clientMessageId,
      now
    });

  return { id: info.lastInsertRowid, seq, clientMessageId };
}

export function markAssistantErrorBySeq({ conversationId, seq }) {
  const db = getDb();
  const now = new Date().toISOString();
  const info = db
    .prepare(
      `INSERT INTO messages (conversation_id, role, status, content, seq, finish_reason, created_at, updated_at)
     VALUES (@conversationId, 'assistant', 'error', '', @seq, 'error', @now, @now)`
    )
    .run({ conversationId, seq, now });
  return { id: info.lastInsertRowid, seq };
}

/**
 * Fetches a paginated list of messages from a conversation, with optional metadata
 * such as tool calls and outputs attached to each message.
 *
 * @param {Object} options - The options for fetching the messages page.
 * @param {string} options.conversationId - The unique identifier of the conversation.
 * @param {number} [options.afterSeq=0] - The sequence number after which messages will be fetched.
 * @param {number} [options.limit=50] - The maximum number of messages to fetch. The value is clamped between 1 and 200.
 * @return {Object} An object containing the fetched messages and pagination metadata.
 * @return {Array<Object>} return.messages - The list of messages retrieved, each containing various attributes and related metadata.
 * @return {number|null} return.next_after_seq - The sequence number for fetching further messages, or null if no further messages are available.
 */
export function getMessagesPage({ conversationId, afterSeq = 0, limit = 50 }) {
  const db = getDb();
  const sanitizedLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const messages = db
    .prepare(
      `SELECT id, seq, role, status, content, content_json, reasoning_details, reasoning_tokens, client_message_id, response_id, created_at
     FROM messages WHERE conversation_id=@conversationId AND seq > @afterSeq
     ORDER BY seq ASC LIMIT @limit`
    )
    .all({ conversationId, afterSeq, limit: sanitizedLimit });

  // Build mapping of integer id to client_message_id before transformation
  const integerIdToClientId = new Map();
  for (const message of messages) {
    if (message.client_message_id) {
      integerIdToClientId.set(message.id, message.client_message_id);
    }
  }

  // Parse content_json and use it if available, otherwise fall back to content
  for (const message of messages) {
    if (message.content_json) {
      const parsedContent = parseJsonField(message.content_json, message.id, 'content_json');
      if (parsedContent !== null) {
        message.content = parsedContent;
      }
    }
    delete message.content_json;

    if (message.reasoning_details) {
      const parsedReasoning = parseJsonField(message.reasoning_details, message.id, 'reasoning_details');
      message.reasoning_details = parsedReasoning ?? null;
    } else {
      message.reasoning_details = null;
    }

    if (message.reasoning_tokens != null) {
      message.reasoning_tokens = Number(message.reasoning_tokens);
    }
  }

  // Fetch tool calls and outputs for all messages in batch (using integer IDs)
  if (messages.length > 0) {
    const messageIds = messages.map(m => m.id);
    const placeholders = messageIds.map(() => '?').join(',');

    // Get all tool calls for these messages
    const toolCalls = db
      .prepare(
        `SELECT id, message_id, conversation_id, call_index, tool_name, arguments, text_offset, created_at
         FROM tool_calls
         WHERE message_id IN (${placeholders})
         ORDER BY message_id ASC, call_index ASC`
      )
      .all(...messageIds);

    // Get all tool outputs for these messages
    const toolOutputs = db
      .prepare(
        `SELECT id, tool_call_id, message_id, conversation_id, output, status, executed_at
         FROM tool_outputs
         WHERE message_id IN (${placeholders})
         ORDER BY message_id ASC, executed_at ASC`
      )
      .all(...messageIds);

    // Group tool calls by message_id
    const toolCallsByMessage = {};
    for (const tc of toolCalls) {
      if (!toolCallsByMessage[tc.message_id]) {
        toolCallsByMessage[tc.message_id] = [];
      }
      // Transform to OpenAI format
      toolCallsByMessage[tc.message_id].push({
        id: tc.id,
        type: 'function',
        index: tc.call_index,
        function: {
          name: tc.tool_name,
          arguments: tc.arguments
        },
        textOffset: tc.text_offset
      });
    }

    // Group tool outputs by message_id
    const toolOutputsByMessage = {};
    for (const to of toolOutputs) {
      if (!toolOutputsByMessage[to.message_id]) {
        toolOutputsByMessage[to.message_id] = [];
      }
      // Transform to expected format
      toolOutputsByMessage[to.message_id].push({
        tool_call_id: to.tool_call_id,
        output: to.output,
        status: to.status
      });
    }

    // Attach tool calls and outputs to messages (still using integer IDs)
    for (const message of messages) {
      if (toolCallsByMessage[message.id]) {
        message.tool_calls = toolCallsByMessage[message.id];
      }
      if (toolOutputsByMessage[message.id]) {
        if (message.role === 'tool') {
          const [firstOutput] = toolOutputsByMessage[message.id];
          if (firstOutput) {
            message.tool_call_id = firstOutput.tool_call_id;
            message.status = firstOutput.status || message.status;
            message.tool_outputs = [{
              tool_call_id: firstOutput.tool_call_id,
              output: firstOutput.output,
              status: firstOutput.status
            }];
          }
        } else {
          message.tool_outputs = toolOutputsByMessage[message.id];
        }
      }
    }
  }

  // Finally, transform integer IDs to client_message_ids for API response
  for (const message of messages) {
    if (message.client_message_id) {
      message.id = message.client_message_id;
    }
    delete message.client_message_id;
  }

  const next_after_seq =
    messages.length === sanitizedLimit ? messages[messages.length - 1].seq : null;
  return { messages, next_after_seq };
}

export function getLastMessage({ conversationId }) {
  const db = getDb();
  const message = db
    .prepare(
      `SELECT id, seq, role, status, content, content_json, reasoning_details, reasoning_tokens, client_message_id, created_at
     FROM messages WHERE conversation_id=@conversationId
     ORDER BY seq DESC LIMIT 1`
    )
    .get({ conversationId });

  if (!message) return null;

  // Store integer ID for database lookups
  const integerMessageId = message.id;

  // Parse content_json and use it if available, otherwise fall back to content
  if (message.content_json) {
    const parsedContent = parseJsonField(message.content_json, message.id, 'content_json');
    if (parsedContent !== null) {
      message.content = parsedContent;
    }
  }
  // Remove content_json from response (internal field)
  delete message.content_json;

  if (message.reasoning_details) {
    const parsedReasoning = parseJsonField(message.reasoning_details, message.id, 'reasoning_details');
    message.reasoning_details = parsedReasoning ?? null;
  } else {
    message.reasoning_details = null;
  }

  if (message.reasoning_tokens != null) {
    message.reasoning_tokens = Number(message.reasoning_tokens);
  }

  // Fetch tool calls for this message (using integer ID)
  const toolCalls = db
    .prepare(
      `SELECT id, message_id, conversation_id, call_index, tool_name, arguments, text_offset, created_at
       FROM tool_calls
       WHERE message_id = @messageId
       ORDER BY call_index ASC`
    )
    .all({ messageId: integerMessageId });

  // Fetch tool outputs for this message (using integer ID)
  const toolOutputs = db
    .prepare(
      `SELECT id, tool_call_id, message_id, conversation_id, output, status, executed_at
       FROM tool_outputs
       WHERE message_id = @messageId
       ORDER BY executed_at ASC`
    )
    .all({ messageId: integerMessageId });

  // Transform tool calls to OpenAI format
  if (toolCalls.length > 0) {
    message.tool_calls = toolCalls.map(tc => ({
      id: tc.id,
      type: 'function',
      index: tc.call_index,
      function: {
        name: tc.tool_name,
        arguments: tc.arguments
      },
      textOffset: tc.text_offset
    }));
  }

  // Transform tool outputs to expected format
  if (toolOutputs.length > 0) {
    message.tool_outputs = toolOutputs.map(to => ({
      tool_call_id: to.tool_call_id,
      output: to.output,
      status: to.status
    }));
  }

  // Finally, transform integer ID to client_message_id for API response
  if (message.client_message_id) {
    message.id = message.client_message_id;
  }
  delete message.client_message_id;

  return message;
}

export function getLastAssistantResponseId({ conversationId }) {
  const db = getDb();
  const message = db
    .prepare(
      `SELECT response_id
     FROM messages
     WHERE conversation_id=@conversationId
       AND role='assistant'
       AND response_id IS NOT NULL
     ORDER BY seq DESC
     LIMIT 1`
    )
    .get({ conversationId });
  const responseId = message?.response_id || null;
  return responseId;
}

export function getMessageByClientId({ conversationId, clientMessageId, userId }) {
  if (!userId) {
    throw new Error('userId is required');
  }

  const db = getDb();
  const query = `SELECT m.id, m.conversation_id, m.role, m.seq, m.client_message_id
     FROM messages m
     JOIN conversations c ON m.conversation_id = c.id
     WHERE m.client_message_id = @clientMessageId
       AND c.id = @conversationId
       AND c.deleted_at IS NULL
       AND c.user_id = @userId`;

  return db.prepare(query).get({ clientMessageId, conversationId, userId });
}

export function updateMessageContent({
  messageId,
  conversationId,
  userId,
  content,
  status,
  reasoningDetails,
  reasoningTokens,
}) {
  if (!userId) {
    throw new Error('userId is required');
  }

  const db = getDb();
  const now = new Date().toISOString();

  const query = `SELECT m.id, m.conversation_id, m.role, m.seq
     FROM messages m
     JOIN conversations c ON m.conversation_id = c.id
     WHERE m.id = @messageId AND c.id = @conversationId AND c.deleted_at IS NULL AND c.user_id = @userId`;

  const message = db.prepare(query).get({ messageId, conversationId, userId });

  if (!message) return null;

  const { textContent, jsonContent } = normalizeMessageContent(content);
  const { json: reasoningJson } = serializeReasoningDetails(reasoningDetails);
  const normalizedTokens = normalizeReasoningTokens(reasoningTokens);

  const updates = ['content = @content', 'content_json = @contentJson', 'updated_at = @now'];
  const params = {
    messageId,
    content: textContent,
    contentJson: jsonContent,
    now,
  };

  if (status !== undefined) {
    updates.push('status = @status');
    params.status = status;
  }

  if (reasoningJson !== undefined) {
    updates.push('reasoning_details = @reasoningDetails');
    params.reasoningDetails = reasoningJson;
  }

  if (normalizedTokens !== undefined) {
    updates.push('reasoning_tokens = @reasoningTokens');
    params.reasoningTokens = normalizedTokens;
  }

  const updateSql = `UPDATE messages SET ${updates.join(', ')} WHERE id = @messageId`;

  db.prepare(updateSql).run(params);

  return message;
}

export function deleteMessagesAfterSeq({ conversationId, userId, afterSeq }) {
  if (!userId) {
    throw new Error('userId is required');
  }

  const db = getDb();

  const query = `SELECT id FROM conversations WHERE id = @conversationId AND deleted_at IS NULL AND user_id = @userId`;
  const conversation = db.prepare(query).get({ conversationId, userId });

  if (!conversation) return false;

  const result = db.prepare(
    `DELETE FROM messages WHERE conversation_id = @conversationId AND seq > @afterSeq`
  ).run({ conversationId, afterSeq });

  return result.changes > 0;
}

export function clearAllMessages({ conversationId, userId }) {
  if (!userId) {
    throw new Error('userId is required');
  }

  const db = getDb();

  const query = `SELECT id FROM conversations WHERE id = @conversationId AND user_id = @userId AND deleted_at IS NULL`;
  const conversation = db.prepare(query).get({ conversationId, userId });

  if (!conversation) return false;

  const result = db.prepare(
    `DELETE FROM messages WHERE conversation_id = @conversationId`
  ).run({ conversationId });

  return result.changes > 0;
}

export function getAllMessagesForSync({ conversationId }) {
  const allMessages = [];
  let afterSeq = 0;

  while (true) {
    const page = getMessagesPage({ conversationId, afterSeq, limit: 200 });
    const pageMessages = page?.messages || [];

    allMessages.push(...pageMessages);

    if (!page?.next_after_seq) break;
    afterSeq = page.next_after_seq;
  }

  return allMessages;
}
