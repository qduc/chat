export default {
  version: 20,
  up: `
    -- Create journal table for model-authored entries (per-user)
    CREATE TABLE IF NOT EXISTS journal (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      model_name TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_journal_user_created_at ON journal(user_id, created_at DESC);
  `,
  down: `
    DROP INDEX IF EXISTS idx_journal_user_created_at;
    DROP TABLE IF EXISTS journal;
  `
};
