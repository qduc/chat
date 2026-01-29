export default {
  version: 30,
  up: `
      PRAGMA journal_mode = WAL;

      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        display_name TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        email_verified BOOLEAN DEFAULT FALSE,
        last_login_at DATETIME,
        deleted_at DATETIME,
        max_tool_iterations INTEGER DEFAULT 10 NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);
      CREATE INDEX IF NOT EXISTS idx_users_created ON users(created_at);

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_seen_at DATETIME NULL,
        user_agent TEXT NULL,
        ip_hash TEXT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);

      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        title TEXT NULL,
        model TEXT NULL,
        metadata TEXT DEFAULT '{}',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        deleted_at DATETIME NULL,
        streaming_enabled BOOLEAN DEFAULT 0,
        tools_enabled BOOLEAN DEFAULT 0,
        research_mode BOOLEAN DEFAULT 0,
        quality_level TEXT NULL,
        reasoning_effort TEXT NULL,
        verbosity TEXT NULL,
        provider_id TEXT NULL,
        parent_conversation_id TEXT DEFAULT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_conversations_session_created ON conversations(session_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_conversations_parent_id ON conversations(parent_conversation_id);

      CREATE TABLE IF NOT EXISTS providers (
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

      CREATE UNIQUE INDEX IF NOT EXISTS idx_providers_user_name ON providers(user_id, name);
      CREATE INDEX IF NOT EXISTS idx_providers_default ON providers(is_default);
      CREATE INDEX IF NOT EXISTS idx_providers_enabled ON providers(enabled);
      CREATE INDEX IF NOT EXISTS idx_providers_user_enabled ON providers(user_id, enabled);
      CREATE INDEX IF NOT EXISTS idx_providers_user ON providers(user_id);

      CREATE TABLE IF NOT EXISTS system_prompts (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        body TEXT NOT NULL,
        usage_count INTEGER NOT NULL DEFAULT 0,
        last_used_at DATETIME NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id)
      );

      CREATE INDEX IF NOT EXISTS ix_system_prompts_user_last_used ON system_prompts(user_id, last_used_at DESC);
      CREATE INDEX IF NOT EXISTS ix_system_prompts_user_name ON system_prompts(user_id, name);

      CREATE TRIGGER IF NOT EXISTS system_prompts_updated_at
        AFTER UPDATE ON system_prompts
        BEGIN
          UPDATE system_prompts SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
        END;

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
        response_id TEXT NULL,
        reasoning_details TEXT NULL,
        reasoning_tokens INTEGER NULL,
        client_message_id TEXT NULL,
        total_tokens INTEGER NULL,
        provider TEXT NULL,
        metadata_json TEXT NULL,
        UNIQUE(conversation_id, seq),
        FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
        FOREIGN KEY(parent_message_id) REFERENCES messages(id)
      );

      CREATE INDEX IF NOT EXISTS idx_messages_conv_id ON messages(conversation_id, id);
      CREATE INDEX IF NOT EXISTS idx_messages_response_id ON messages(response_id) WHERE response_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_messages_conversation_role_seq
        ON messages(conversation_id, role, seq DESC)
        WHERE role = 'assistant';
      CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_conversation_client_id
        ON messages(conversation_id, client_message_id)
        WHERE client_message_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_messages_client_id
        ON messages(client_message_id)
        WHERE client_message_id IS NOT NULL;

      CREATE TABLE IF NOT EXISTS tool_calls (
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

      CREATE TABLE IF NOT EXISTS tool_outputs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tool_call_id TEXT NOT NULL,
        message_id INTEGER NOT NULL,
        conversation_id TEXT NOT NULL,
        output TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'success',
        executed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(tool_call_id, conversation_id) REFERENCES tool_calls(id, conversation_id) ON DELETE CASCADE,
        FOREIGN KEY(message_id) REFERENCES messages(id) ON DELETE CASCADE,
        FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_tool_calls_message_id ON tool_calls(message_id, call_index);
      CREATE INDEX IF NOT EXISTS idx_tool_calls_conversation_id ON tool_calls(conversation_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_tool_outputs_tool_call_id ON tool_outputs(tool_call_id);
      CREATE INDEX IF NOT EXISTS idx_tool_outputs_message_id ON tool_outputs(message_id);
      CREATE INDEX IF NOT EXISTS idx_tool_outputs_conversation_id ON tool_outputs(conversation_id, executed_at DESC);

      CREATE TABLE IF NOT EXISTS evaluations (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        model_a_conversation_id TEXT NOT NULL,
        model_a_message_id TEXT NOT NULL,
        model_b_conversation_id TEXT NOT NULL,
        model_b_message_id TEXT NOT NULL,
        judge_model_id TEXT NOT NULL,
        criteria TEXT NULL,
        score_a INTEGER NULL,
        score_b INTEGER NULL,
        winner TEXT NULL,
        reasoning TEXT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_evaluations_conversation_id
        ON evaluations(conversation_id, created_at DESC);

      CREATE UNIQUE INDEX IF NOT EXISTS idx_evaluations_unique_pair
        ON evaluations(
          user_id,
          model_a_conversation_id,
          model_a_message_id,
          model_b_conversation_id,
          model_b_message_id,
          judge_model_id,
          criteria
        );

      CREATE TABLE IF NOT EXISTS evaluation_models (
        id TEXT PRIMARY KEY,
        evaluation_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        model_id TEXT NULL,
        conversation_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        score REAL NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(evaluation_id) REFERENCES evaluations(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_evaluation_models_evaluation_id
        ON evaluation_models(evaluation_id);

      CREATE INDEX IF NOT EXISTS idx_evaluation_models_user_id
        ON evaluation_models(user_id);

      CREATE TABLE IF NOT EXISTS images (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        storage_filename TEXT NOT NULL,
        original_name TEXT,
        mime_type TEXT,
        size INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_images_user_id ON images(user_id);

      CREATE TABLE IF NOT EXISTS files (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        storage_filename TEXT NOT NULL,
        original_name TEXT NOT NULL,
        mime_type TEXT,
        size INTEGER NOT NULL,
        content TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_files_user_id ON files(user_id);

      CREATE TABLE IF NOT EXISTS user_settings (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        value TEXT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_user_settings_user_name ON user_settings(user_id, name);
      CREATE INDEX IF NOT EXISTS idx_user_settings_user ON user_settings(user_id);

      CREATE TRIGGER IF NOT EXISTS fk_user_settings_user_check
        BEFORE INSERT ON user_settings
        WHEN NEW.user_id IS NOT NULL
        BEGIN
          SELECT CASE
            WHEN ((SELECT COUNT(*) FROM users WHERE id = NEW.user_id) = 0)
            THEN RAISE(ABORT, 'Foreign key constraint failed: user_id does not exist in users table')
          END;
        END;

      CREATE TRIGGER IF NOT EXISTS fk_user_settings_user_check_update
        BEFORE UPDATE ON user_settings
        WHEN NEW.user_id IS NOT NULL
        BEGIN
          SELECT CASE
            WHEN ((SELECT COUNT(*) FROM users WHERE id = NEW.user_id) = 0)
            THEN RAISE(ABORT, 'Foreign key constraint failed: user_id does not exist in users table')
          END;
        END;

      CREATE TRIGGER IF NOT EXISTS trg_user_settings_updated_at
        AFTER UPDATE ON user_settings
        BEGIN
          UPDATE user_settings SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
        END;

      CREATE TABLE IF NOT EXISTS journal (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        model_name TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_journal_user_created_at ON journal(user_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS message_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id INTEGER NOT NULL,
        conversation_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        type TEXT NOT NULL,
        payload TEXT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(message_id) REFERENCES messages(id) ON DELETE CASCADE,
        FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_message_events_message_id ON message_events(message_id, seq);
      CREATE INDEX IF NOT EXISTS idx_message_events_conversation_id ON message_events(conversation_id, seq);
    `,
  down: `
      -- Baseline migration is non-reversible; leave as-is
    `
};
