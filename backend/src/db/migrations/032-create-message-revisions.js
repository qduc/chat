export default {
  version: 32,
  up: `
    CREATE TABLE IF NOT EXISTS message_revisions (
      id                       TEXT PRIMARY KEY,
      conversation_id          TEXT NOT NULL,
      user_id                  TEXT NOT NULL,
      anchor_message_id        TEXT NOT NULL,
      operation_type           TEXT NOT NULL CHECK(operation_type IN ('edit', 'regenerate')),
      anchor_content_snapshot  TEXT NULL,
      follow_ups_snapshot      TEXT NOT NULL DEFAULT '[]',
      created_at               TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_msg_revisions_anchor
      ON message_revisions(conversation_id, anchor_message_id);

    CREATE INDEX IF NOT EXISTS idx_msg_revisions_user
      ON message_revisions(user_id);
  `,
  down: `
    DROP TABLE IF EXISTS message_revisions;
  `
};
