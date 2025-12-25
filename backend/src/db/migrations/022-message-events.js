export default {
  version: 22,
  up: `
    -- Create message_events table to capture ordered assistant events
    CREATE TABLE IF NOT EXISTS message_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id INTEGER NOT NULL,
      conversation_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      type TEXT NOT NULL,
      payload TEXT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(message_id) REFERENCES messages(id) ON DELETE CASCADE,
      FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_message_events_message_id ON message_events(message_id, seq);
    CREATE INDEX IF NOT EXISTS idx_message_events_conversation_id ON message_events(conversation_id, seq);
  `,
  down: `
    DROP INDEX IF EXISTS idx_message_events_conversation_id;
    DROP INDEX IF EXISTS idx_message_events_message_id;
    DROP TABLE IF EXISTS message_events;
  `
};
