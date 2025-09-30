export default {
  version: 12,
  up: `
    -- Create dedicated tool_calls table
    -- Stores tool calls made by the assistant during conversation
    CREATE TABLE IF NOT EXISTS tool_calls (
      id TEXT PRIMARY KEY,                        -- Tool call ID (e.g., call_abc123)
      message_id INTEGER NOT NULL,                -- Reference to the assistant message that made this tool call
      conversation_id TEXT NOT NULL,              -- Denormalized for efficient queries
      call_index INTEGER NOT NULL DEFAULT 0,      -- Order of tool call within the message (for multiple parallel calls)
      tool_name TEXT NOT NULL,                    -- Name of the tool (e.g., 'get_time', 'web_search')
      arguments TEXT NOT NULL DEFAULT '{}',       -- JSON string of tool arguments
      text_offset INTEGER NULL,                   -- Character offset in message content where tool call appears
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(message_id) REFERENCES messages(id) ON DELETE CASCADE,
      FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    -- Create dedicated tool_outputs table
    -- Stores the results/outputs from tool execution
    CREATE TABLE IF NOT EXISTS tool_outputs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tool_call_id TEXT NOT NULL,                 -- Reference to the tool call this output belongs to
      message_id INTEGER NOT NULL,                -- Reference to the assistant message (for easier retrieval)
      conversation_id TEXT NOT NULL,              -- Denormalized for efficient queries
      output TEXT NOT NULL,                       -- Tool execution result (JSON string or plain text)
      status TEXT NOT NULL DEFAULT 'success',     -- 'success', 'error', 'timeout'
      executed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(tool_call_id) REFERENCES tool_calls(id) ON DELETE CASCADE,
      FOREIGN KEY(message_id) REFERENCES messages(id) ON DELETE CASCADE,
      FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    -- Indexes for efficient queries
    CREATE INDEX IF NOT EXISTS idx_tool_calls_message_id ON tool_calls(message_id, call_index);
    CREATE INDEX IF NOT EXISTS idx_tool_calls_conversation_id ON tool_calls(conversation_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_tool_outputs_tool_call_id ON tool_outputs(tool_call_id);
    CREATE INDEX IF NOT EXISTS idx_tool_outputs_message_id ON tool_outputs(message_id);
    CREATE INDEX IF NOT EXISTS idx_tool_outputs_conversation_id ON tool_outputs(conversation_id, executed_at DESC);
  `,
  down: `
    -- Remove indexes
    DROP INDEX IF EXISTS idx_tool_outputs_conversation_id;
    DROP INDEX IF EXISTS idx_tool_outputs_message_id;
    DROP INDEX IF EXISTS idx_tool_outputs_tool_call_id;
    DROP INDEX IF EXISTS idx_tool_calls_conversation_id;
    DROP INDEX IF EXISTS idx_tool_calls_message_id;

    -- Remove tables
    DROP TABLE IF EXISTS tool_outputs;
    DROP TABLE IF EXISTS tool_calls;
  `
};
