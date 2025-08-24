import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { config } from '../env.js';

let db = null;

function ensureDir(p) {
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function applyMigrationsSQLite(db) {
  // Keep SQL conservative and SQLite-friendly
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_seen_at DATETIME NULL,
      user_agent TEXT NULL,
      ip_hash TEXT NULL
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      user_id TEXT NULL,
      title TEXT NULL,
      model TEXT NULL,
      metadata TEXT DEFAULT '{}' ,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      deleted_at DATETIME NULL,
      FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_conversations_session_created ON conversations(session_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'final',
      content TEXT NOT NULL DEFAULT '',
      content_json TEXT NULL,
      seq INTEGER NOT NULL,
      parent_message_id INTEGER NULL,
      tokens_in INTEGER NULL,
      tokens_out INTEGER NULL,
      finish_reason TEXT NULL,
      tool_calls TEXT NULL,
      function_call TEXT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(conversation_id, seq),
      FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY(parent_message_id) REFERENCES messages(id)
    );
    CREATE INDEX IF NOT EXISTS idx_messages_conv_id ON messages(conversation_id, id);
  `);
}

export function getDb() {
  if (!config.persistence.enabled) return null;
  if (!db) {
    const url = config.persistence.dbUrl;
    if (!url) {
      throw new Error('[db] PERSIST_TRANSCRIPTS=true but DB_URL is empty');
    }
    if (!url.startsWith('file:')) {
      // Keep sprint note but allow SQLite only for now.
      throw new Error('[db] Only SQLite (file:...) is supported currently.');
    }
    const filePath = url.replace(/^file:/, '');
    ensureDir(filePath);
    db = new Database(filePath);
    applyMigrationsSQLite(db);
  }
  return db;
}

// Test helper to reset database cache
// IMPORTANT: Call this function in tests after changing config.persistence.enabled
// to avoid the common issue where getDb() returns cached null values
// Example usage in tests:
//   config.persistence.enabled = true;
//   resetDbCache(); // Reset cache after config change
//   const db = getDb(); // Now properly returns database instance
export function resetDbCache() {
  if (db) {
    db.close();
  }
  db = null;
}

export function upsertSession(sessionId, meta = {}) {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO sessions (id, user_id, created_at, last_seen_at, user_agent, ip_hash)
     VALUES (@id, NULL, @now, @now, @ua, @ip)
     ON CONFLICT(id) DO UPDATE SET last_seen_at=@now`
  ).run({
    id: sessionId,
    now,
    ua: meta.userAgent || null,
    ip: meta.ipHash || null,
  });
}

export function createConversation({ id, sessionId, title, model }) {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO conversations (id, session_id, user_id, title, model, metadata, created_at, updated_at)
     VALUES (@id, @session_id, NULL, @title, @model, '{}', @now, @now)`
  ).run({
    id,
    session_id: sessionId,
    title: title || null,
    model: model || null,
    now,
  });
}

export function getConversationById({ id, sessionId }) {
  const db = getDb();
  return db
    .prepare(
      `SELECT id, title, model, created_at FROM conversations
     WHERE id=@id AND session_id=@session_id AND deleted_at IS NULL`
    )
    .get({ id, session_id: sessionId });
}

// --- Sprint 2 helpers ---
export function countConversationsBySession(sessionId) {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT COUNT(1) as c FROM conversations WHERE session_id=@sessionId AND deleted_at IS NULL`
    )
    .get({ sessionId });
  return row?.c || 0;
}

