import { migrate } from '@blackglory/better-sqlite3-migrations';

import m1 from './migrations/001-initial.js';
import m2 from './migrations/002-add-conversation-columns.js';
import m3 from './migrations/003-providers.js';
import m4 from './migrations/004-add-provider-id.js';
import m5 from './migrations/005-rename-provider-column.js';

// Assemble migrations in order. Each migration should have a unique version number.
const migrations = [m1, m2, m3, m4, m5];

export function runMigrations(db) {
  try {
    migrate(db, migrations);
    if (process.env.NODE_ENV !== 'test') {
      console.log('[db] Migrations completed successfully');
    }
  } catch (error) {
    if (process.env.NODE_ENV !== 'test') {
      console.error('[db] Migration failed:', error);
    }
    throw error;
  }
}

export function getCurrentVersion(db) {
  return db.prepare('PRAGMA user_version').get().user_version;
}

export { migrations };
