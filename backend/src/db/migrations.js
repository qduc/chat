import { createRequire } from 'module';
const require = createRequire(import.meta.url);

let migrate;

export function setMigrate(fn) {
  migrate = fn;
}

function getMigrate() {
  if (migrate) return migrate;
  try {
    const mod = require('@blackglory/better-sqlite3-migrations');
    return mod.migrate;
  } catch (err) {
    throw new Error(`Failed to load @blackglory/better-sqlite3-migrations: ${err.message}`);
  }
}
import { readdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../logger.js';

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

async function loadBaselineMigration() {
  const migrationsDir = join(__dirname, 'migrations');
  const baselinePath = join(migrationsDir, 'baseline.js');
  const migration = await import(baselinePath);
  return migration.default;
}

// Load migrations dynamically
const migrations = await loadMigrations();
const baselineMigration = await loadBaselineMigration();

export function runMigrations(db) {
  try {
    const doMigrate = getMigrate();
    const useBaseline = shouldUseBaselineMigration(db);
    if (useBaseline) {
      applyBaselineMigration(db);
      if (process.env.NODE_ENV !== 'test') {
        logger.info('[db] Applied baseline migration for blank database');
      }
    } else {
      doMigrate(db, migrations);
    }
    if (process.env.NODE_ENV !== 'test') {
      logger.info('[db] Migrations completed successfully');
    }
  } catch (error) {
    if (process.env.NODE_ENV !== 'test') {
      logger.error('[db] Migration failed:', error);
    }
    throw error;
  }
}

export function getCurrentVersion(db) {
  return db.prepare('PRAGMA user_version').get().user_version;
}

export { migrations };

function shouldUseBaselineMigration(db) {
  const version = getCurrentVersion(db);
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all();
  return version === 0 && tables.length === 0;
}

function applyBaselineMigration(db) {
  if (typeof baselineMigration.up === 'function') {
    baselineMigration.up(db);
  } else if (typeof baselineMigration.up === 'string') {
    db.exec(baselineMigration.up);
  }
  const latestVersion = migrations[migrations.length - 1]?.version ?? 0;
  if (latestVersion > 0) {
    db.pragma(`user_version = ${latestVersion}`);
  }
}
