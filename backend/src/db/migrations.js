import { migrate } from '@blackglory/better-sqlite3-migrations';

// Migration definitions - each migration should have a unique version number
const migrations = [
  {
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
  },
  {
    version: 2,
    up(db) {
      // Make this migration idempotent by only adding columns that do not already exist.
      const existing = db.prepare("PRAGMA table_info('conversations')").all().map(r => r.name);

      if (!existing.includes('streaming_enabled')) {
        db.exec("ALTER TABLE conversations ADD COLUMN streaming_enabled BOOLEAN DEFAULT 0;");
      }
      if (!existing.includes('tools_enabled')) {
        db.exec("ALTER TABLE conversations ADD COLUMN tools_enabled BOOLEAN DEFAULT 0;");
      }
      if (!existing.includes('research_mode')) {
        db.exec("ALTER TABLE conversations ADD COLUMN research_mode BOOLEAN DEFAULT 0;");
      }
      if (!existing.includes('quality_level')) {
        db.exec("ALTER TABLE conversations ADD COLUMN quality_level TEXT NULL;");
      }
      if (!existing.includes('reasoning_effort')) {
        db.exec("ALTER TABLE conversations ADD COLUMN reasoning_effort TEXT NULL;");
      }
      if (!existing.includes('verbosity')) {
        db.exec("ALTER TABLE conversations ADD COLUMN verbosity TEXT NULL;");
      }
    },
    down: `
      -- SQLite doesn't support DROP COLUMN, so we'd need to recreate the table
      -- For now, just leave the columns (they won't hurt anything)
      -- In production, you might want to implement a full table recreation
      SELECT 'Cannot drop columns in SQLite - columns will remain but be unused' as warning;
    `
  }
  ,
  {
    version: 3,
    up: `
      -- Providers configuration table
      CREATE TABLE IF NOT EXISTS providers (
        id TEXT PRIMARY KEY,                    -- UUID or slug
        name TEXT NOT NULL,                     -- Human-readable name
        provider_type TEXT NOT NULL,            -- e.g. openai, azure_openai, anthropic
        api_key TEXT NULL,                      -- Secret token (store securely in production)
        base_url TEXT NULL,                     -- Override base URL if needed
        is_default BOOLEAN DEFAULT 0,           -- Whether this provider is default
        enabled BOOLEAN DEFAULT 1,              -- Soft enable/disable
        extra_headers TEXT DEFAULT '{}',        -- JSON string for custom headers
        metadata TEXT DEFAULT '{}',             -- Arbitrary provider-specific JSON
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        deleted_at DATETIME NULL
      );

      -- Helpful indexes and constraints
      CREATE UNIQUE INDEX IF NOT EXISTS idx_providers_name ON providers(name);
      CREATE INDEX IF NOT EXISTS idx_providers_default ON providers(is_default);
      CREATE INDEX IF NOT EXISTS idx_providers_enabled ON providers(enabled);
    `,
    down: `
      DROP INDEX IF EXISTS idx_providers_enabled;
      DROP INDEX IF EXISTS idx_providers_default;
      DROP INDEX IF EXISTS idx_providers_name;
      DROP TABLE IF EXISTS providers;
    `
  }
];

export function runMigrations(db) {
  try {
    migrate(db, migrations);
    console.log('[db] Migrations completed successfully');
  } catch (error) {
    console.error('[db] Migration failed:', error);
    throw error;
  }
}

export function getCurrentVersion(db) {
  return db.prepare('PRAGMA user_version').get().user_version;
}

export { migrations };
