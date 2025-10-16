export default {
  version: 19,
  up: `
    -- Create table for per-user settings (key/value)
    CREATE TABLE IF NOT EXISTS user_settings (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      value TEXT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Unique per-user setting name
    CREATE UNIQUE INDEX IF NOT EXISTS idx_user_settings_user_name ON user_settings(user_id, name);

    -- Index for user lookups
    CREATE INDEX IF NOT EXISTS idx_user_settings_user ON user_settings(user_id);

    -- Trigger to enforce user existence (best-effort foreign key behavior)
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

    -- Update timestamp on row update
    CREATE TRIGGER IF NOT EXISTS trg_user_settings_updated_at
      AFTER UPDATE ON user_settings
      BEGIN
        UPDATE user_settings SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
      END;
  `,
  down: `
    DROP TRIGGER IF EXISTS trg_user_settings_updated_at;
    DROP TRIGGER IF EXISTS fk_user_settings_user_check_update;
    DROP TRIGGER IF EXISTS fk_user_settings_user_check;
    DROP INDEX IF EXISTS idx_user_settings_user;
    DROP INDEX IF EXISTS idx_user_settings_user_name;
    DROP TABLE IF EXISTS user_settings;
  `
};
