export default {
  version: 30,
  up: `
      -- Fix drift: Recreate missing session user index if it was lost during migration 014
      CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
    `,
  down: `
      -- Non-destructive down migration: index can stay
    `
};
