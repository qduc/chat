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
  const info = db
    .prepare(
      `INSERT INTO messages (conversation_id, role, status, content, seq, created_at, updated_at)
     VALUES (@conversationId, 'user', 'final', @content, @seq, @now, @now)`
    )
    .run({ conversationId, content: content || '', seq, now });
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
}) {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE messages SET status=@status, finish_reason=@finishReason, updated_at=@now WHERE id=@messageId`
  ).run({ messageId, finishReason, status, now });
}

export function markAssistantError({ messageId }) {
  finalizeAssistantMessage({
    messageId,
    finishReason: 'error',
    status: 'error',
  });
}

export function insertAssistantFinal({ conversationId, content, seq, finishReason = 'stop' }) {
  const db = getDb();
  const now = new Date().toISOString();
  const info = db
    .prepare(
      `INSERT INTO messages (conversation_id, role, status, content, seq, finish_reason, created_at, updated_at)
     VALUES (@conversationId, 'assistant', 'final', @content, @seq, @finishReason, @now, @now)`
    )
    .run({ conversationId, content: content || '', seq, finishReason, now });
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
      `SELECT id, seq, role, status, content, created_at
     FROM messages WHERE conversation_id=@conversationId AND seq > @afterSeq
     ORDER BY seq ASC LIMIT @limit`
    )
    .all({ conversationId, afterSeq, limit: sanitizedLimit });
  const next_after_seq =
    messages.length === sanitizedLimit ? messages[messages.length - 1].seq : null;
  return { messages, next_after_seq };
}

export function getLastMessage({ conversationId }) {
  const db = getDb();
  const message = db
    .prepare(
      `SELECT id, seq, role, status, content, created_at
     FROM messages WHERE conversation_id=@conversationId
     ORDER BY seq DESC LIMIT 1`
    )
    .get({ conversationId });
  return message;
}

export function updateMessageContent({ messageId, conversationId, sessionId, userId = null, content }) {
  const db = getDb();
  const now = new Date().toISOString();

  let query = `SELECT m.id, m.conversation_id, m.role, m.seq
     FROM messages m
     JOIN conversations c ON m.conversation_id = c.id
     WHERE m.id = @messageId AND c.id = @conversationId AND c.deleted_at IS NULL`;

  const params = { messageId, conversationId, sessionId, userId };

  if (userId) {
    query += ` AND c.user_id = @userId`;
  } else if (sessionId) {
    query += ` AND c.session_id = @sessionId AND c.user_id IS NULL`;
  } else {
    return null;
  }

  const message = db.prepare(query).get(params);

  if (!message) return null;

  db.prepare(
    `UPDATE messages SET content = @content, updated_at = @now WHERE id = @messageId`
  ).run({ messageId, content, now });

  return message;
}

export function deleteMessagesAfterSeq({ conversationId, sessionId, userId = null, afterSeq }) {
  const db = getDb();

  let query = `SELECT id FROM conversations WHERE id = @conversationId AND deleted_at IS NULL`;
  const params = { conversationId, sessionId, userId };

  if (userId) {
    query += ` AND user_id = @userId`;
  } else if (sessionId) {
    query += ` AND session_id = @sessionId AND user_id IS NULL`;
  } else {
    return false;
  }

  const conversation = db.prepare(query).get(params);

  if (!conversation) return false;

  const result = db.prepare(
    `DELETE FROM messages WHERE conversation_id = @conversationId AND seq > @afterSeq`
  ).run({ conversationId, afterSeq });

  return result.changes > 0;
}

export function clearAllMessages({ conversationId, sessionId, userId = null }) {
  const db = getDb();

  let query, params;

  // Support both user-based and session-based access for backward compatibility
  if (userId) {
    query = `SELECT id FROM conversations WHERE id = @conversationId AND (user_id = @userId OR (user_id IS NULL AND session_id = @sessionId)) AND deleted_at IS NULL`;
    params = { conversationId, userId, sessionId };
  } else {
    query = `SELECT id FROM conversations WHERE id = @conversationId AND session_id = @sessionId AND user_id IS NULL AND deleted_at IS NULL`;
    params = { conversationId, sessionId };
  }

  const conversation = db.prepare(query).get(params);

  if (!conversation) return false;

  const result = db.prepare(
    `DELETE FROM messages WHERE conversation_id = @conversationId`
  ).run({ conversationId });

  return result.changes > 0;
}
