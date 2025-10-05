import { getDb } from './client.js';

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

export function insertUserMessage({ conversationId, content, seq }) {
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
      `INSERT INTO messages (conversation_id, role, status, content, content_json, seq, created_at, updated_at)
     VALUES (@conversationId, 'user', 'final', @content, @contentJson, @seq, @now, @now)`
    )
    .run({
      conversationId,
      content: textContent,
      contentJson: jsonContent,
      seq,
      now
    });
  return { id: info.lastInsertRowid, seq };
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

export function insertAssistantFinal({ conversationId, content, seq, finishReason = 'stop', responseId = null }) {
  const db = getDb();
  const now = new Date().toISOString();
  const info = db
    .prepare(
      `INSERT INTO messages (conversation_id, role, status, content, seq, finish_reason, response_id, created_at, updated_at)
     VALUES (@conversationId, 'assistant', 'final', @content, @seq, @finishReason, @responseId, @now, @now)`
    )
    .run({ conversationId, content: content || '', seq, finishReason, responseId, now });
  return { id: info.lastInsertRowid, seq };
}

export function insertToolMessage({ conversationId, content, seq, status = 'success' }) {
  const db = getDb();
  const now = new Date().toISOString();
  const info = db
    .prepare(
      `INSERT INTO messages (conversation_id, role, status, content, seq, created_at, updated_at)
     VALUES (@conversationId, 'tool', @status, @content, @seq, @now, @now)`
    )
    .run({
      conversationId,
      status,
      content: typeof content === 'string' ? content : JSON.stringify(content ?? ''),
      seq,
      now
    });

  return { id: info.lastInsertRowid, seq };
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

export function getMessagesPage({ conversationId, afterSeq = 0, limit = 50 }) {
  const db = getDb();
  const sanitizedLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const messages = db
    .prepare(
      `SELECT id, seq, role, status, content, content_json, created_at
     FROM messages WHERE conversation_id=@conversationId AND seq > @afterSeq
     ORDER BY seq ASC LIMIT @limit`
    )
    .all({ conversationId, afterSeq, limit: sanitizedLimit });

  // Parse content_json and use it if available, otherwise fall back to content
  for (const message of messages) {
    if (message.content_json) {
      try {
        message.content = JSON.parse(message.content_json);
      } catch (e) {
        // If JSON parsing fails, keep the text content
        console.warn('Failed to parse content_json for message', message.id, e);
      }
    }
    // Remove content_json from response (internal field)
    delete message.content_json;
  }

  // Fetch tool calls and outputs for all messages in batch
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

    // Attach tool calls and outputs to messages
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

  const next_after_seq =
    messages.length === sanitizedLimit ? messages[messages.length - 1].seq : null;
  return { messages, next_after_seq };
}

export function getLastMessage({ conversationId }) {
  const db = getDb();
  const message = db
    .prepare(
      `SELECT id, seq, role, status, content, content_json, created_at
     FROM messages WHERE conversation_id=@conversationId
     ORDER BY seq DESC LIMIT 1`
    )
    .get({ conversationId });

  if (!message) return null;

  // Parse content_json and use it if available, otherwise fall back to content
  if (message.content_json) {
    try {
      message.content = JSON.parse(message.content_json);
    } catch (e) {
      console.warn('Failed to parse content_json for message', message.id, e);
    }
  }
  // Remove content_json from response (internal field)
  delete message.content_json;

  // Fetch tool calls for this message
  const toolCalls = db
    .prepare(
      `SELECT id, message_id, conversation_id, call_index, tool_name, arguments, text_offset, created_at
       FROM tool_calls
       WHERE message_id = @messageId
       ORDER BY call_index ASC`
    )
    .all({ messageId: message.id });

  // Fetch tool outputs for this message
  const toolOutputs = db
    .prepare(
      `SELECT id, tool_call_id, message_id, conversation_id, output, status, executed_at
       FROM tool_outputs
       WHERE message_id = @messageId
       ORDER BY executed_at ASC`
    )
    .all({ messageId: message.id });

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

export function updateMessageContent({ messageId, conversationId, userId, content, status }) {
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

  const updateSql = status !== undefined
    ? `UPDATE messages SET content = @content, content_json = @contentJson, status = @status, updated_at = @now WHERE id = @messageId`
    : `UPDATE messages SET content = @content, content_json = @contentJson, updated_at = @now WHERE id = @messageId`;

  const params = {
    messageId,
    content: textContent,
    contentJson: jsonContent,
    now,
  };

  if (status !== undefined) {
    params.status = status;
  }

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
