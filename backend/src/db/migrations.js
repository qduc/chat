import { migrate } from '@blackglory/better-sqlite3-migrations';
import { readdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function loadMigrations() {
  const migrationsDir = join(__dirname, 'migrations');
  const files = await readdir(migrationsDir);

  // Filter and sort migration files by their numeric prefix
  const migrationFiles = files
    .filter(file => file.endsWith('.js') && /^\d{3}-/.test(file))
    .sort((a, b) => {
      const aNum = parseInt(a.split('-')[0]);
      const bNum = parseInt(b.split('-')[0]);
      return aNum - bNum;
    });

  // Dynamically import all migration modules
  const migrations = [];
  for (const file of migrationFiles) {
    const migrationPath = join(migrationsDir, file);
    const migration = await import(migrationPath);
    migrations.push(migration.default);
  }

  return migrations;
}

// Load migrations dynamically
const migrations = await loadMigrations();

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
