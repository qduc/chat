export default {
  version: 5,
  up(db) {
    const existing = db.prepare("PRAGMA table_info('conversations')").all().map(r => r.name);
    if (existing.includes('provider')) {
      db.exec(`
          ALTER TABLE conversations
          RENAME COLUMN provider TO provider_id
        `);
    }
  },
  down: `
      -- SQLite doesn't support DROP COLUMN, so we'd need to recreate the table
      -- For now, just leave the columns (they won't hurt anything)
      SELECT 'Cannot drop columns in SQLite - columns will remain but be unused' as warning;
    `
};
