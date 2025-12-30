export default {
  version: 25,
  up: `
      ALTER TABLE messages ADD COLUMN provider TEXT NULL;
    `,
  down: `
      -- SQLite cannot drop columns easily; leave as-is
    `
};
