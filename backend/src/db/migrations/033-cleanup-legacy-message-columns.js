export default {
  version: 33,
  up: `
      -- Drop index that depends on response_id column
      DROP INDEX IF EXISTS idx_messages_response_id;

      -- Drop unused legacy columns from messages table
      -- Note: This requires SQLite 3.35.0 or newer
      ALTER TABLE messages DROP COLUMN tokens_in;
      ALTER TABLE messages DROP COLUMN tokens_out;
      ALTER TABLE messages DROP COLUMN total_tokens;
      ALTER TABLE messages DROP COLUMN reasoning_tokens;
      ALTER TABLE messages DROP COLUMN finish_reason;
      ALTER TABLE messages DROP COLUMN response_id;
      ALTER TABLE messages DROP COLUMN provider;
      ALTER TABLE messages DROP COLUMN reasoning_details;
      ALTER TABLE messages DROP COLUMN tool_calls;
      ALTER TABLE messages DROP COLUMN function_call;
    `,
  down: `
      -- Restore legacy columns as NULL (since they were already unused/NULL before dropping)
      ALTER TABLE messages ADD COLUMN tokens_in INTEGER NULL;
      ALTER TABLE messages ADD COLUMN tokens_out INTEGER NULL;
      ALTER TABLE messages ADD COLUMN total_tokens INTEGER NULL;
      ALTER TABLE messages ADD COLUMN reasoning_tokens INTEGER NULL;
      ALTER TABLE messages ADD COLUMN finish_reason TEXT NULL;
      ALTER TABLE messages ADD COLUMN response_id TEXT NULL;
      ALTER TABLE messages ADD COLUMN provider TEXT NULL;
      ALTER TABLE messages ADD COLUMN reasoning_details TEXT NULL;
      ALTER TABLE messages ADD COLUMN tool_calls TEXT NULL;
      ALTER TABLE messages ADD COLUMN function_call TEXT NULL;

      -- Restore index for response_id
      CREATE INDEX IF NOT EXISTS idx_messages_response_id ON messages(response_id) WHERE response_id IS NOT NULL;
    `
};
