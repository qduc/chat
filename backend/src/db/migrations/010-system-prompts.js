export default {
  version: 10,
  up: `
    -- Create system_prompts table for user-owned reusable prompt presets
    CREATE TABLE system_prompts (
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

    -- Create index for efficient user prompt queries sorted by last_used_at
    CREATE INDEX IF NOT EXISTS ix_system_prompts_user_last_used ON system_prompts(user_id, last_used_at DESC);

    -- Create index for name uniqueness checks (case-insensitive)
    CREATE INDEX IF NOT EXISTS ix_system_prompts_user_name ON system_prompts(user_id, name);

    -- Create trigger to update updated_at on changes
    CREATE TRIGGER IF NOT EXISTS system_prompts_updated_at
      AFTER UPDATE ON system_prompts
      BEGIN
        UPDATE system_prompts SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
      END;
  `,
  down: `
    -- Remove trigger
    DROP TRIGGER IF EXISTS system_prompts_updated_at;

    -- Remove indexes
    DROP INDEX IF EXISTS ix_system_prompts_user_name;
    DROP INDEX IF EXISTS ix_system_prompts_user_last_used;

    -- Remove table
    DROP TABLE IF EXISTS system_prompts;
  `
};