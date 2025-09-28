export default {
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
};
