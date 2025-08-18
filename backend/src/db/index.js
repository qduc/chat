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
      throw new Error('[db] Only SQLite (file:...) is supported in Sprint 1.');
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
