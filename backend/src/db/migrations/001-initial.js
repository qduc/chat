export default {
  version: 1,
  up: `
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
        metadata TEXT DEFAULT '{}',
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
    `,
  down: `
      DROP INDEX IF EXISTS idx_messages_conv_id;
      DROP INDEX IF EXISTS idx_conversations_session_created;
      DROP TABLE IF EXISTS messages;
      DROP TABLE IF EXISTS conversations;
      DROP TABLE IF EXISTS sessions;
    `
};
