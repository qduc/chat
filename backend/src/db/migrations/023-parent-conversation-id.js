/**
 * Migration: Add parent_conversation_id column for linked comparison conversations
 *
 * This enables storing comparison/secondary model responses as separate conversations
 * that are linked to a primary conversation. Conversations with a non-null parent_conversation_id
 * are excluded from the main conversation list.
 */

export default {
  version: 23,
  up: `
    -- Add parent_conversation_id column for linked comparison conversations
    ALTER TABLE conversations ADD COLUMN parent_conversation_id TEXT DEFAULT NULL;

    -- Create index for efficient lookups of child conversations
    CREATE INDEX IF NOT EXISTS idx_conversations_parent_id ON conversations(parent_conversation_id);
  `,
  down: `
    -- Note: SQLite doesn't support DROP COLUMN, so the column will remain but be unused
    DROP INDEX IF EXISTS idx_conversations_parent_id;
  `
};
