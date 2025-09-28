export default {
  version: 7,
  up: `
      -- No need to alter the existing user_id column as it already exists
      -- Just ensure the foreign key constraint is properly set up
      -- SQLite will handle this gracefully for existing NULL values
      CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id) WHERE user_id IS NOT NULL;
    `,
  down: `
      DROP INDEX IF EXISTS idx_sessions_user_id;
    `
};