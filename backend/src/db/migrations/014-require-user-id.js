export default {
  version: 14,
  up: `
    -- Phase 5: Require user_id - Add NOT NULL constraints after data cleanup

    -- First, set provider_id to NULL for conversations referencing global providers
    -- This prevents foreign key constraint violations when deleting global providers
    UPDATE conversations
    SET provider_id = NULL
    WHERE provider_id IN (SELECT id FROM providers WHERE user_id IS NULL);

    -- Now hard delete ALL remaining global providers (user_id IS NULL)
    -- This removes any global providers that were soft-deleted during Phase 2
    -- Since authentication is now enforced, global providers should not exist
    DELETE FROM providers WHERE user_id IS NULL;

    -- Update any remaining conversations with NULL user_id to use user_id from session
    -- This fixes conversations created before authentication was enforced
    UPDATE conversations
    SET user_id = (SELECT user_id FROM sessions WHERE id = conversations.session_id)
    WHERE user_id IS NULL
      AND EXISTS (SELECT 1 FROM sessions WHERE id = conversations.session_id AND user_id IS NOT NULL);

    -- Add NOT NULL constraint to providers.user_id
    -- SQLite doesn't support ADD CONSTRAINT, so we recreate the table

    -- Temporarily disable foreign key constraints for table recreation
    PRAGMA foreign_keys = OFF;

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
      user_id TEXT NOT NULL  -- Now NOT NULL
    );

    -- Copy all data to new table
    INSERT INTO providers_new
    SELECT id, name, provider_type, api_key, base_url, is_default, enabled,
           extra_headers, metadata, created_at, updated_at, deleted_at, user_id
    FROM providers;

    -- Replace old table with new one
    DROP TABLE providers;
    ALTER TABLE providers_new RENAME TO providers;

    -- Recreate indexes
    CREATE UNIQUE INDEX idx_providers_name ON providers(name);
    CREATE INDEX idx_providers_default ON providers(is_default);
    CREATE INDEX idx_providers_enabled ON providers(enabled);
    CREATE INDEX idx_providers_user_enabled ON providers(user_id, enabled);
    CREATE INDEX idx_providers_user ON providers(user_id);

    -- Recreate triggers for foreign key constraint
    CREATE TRIGGER fk_providers_user_check
      BEFORE INSERT ON providers
      BEGIN
        SELECT CASE
          WHEN ((SELECT COUNT(*) FROM users WHERE id = NEW.user_id) = 0)
          THEN RAISE(ABORT, 'Foreign key constraint failed: user_id does not exist in users table')
        END;
      END;

    CREATE TRIGGER fk_providers_user_check_update
      BEFORE UPDATE ON providers
      BEGIN
        SELECT CASE
          WHEN ((SELECT COUNT(*) FROM users WHERE id = NEW.user_id) = 0)
          THEN RAISE(ABORT, 'Foreign key constraint failed: user_id does not exist in users table')
        END;
      END;

    -- Add NOT NULL constraint to conversations.user_id
    -- SQLite doesn't support ADD CONSTRAINT, so we recreate the table
    CREATE TABLE conversations_new (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      user_id TEXT NOT NULL,  -- Now NOT NULL
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
      provider_id TEXT NULL REFERENCES providers(id),
      FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    -- Copy all data to new table
    INSERT INTO conversations_new
    SELECT id, session_id, user_id, title, model, metadata, created_at, updated_at,
           deleted_at, streaming_enabled, tools_enabled, research_mode, quality_level,
           reasoning_effort, verbosity, provider_id
    FROM conversations;

    -- Replace old table with new one
    DROP TABLE conversations;
    ALTER TABLE conversations_new RENAME TO conversations;

    -- Recreate indexes
    CREATE INDEX idx_conversations_session_created ON conversations(session_id, created_at DESC);

    -- Re-enable foreign key constraints
    PRAGMA foreign_keys = ON;
  `,
  down: `
    -- Phase 5 down migration: Remove NOT NULL constraints

    -- Remove NOT NULL from providers.user_id by recreating table
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
      user_id TEXT  -- Back to nullable
    );

    INSERT INTO providers_new
    SELECT id, name, provider_type, api_key, base_url, is_default, enabled,
           extra_headers, metadata, created_at, updated_at, deleted_at, user_id
    FROM providers;

    DROP TABLE providers;
    ALTER TABLE providers_new RENAME TO providers;

    -- Recreate indexes
    CREATE UNIQUE INDEX idx_providers_name ON providers(name);
    CREATE INDEX idx_providers_default ON providers(is_default);
    CREATE INDEX idx_providers_enabled ON providers(enabled);
    CREATE INDEX idx_providers_user_enabled ON providers(user_id, enabled);
    CREATE INDEX idx_providers_user ON providers(user_id);

    -- Recreate triggers
    CREATE TRIGGER fk_providers_user_check
      BEFORE INSERT ON providers
      WHEN NEW.user_id IS NOT NULL
      BEGIN
        SELECT CASE
          WHEN ((SELECT COUNT(*) FROM users WHERE id = NEW.user_id) = 0)
          THEN RAISE(ABORT, 'Foreign key constraint failed: user_id does not exist in users table')
        END;
      END;

    CREATE TRIGGER fk_providers_user_check_update
      BEFORE UPDATE ON providers
      WHEN NEW.user_id IS NOT NULL
      BEGIN
        SELECT CASE
          WHEN ((SELECT COUNT(*) FROM users WHERE id = NEW.user_id) = 0)
          THEN RAISE(ABORT, 'Foreign key constraint failed: user_id does not exist in users table')
        END;
      END;

    -- Remove NOT NULL from conversations.user_id
    CREATE TABLE conversations_new (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      user_id TEXT NULL,  -- Back to nullable
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
      provider_id TEXT NULL REFERENCES providers(id),
      FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    INSERT INTO conversations_new
    SELECT id, session_id, user_id, title, model, metadata, created_at, updated_at,
           deleted_at, streaming_enabled, tools_enabled, research_mode, quality_level,
           reasoning_effort, verbosity, provider_id
    FROM conversations;

    DROP TABLE conversations;
    ALTER TABLE conversations_new RENAME TO conversations;

    -- Recreate indexes
    CREATE INDEX idx_conversations_session_created ON conversations(session_id, created_at DESC);
  `
};