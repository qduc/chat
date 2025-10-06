export default {
  version: 17,
  up: `
    -- Add client_message_id column to messages table
    ALTER TABLE messages ADD COLUMN client_message_id TEXT NULL;

    -- Create unique index to ensure client IDs are unique within a conversation
    CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_conversation_client_id
    ON messages(conversation_id, client_message_id)
    WHERE client_message_id IS NOT NULL;

    -- Create index for faster lookups by client_message_id
    CREATE INDEX IF NOT EXISTS idx_messages_client_id
    ON messages(client_message_id)
    WHERE client_message_id IS NOT NULL;
  `,
  down: `
    DROP INDEX IF EXISTS idx_messages_client_id;
    DROP INDEX IF EXISTS idx_messages_conversation_client_id;
    ALTER TABLE messages DROP COLUMN client_message_id;
  `
};
