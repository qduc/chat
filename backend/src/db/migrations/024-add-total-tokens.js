export default {
  version: 24,
  up: `
      ALTER TABLE messages ADD COLUMN total_tokens INTEGER NULL;
    `,
  down: `
      -- SQLite cannot drop columns easily; leave as-is
    `
};
