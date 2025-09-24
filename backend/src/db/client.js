import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { config } from '../env.js';
import { runMigrations } from './migrations.js';
import { runSeeders } from './seeders/index.js';

let db = null;

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function configurePragmas(database) {
  try {
    database.pragma('journal_mode = WAL');
    database.pragma('synchronous = NORMAL');
    database.pragma('foreign_keys = ON');
    database.pragma('busy_timeout = 5000');
  } catch (_) {
    // Best effort: ignore pragma errors on unsupported environments
  }
}

function applyMigrations(database) {
  runMigrations(database);
}

export function getDb() {
  if (!config.persistence.enabled) {
    throw new Error('[db] Persistence is disabled; operation requires DB');
  }
  if (!db) {
    const url = config.persistence.dbUrl;
    if (!url) {
      throw new Error('[db] PERSIST_TRANSCRIPTS=true but DB_URL is empty');
    }
    if (!url.startsWith('file:')) {
      throw new Error('[db] Only SQLite (file:...) is supported currently.');
    }
    const filePath = url.replace(/^file:/, '');
    ensureDir(filePath);
    db = new Database(filePath);
    configurePragmas(db);
    applyMigrations(db);
    runSeeders(db);
  }
  return db;
}

export function resetDbCache() {
  if (db) {
    db.close();
  }
  db = null;
}
