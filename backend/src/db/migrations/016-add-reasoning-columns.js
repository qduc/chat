export default {
  version: 16,
  up: `
    -- Add reasoning_details column to store structured reasoning blocks from providers
    ALTER TABLE messages ADD COLUMN reasoning_details TEXT NULL;

    -- Add reasoning_tokens column to capture usage metadata for reasoning
    ALTER TABLE messages ADD COLUMN reasoning_tokens INTEGER NULL;
  `,
  down: `
    -- SQLite lacks DROP COLUMN in older versions; leave columns in place on rollback
  `
};
