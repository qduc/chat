export default {
  version: 33,
  up: `
    ALTER TABLE conversations ADD COLUMN active_branch_id TEXT DEFAULT NULL;

    CREATE TABLE IF NOT EXISTS conversation_branches (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      parent_branch_id TEXT NULL,
      branch_point_message_id INTEGER NULL,
      source_message_id INTEGER NULL,
      operation_type TEXT NOT NULL CHECK(operation_type IN ('root', 'edit', 'regenerate', 'fork')),
      label TEXT NULL,
      head_message_id INTEGER NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      archived_at DATETIME NULL,
      FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY(parent_branch_id) REFERENCES conversation_branches(id),
      FOREIGN KEY(branch_point_message_id) REFERENCES messages(id) ON DELETE SET NULL,
      FOREIGN KEY(source_message_id) REFERENCES messages(id) ON DELETE SET NULL,
      FOREIGN KEY(head_message_id) REFERENCES messages(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_conversation_branches_conversation
      ON conversation_branches(conversation_id, created_at ASC);
    CREATE INDEX IF NOT EXISTS idx_conversation_branches_parent
      ON conversation_branches(parent_branch_id);
    CREATE INDEX IF NOT EXISTS idx_conversation_branches_source_message
      ON conversation_branches(conversation_id, source_message_id);

    ALTER TABLE messages ADD COLUMN branch_id TEXT NULL;

    CREATE INDEX IF NOT EXISTS idx_messages_branch_seq ON messages(branch_id, seq ASC);
    CREATE INDEX IF NOT EXISTS idx_messages_parent_message_id ON messages(parent_message_id);

    INSERT INTO conversation_branches (
      id,
      conversation_id,
      user_id,
      parent_branch_id,
      branch_point_message_id,
      source_message_id,
      operation_type,
      label,
      head_message_id,
      created_at,
      updated_at,
      archived_at
    )
    SELECT
      c.id || ':root',
      c.id,
      c.user_id,
      NULL,
      NULL,
      NULL,
      'root',
      'Main',
      (
        SELECT m.id
        FROM messages m
        WHERE m.conversation_id = c.id
        ORDER BY m.seq DESC, m.id DESC
        LIMIT 1
      ),
      c.created_at,
      c.updated_at,
      NULL
    FROM conversations c
    WHERE NOT EXISTS (
      SELECT 1
      FROM conversation_branches b
      WHERE b.conversation_id = c.id
    );

    UPDATE messages
    SET branch_id = conversation_id || ':root'
    WHERE branch_id IS NULL;

    UPDATE conversations
    SET active_branch_id = id || ':root'
    WHERE active_branch_id IS NULL;

    DROP TABLE IF EXISTS message_revisions;
  `,
  // NOTE: This down migration is intentionally incomplete and non-reversible.
  // SQLite (older versions) does not support DROP COLUMN, so we cannot remove:
  //   - conversations.active_branch_id
  //   - messages.branch_id / messages.parent_message_id
  //   - the three indexes added in the up script
  // Rolling back this migration will leave the schema in a partially-migrated state.
  // If a full rollback is needed, restore from a database backup taken before migration 033.
  down: `
    DROP TABLE IF EXISTS conversation_branches;
    DROP TABLE IF EXISTS message_revisions;
  `
};
