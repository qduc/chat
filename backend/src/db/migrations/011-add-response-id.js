export default {
  version: 11,
  up: `
    -- Add response_id column to messages table to store OpenAI response IDs
    -- This enables efficient conversation state management using previous_response_id
    -- instead of sending full message history on every request
    ALTER TABLE messages ADD COLUMN response_id TEXT NULL;

    -- Create index for efficient response_id lookups
    CREATE INDEX IF NOT EXISTS idx_messages_response_id ON messages(response_id) WHERE response_id IS NOT NULL;

    -- Create index to quickly find the last assistant message in a conversation
    CREATE INDEX IF NOT EXISTS idx_messages_conversation_role_seq ON messages(conversation_id, role, seq DESC) WHERE role = 'assistant';
  `,
  down: `
    -- Remove indexes
    DROP INDEX IF EXISTS idx_messages_conversation_role_seq;
    DROP INDEX IF EXISTS idx_messages_response_id;

    -- Note: SQLite doesn't support DROP COLUMN directly in older versions
    -- For a proper down migration, you would need to recreate the table without the column
    -- For now, we'll leave the column as it doesn't break existing functionality
  `
};
