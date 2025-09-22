export default {
  version: 2,
  up(db) {
    // Make this migration idempotent by only adding columns that do not already exist.
    const existing = db.prepare("PRAGMA table_info('conversations')").all().map(r => r.name);

    if (!existing.includes('streaming_enabled')) {
      db.exec("ALTER TABLE conversations ADD COLUMN streaming_enabled BOOLEAN DEFAULT 0;");
    }
    if (!existing.includes('tools_enabled')) {
      db.exec("ALTER TABLE conversations ADD COLUMN tools_enabled BOOLEAN DEFAULT 0;");
    }
    if (!existing.includes('research_mode')) {
      db.exec("ALTER TABLE conversations ADD COLUMN research_mode BOOLEAN DEFAULT 0;");
    }
    if (!existing.includes('quality_level')) {
      db.exec("ALTER TABLE conversations ADD COLUMN quality_level TEXT NULL;");
    }
    if (!existing.includes('reasoning_effort')) {
      db.exec("ALTER TABLE conversations ADD COLUMN reasoning_effort TEXT NULL;");
    }
    if (!existing.includes('verbosity')) {
      db.exec("ALTER TABLE conversations ADD COLUMN verbosity TEXT NULL;");
    }
  },
  down: `
      -- SQLite doesn't support DROP COLUMN, so we'd need to recreate the table
      -- For now, just leave the columns (they won't hurt anything)
      -- In production, you might want to implement a full table recreation
      SELECT 'Cannot drop columns in SQLite - columns will remain but be unused' as warning;
    `
};