// Pagination with look-ahead approach to accurately detect last page
// We fetch limit+1 records to determine if there are more pages
export function listConversations({ sessionId, cursor, limit }) {
  const db = getDb();
  limit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  let sql = `SELECT id, title, model, created_at FROM conversations
             WHERE session_id=@sessionId AND deleted_at IS NULL`;
  const params = { sessionId };
  if (cursor) {
    sql += ` AND datetime(created_at) < datetime(@cursor)`;
    params.cursor = cursor;
  }
  sql += ` ORDER BY datetime(created_at) DESC, id DESC LIMIT @limit`;
  params.limit = limit + 1; // Fetch one extra to detect if there are more
  const allItems = db.prepare(sql).all(params);
  const items = allItems.slice(0, limit); // Take only the requested limit
  const next_cursor = allItems.length > limit ? items[items.length - 1].created_at : null;
  return { items, next_cursor };
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

export function getNextSeq(conversationId) {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT COALESCE(MAX(seq), 0) + 1 as nextSeq FROM messages WHERE conversation_id=@conversationId`
    )
    .get({ conversationId });
  return row?.nextSeq || 1;
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

export function getMessagesPage({ conversationId, afterSeq = 0, limit = 50 }) {
  const db = getDb();
  limit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const messages = db
    .prepare(
      `SELECT id, seq, role, status, content, created_at
     FROM messages WHERE conversation_id=@conversationId AND seq > @afterSeq
     ORDER BY seq ASC LIMIT @limit`
    )
    .all({ conversationId, afterSeq, limit });
  const next_after_seq =
    messages.length === limit ? messages[messages.length - 1].seq : null;
  return { messages, next_after_seq };
}

// --- Sprint 3 ---
export function softDeleteConversation({ id, sessionId }) {
  const db = getDb();
  const now = new Date().toISOString();
  const info = db
    .prepare(
      `UPDATE conversations SET deleted_at=@now, updated_at=@now WHERE id=@id AND session_id=@sessionId AND deleted_at IS NULL`
    )
    .run({ id, sessionId, now });
  return info.changes > 0;
}

export function listConversationsIncludingDeleted({
  sessionId,
  cursor,
  limit,
  includeDeleted = false,
}) {
  const db = getDb();
  limit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  let sql = `SELECT id, title, model, created_at, deleted_at FROM conversations
             WHERE session_id=@sessionId`;
  if (!includeDeleted) sql += ` AND deleted_at IS NULL`;
  const params = { sessionId };
  if (cursor) {
    sql += ` AND datetime(created_at) < datetime(@cursor)`;
    params.cursor = cursor;
  }
  sql += ` ORDER BY datetime(created_at) DESC, id DESC LIMIT @limit`;
  params.limit = limit + 1; // Fetch one extra to detect if there are more
  const allItems = db
    .prepare(sql)
    .all(params)
    .map((r) => ({
      id: r.id,
      title: r.title,
      model: r.model,
      created_at: r.created_at,
    }));
  const items = allItems.slice(0, limit); // Take only the requested limit
  const next_cursor = allItems.length > limit ? items[items.length - 1].created_at : null;
  return { items, next_cursor };
}

// --- Sprint 5: Message Editing & Conversation Forking ---
export function updateMessageContent({ messageId, conversationId, sessionId, content }) {
  const db = getDb();
  const now = new Date().toISOString();
  
  // First verify the message belongs to the conversation and session
  const message = db.prepare(
    `SELECT m.id, m.conversation_id, m.role, m.seq
     FROM messages m
     JOIN conversations c ON m.conversation_id = c.id
     WHERE m.id = @messageId AND c.id = @conversationId AND c.session_id = @sessionId AND c.deleted_at IS NULL`
  ).get({ messageId, conversationId, sessionId });
  
  if (!message) return null;
  
  // Update the message content
  db.prepare(
    `UPDATE messages SET content = @content, updated_at = @now WHERE id = @messageId`
  ).run({ messageId, content, now });
  
  return message;
}

export function forkConversationFromMessage({ originalConversationId, sessionId, messageSeq, title, model }) {
  const db = getDb();
  const now = new Date().toISOString();
  
  // Create new conversation
  const { v4: uuidv4 } = require('uuid');
  const newConversationId = uuidv4();
  db.prepare(
    `INSERT INTO conversations (id, session_id, user_id, title, model, metadata, created_at, updated_at)
     VALUES (@id, @session_id, NULL, @title, @model, '{}', @now, @now)`
  ).run({
    id: newConversationId,
    session_id: sessionId,
    title: title || null,
    model: model || null,
    now,
  });
  
  // Copy messages up to and including the specified sequence
  db.prepare(
    `INSERT INTO messages (conversation_id, role, status, content, content_json, seq, tokens_in, tokens_out, finish_reason, tool_calls, function_call, created_at, updated_at)
     SELECT @newConversationId, role, status, content, content_json, seq, tokens_in, tokens_out, finish_reason, tool_calls, function_call, @now, @now
     FROM messages
     WHERE conversation_id = @originalConversationId AND seq <= @messageSeq
     ORDER BY seq`
  ).run({ newConversationId, originalConversationId, messageSeq, now });
  
  return newConversationId;
}

export function deleteMessagesAfterSeq({ conversationId, sessionId, afterSeq }) {
  const db = getDb();
  
  // Verify conversation belongs to session
  const conversation = db.prepare(
    `SELECT id FROM conversations WHERE id = @conversationId AND session_id = @sessionId AND deleted_at IS NULL`
  ).get({ conversationId, sessionId });
  
  if (!conversation) return false;
  
  // Delete messages after the specified sequence
  const result = db.prepare(
    `DELETE FROM messages WHERE conversation_id = @conversationId AND seq > @afterSeq`
  ).run({ conversationId, afterSeq });
  
  return result.changes > 0;
}

export function retentionSweep({ days }) {
  const db = getDb();
  if (!db) return { deleted: 0 };
  // cutoff timestamp
  const cutoff = new Date(
    Date.now() - days * 24 * 60 * 60 * 1000
  ).toISOString();
  // Delete in small batches for safety
  const selectStmt = db.prepare(
    `SELECT id FROM conversations
     WHERE datetime(created_at) < datetime(@cutoff)
       AND (json_extract(metadata,'$.pinned') IS NULL OR json_extract(metadata,'$.pinned') = 0)
     LIMIT 500`
  );
  const deleteMessages = db.prepare(
    `DELETE FROM messages WHERE conversation_id=@id`
  );
  const deleteConversation = db.prepare(
    `DELETE FROM conversations WHERE id=@id`
  );
  let total = 0;
  while (true) {
    const rows = selectStmt.all({ cutoff });
    if (!rows.length) break;
    const tx = db.transaction((ids) => {
      for (const r of ids) {
        deleteMessages.run({ id: r.id });
        deleteConversation.run({ id: r.id });
      }
    });
    tx(rows);
    total += rows.length;
    if (rows.length < 500) break;
  }
  return { deleted: total };
}
