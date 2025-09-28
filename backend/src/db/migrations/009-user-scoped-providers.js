export default {
  version: 9,
  up: `
    -- Add user_id column to providers table for user scoping
    ALTER TABLE providers ADD COLUMN user_id TEXT;

    -- Add foreign key constraint to link providers to users
    -- Note: SQLite doesn't support ADD CONSTRAINT in ALTER TABLE, so we'll use a trigger approach

    -- Create index for efficient user provider queries
    CREATE INDEX IF NOT EXISTS idx_providers_user_enabled ON providers(user_id, enabled);

    -- Create index for user_id lookups
    CREATE INDEX IF NOT EXISTS idx_providers_user ON providers(user_id);

    -- Add a trigger to enforce foreign key constraint
    CREATE TRIGGER IF NOT EXISTS fk_providers_user_check
      BEFORE INSERT ON providers
      WHEN NEW.user_id IS NOT NULL
      BEGIN
        SELECT CASE
          WHEN ((SELECT COUNT(*) FROM users WHERE id = NEW.user_id) = 0)
          THEN RAISE(ABORT, 'Foreign key constraint failed: user_id does not exist in users table')
        END;
      END;

    CREATE TRIGGER IF NOT EXISTS fk_providers_user_check_update
      BEFORE UPDATE ON providers
      WHEN NEW.user_id IS NOT NULL
      BEGIN
        SELECT CASE
          WHEN ((SELECT COUNT(*) FROM users WHERE id = NEW.user_id) = 0)
          THEN RAISE(ABORT, 'Foreign key constraint failed: user_id does not exist in users table')
        END;
      END;
  `,
  down: `
    -- Remove triggers
    DROP TRIGGER IF EXISTS fk_providers_user_check_update;
    DROP TRIGGER IF EXISTS fk_providers_user_check;

    -- Remove indexes
    DROP INDEX IF EXISTS idx_providers_user;
    DROP INDEX IF EXISTS idx_providers_user_enabled;

    -- Remove user_id column
    -- Note: SQLite doesn't support DROP COLUMN directly, so we need to recreate the table
    -- This is a simplified down migration - in production, you'd want to preserve data
    CREATE TABLE providers_backup AS SELECT
      id, name, provider_type, api_key, base_url, is_default, enabled,
      extra_headers, metadata, created_at, updated_at, deleted_at
    FROM providers;

    DROP TABLE providers;

    CREATE TABLE providers (
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
      deleted_at DATETIME NULL
    );

    -- Restore data
    INSERT INTO providers SELECT
      id, name, provider_type, api_key, base_url, is_default, enabled,
      extra_headers, metadata, created_at, updated_at, deleted_at
    FROM providers_backup;

    -- Recreate original indexes
    CREATE UNIQUE INDEX IF NOT EXISTS idx_providers_name ON providers(name);
    CREATE INDEX IF NOT EXISTS idx_providers_default ON providers(is_default);
    CREATE INDEX IF NOT EXISTS idx_providers_enabled ON providers(enabled);

    -- Clean up backup
    DROP TABLE providers_backup;
  `
};