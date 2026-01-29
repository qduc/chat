export default {
  version: 29,
  up: `
    -- Disable foreign key checks temporarily to allow table recreation
    PRAGMA foreign_keys = OFF;

    -- ============================================
    -- Fix 1: Recreate providers table with scoped uniqueness
    -- ============================================
    CREATE TABLE providers_new (
      id TEXT NOT NULL,
      name TEXT NOT NULL,
      provider_type TEXT NOT NULL,
      api_key TEXT NULL,
      base_url TEXT NULL,
      is_default BOOLEAN DEFAULT 0,
      enabled BOOLEAN DEFAULT 1,
      extra_headers TEXT DEFAULT '{}',
      metadata TEXT DEFAULT '{}',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      deleted_at DATETIME NULL,
      user_id TEXT NOT NULL,
      PRIMARY KEY (id, user_id)
    );

    INSERT INTO providers_new (
      id, name, provider_type, api_key, base_url, is_default, enabled,
      extra_headers, metadata, created_at, updated_at, deleted_at, user_id
    )
    SELECT
      id, name, provider_type, api_key, base_url, is_default, enabled,
      extra_headers, metadata, created_at, updated_at, deleted_at, user_id
    FROM providers;

    DROP TABLE providers;
    ALTER TABLE providers_new RENAME TO providers;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_providers_user_name ON providers(user_id, name);
    CREATE INDEX IF NOT EXISTS idx_providers_default ON providers(is_default);
    CREATE INDEX IF NOT EXISTS idx_providers_enabled ON providers(enabled);
    CREATE INDEX IF NOT EXISTS idx_providers_user_enabled ON providers(user_id, enabled);
    CREATE INDEX IF NOT EXISTS idx_providers_user ON providers(user_id);

    -- ============================================
    -- Fix 2: Recreate tool_calls table with scoped uniqueness
    -- Tool call IDs come from upstream AI providers and could theoretically
    -- collide across different users/conversations
    -- ============================================
    CREATE TABLE tool_calls_new (
      id TEXT NOT NULL,
      message_id INTEGER NOT NULL,
      conversation_id TEXT NOT NULL,
      call_index INTEGER NOT NULL DEFAULT 0,
      tool_name TEXT NOT NULL,
      arguments TEXT NOT NULL DEFAULT '{}',
      text_offset INTEGER NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id, conversation_id),
      FOREIGN KEY(message_id) REFERENCES messages(id) ON DELETE CASCADE,
      FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    INSERT INTO tool_calls_new (
      id, message_id, conversation_id, call_index, tool_name, arguments, text_offset, created_at
    )
    SELECT
      id, message_id, conversation_id, call_index, tool_name, arguments, text_offset, created_at
    FROM tool_calls;

    -- ============================================
    -- Fix 3: Recreate tool_outputs table with corrected FK reference
    -- FK must reference composite key (id, conversation_id) on tool_calls
    -- ============================================
    CREATE TABLE tool_outputs_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tool_call_id TEXT NOT NULL,
      message_id INTEGER NOT NULL,
      conversation_id TEXT NOT NULL,
      output TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'success',
      executed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(tool_call_id, conversation_id) REFERENCES tool_calls_new(id, conversation_id) ON DELETE CASCADE,
      FOREIGN KEY(message_id) REFERENCES messages(id) ON DELETE CASCADE,
      FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    INSERT INTO tool_outputs_new (
      id, tool_call_id, message_id, conversation_id, output, status, executed_at
    )
    SELECT
      id, tool_call_id, message_id, conversation_id, output, status, executed_at
    FROM tool_outputs;

    -- Drop old tables (tool_outputs first since it references tool_calls)
    DROP TABLE tool_outputs;
    DROP TABLE tool_calls;

    -- Rename new tables
    ALTER TABLE tool_calls_new RENAME TO tool_calls;
    ALTER TABLE tool_outputs_new RENAME TO tool_outputs;

    -- Recreate indexes
    CREATE INDEX IF NOT EXISTS idx_tool_calls_message_id ON tool_calls(message_id, call_index);
    CREATE INDEX IF NOT EXISTS idx_tool_calls_conversation_id ON tool_calls(conversation_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_tool_outputs_tool_call_id ON tool_outputs(tool_call_id);
    CREATE INDEX IF NOT EXISTS idx_tool_outputs_message_id ON tool_outputs(message_id);
    CREATE INDEX IF NOT EXISTS idx_tool_outputs_conversation_id ON tool_outputs(conversation_id, executed_at DESC);

    -- Re-enable foreign key checks
    PRAGMA foreign_keys = ON;
  `,
  down: `
    -- NOTE: Down migration may fail if there are non-unique IDs across conversations/users
    PRAGMA foreign_keys = OFF;

    -- Revert providers
    CREATE TABLE providers_new (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      provider_type TEXT NOT NULL,
      api_key TEXT NULL,
      base_url TEXT NULL,
      is_default BOOLEAN DEFAULT 0,
      enabled BOOLEAN DEFAULT 1,
      extra_headers TEXT DEFAULT '{}',
      metadata TEXT DEFAULT '{}',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      deleted_at DATETIME NULL,
      user_id TEXT NOT NULL
    );

    INSERT INTO providers_new
    SELECT id, name, provider_type, api_key, base_url, is_default, enabled,
           extra_headers, metadata, created_at, updated_at, deleted_at, user_id
    FROM providers;

    DROP TABLE providers;
    ALTER TABLE providers_new RENAME TO providers;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_providers_name ON providers(name);
    CREATE INDEX IF NOT EXISTS idx_providers_default ON providers(is_default);
    CREATE INDEX IF NOT EXISTS idx_providers_enabled ON providers(enabled);
    CREATE INDEX IF NOT EXISTS idx_providers_user_enabled ON providers(user_id, enabled);
    CREATE INDEX IF NOT EXISTS idx_providers_user ON providers(user_id);

    -- Revert tool_calls
    CREATE TABLE tool_calls_new (
      id TEXT PRIMARY KEY,
      message_id INTEGER NOT NULL,
      conversation_id TEXT NOT NULL,
      call_index INTEGER NOT NULL DEFAULT 0,
      tool_name TEXT NOT NULL,
      arguments TEXT NOT NULL DEFAULT '{}',
      text_offset INTEGER NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(message_id) REFERENCES messages(id) ON DELETE CASCADE,
      FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    INSERT INTO tool_calls_new
    SELECT id, message_id, conversation_id, call_index, tool_name, arguments, text_offset, created_at
    FROM tool_calls;

    -- Revert tool_outputs
    CREATE TABLE tool_outputs_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tool_call_id TEXT NOT NULL,
      message_id INTEGER NOT NULL,
      conversation_id TEXT NOT NULL,
      output TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'success',
      executed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(tool_call_id) REFERENCES tool_calls_new(id) ON DELETE CASCADE,
      FOREIGN KEY(message_id) REFERENCES messages(id) ON DELETE CASCADE,
      FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    INSERT INTO tool_outputs_new
    SELECT id, tool_call_id, message_id, conversation_id, output, status, executed_at
    FROM tool_outputs;

    DROP TABLE tool_outputs;
    DROP TABLE tool_calls;

    ALTER TABLE tool_calls_new RENAME TO tool_calls;
    ALTER TABLE tool_outputs_new RENAME TO tool_outputs;

    CREATE INDEX IF NOT EXISTS idx_tool_calls_message_id ON tool_calls(message_id, call_index);
    CREATE INDEX IF NOT EXISTS idx_tool_calls_conversation_id ON tool_calls(conversation_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_tool_outputs_tool_call_id ON tool_outputs(tool_call_id);
    CREATE INDEX IF NOT EXISTS idx_tool_outputs_message_id ON tool_outputs(message_id);
    CREATE INDEX IF NOT EXISTS idx_tool_outputs_conversation_id ON tool_outputs(conversation_id, executed_at DESC);

    PRAGMA foreign_keys = ON;
  `
};
