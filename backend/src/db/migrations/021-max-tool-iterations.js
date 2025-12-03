export default {
  version: 21,
  up: `
    -- Add max_tool_iterations column to users table
    -- Default value is 10, min is 1, max is 50
    ALTER TABLE users ADD COLUMN max_tool_iterations INTEGER DEFAULT 10 NOT NULL;

    -- Add constraint to ensure value is between 1 and 50
    -- SQLite doesn't support CHECK constraints well, so we'll enforce in application layer
  `,
  down: `
    -- Remove max_tool_iterations column
    ALTER TABLE users DROP COLUMN max_tool_iterations;
  `
};
