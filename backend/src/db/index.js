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

export function upsertSession(sessionId, meta = {}) {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO sessions (id, user_id, created_at, last_seen_at, user_agent, ip_hash)
     VALUES (@id, NULL, @now, @now, @ua, @ip)
     ON CONFLICT(id) DO UPDATE SET last_seen_at=@now`
  ).run({ id: sessionId, now, ua: meta.userAgent || null, ip: meta.ipHash || null });
}

export function createConversation({ id, sessionId, title, model }) {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO conversations (id, session_id, user_id, title, model, metadata, created_at, updated_at)
     VALUES (@id, @session_id, NULL, @title, @model, '{}', @now, @now)`
  ).run({ id, session_id: sessionId, title: title || null, model: model || null, now });
}

export function getConversationById({ id, sessionId }) {
  const db = getDb();
  return db.prepare(
    `SELECT id, title, model, created_at FROM conversations
     WHERE id=@id AND session_id=@session_id AND deleted_at IS NULL`
  ).get({ id, session_id: sessionId });
}

// --- Sprint 2 helpers ---
export function countConversationsBySession(sessionId) {
  const db = getDb();
  const row = db.prepare(
    `SELECT COUNT(1) as c FROM conversations WHERE session_id=@sessionId AND deleted_at IS NULL`
  ).get({ sessionId });
  return row?.c || 0;
}

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
  params.limit = limit;
  const items = db.prepare(sql).all(params);
  const next_cursor = items.length === limit ? items[items.length - 1].created_at : null;
  return { items, next_cursor };
}

export function countMessagesByConversation(conversationId) {
  const db = getDb();
  const row = db.prepare(
    `SELECT COUNT(1) as c FROM messages WHERE conversation_id=@conversationId`
  ).get({ conversationId });
  return row?.c || 0;
}

export function getNextSeq(conversationId) {
  const db = getDb();
  const row = db.prepare(
    `SELECT COALESCE(MAX(seq), 0) + 1 as nextSeq FROM messages WHERE conversation_id=@conversationId`
  ).get({ conversationId });
  return row?.nextSeq || 1;
}

export function insertUserMessage({ conversationId, content, seq }) {
  const db = getDb();
  const now = new Date().toISOString();
  const info = db.prepare(
    `INSERT INTO messages (conversation_id, role, status, content, seq, created_at, updated_at)
     VALUES (@conversationId, 'user', 'final', @content, @seq, @now, @now)`
  ).run({ conversationId, content: content || '', seq, now });
  return { id: info.lastInsertRowid, seq };
}

export function createAssistantDraft({ conversationId, seq }) {
  const db = getDb();
  const now = new Date().toISOString();
  const info = db.prepare(
    `INSERT INTO messages (conversation_id, role, status, content, seq, created_at, updated_at)
     VALUES (@conversationId, 'assistant', 'streaming', '', @seq, @now, @now)`
  ).run({ conversationId, seq, now });
  return { id: info.lastInsertRowid, seq };
}

export function appendAssistantContent({ messageId, delta }) {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE messages SET content = COALESCE(content,'') || @delta, updated_at=@now WHERE id=@messageId`
  ).run({ messageId, delta: delta || '', now });
}

export function finalizeAssistantMessage({ messageId, finishReason = null, status = 'final' }) {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE messages SET status=@status, finish_reason=@finishReason, updated_at=@now WHERE id=@messageId`
  ).run({ messageId, finishReason, status, now });
}

export function markAssistantError({ messageId }) {
  finalizeAssistantMessage({ messageId, finishReason: 'error', status: 'error' });
}

export function getMessagesPage({ conversationId, afterSeq = 0, limit = 50 }) {
  const db = getDb();
  limit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const messages = db.prepare(
    `SELECT id, seq, role, status, content, created_at
     FROM messages WHERE conversation_id=@conversationId AND seq > @afterSeq
     ORDER BY seq ASC LIMIT @limit`
  ).all({ conversationId, afterSeq, limit });
  const next_after_seq = messages.length === limit ? messages[messages.length - 1].seq : null;
  return { messages, next_after_seq };
}
