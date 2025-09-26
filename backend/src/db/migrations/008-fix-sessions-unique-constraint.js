export default {
  version: 8,
  up: `
      -- Drop the unique constraint on user_id to allow multiple sessions per user
      DROP INDEX IF EXISTS idx_sessions_user_id;

      -- Create a regular (non-unique) index instead for query performance
      CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
    `,
  down: `
      -- Restore the unique constraint (careful: this may fail if data exists)
      DROP INDEX IF EXISTS idx_sessions_user_id;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id) WHERE user_id IS NOT NULL;
    `
};