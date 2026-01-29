export default {
  version: 29,
  up: `
    -- Disable foreign key checks temporarily to allow table recreation
    PRAGMA foreign_keys = OFF;

    -- Recreate providers table with scoped uniqueness
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

    -- Copy data from old table
    INSERT INTO providers_new (
      id, name, provider_type, api_key, base_url, is_default, enabled,
      extra_headers, metadata, created_at, updated_at, deleted_at, user_id
    )
    SELECT
      id, name, provider_type, api_key, base_url, is_default, enabled,
      extra_headers, metadata, created_at, updated_at, deleted_at, user_id
    FROM providers;

    -- Drop old table and rename new one
    DROP TABLE providers;
    ALTER TABLE providers_new RENAME TO providers;

    -- Create scoped indexes
    -- Composite unique index on (user_id, name) allows different users to have the same provider name
    CREATE UNIQUE INDEX IF NOT EXISTS idx_providers_user_name ON providers(user_id, name);
    CREATE INDEX IF NOT EXISTS idx_providers_default ON providers(is_default);
    CREATE INDEX IF NOT EXISTS idx_providers_enabled ON providers(enabled);
    CREATE INDEX IF NOT EXISTS idx_providers_user_enabled ON providers(user_id, enabled);
    CREATE INDEX IF NOT EXISTS idx_providers_user ON providers(user_id);

    -- Re-enable foreign key checks
    PRAGMA foreign_keys = ON;
  `,
  down: `
    -- NOTE: Down migration may fail if there are non-unique IDs or names across users
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

    PRAGMA foreign_keys = ON;
  `
};
