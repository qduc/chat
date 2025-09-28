import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { config } from '../env.js';
import { runMigrations } from './migrations.js';
import { runSeeders } from './seeders/index.js';

let db = null;
let currentDbPath = null; // Actual file path opened by better-sqlite3
let currentDbIsEphemeral = false; // Whether current DB was created from a snapshot
let snapshotCreated = false;
let snapshotPath = null;
let ephemeralCounter = 0;

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

function isTestEnv() {
  return process.env.NODE_ENV === 'test';
}

function isSafeTestUrl(url) {
  const safePatterns = [/^file::memory:$/i, /^:memory:$/i, /^file:test-.*\.db$/i];
  return safePatterns.some(pattern => pattern.test(url));
}

function isInMemoryUrl(url) {
  return /^file::memory:$/i.test(url) || /^:memory:$/i.test(url);
}

function getProjectTmpDir() {
  const dir = path.join('/tmp');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getSnapshotPath() {
  if (!snapshotPath) {
    const dir = getProjectTmpDir();
    snapshotPath = path.join(dir, 'db-snapshot.sqlite');
  }
  return snapshotPath;
}

function createFreshSnapshot() {
  const snapPath = getSnapshotPath();
  // Start from a clean file each run
  if (fs.existsSync(snapPath)) {
    try { fs.unlinkSync(snapPath); } catch {}
  }
  ensureDir(snapPath);
  const snapshotDb = new Database(snapPath);
  configurePragmas(snapshotDb);
  applyMigrations(snapshotDb);
  runSeeders(snapshotDb);
  snapshotDb.close();
  snapshotCreated = true;
}

function ensureSnapshot() {
  if (!snapshotCreated) {
    createFreshSnapshot();
  }
}

function openEphemeralFromSnapshot() {
  ensureSnapshot();
  const dir = getProjectTmpDir();
  const uniqueName = `test-db-${process.pid}-${Date.now()}-${++ephemeralCounter}.sqlite`;
  const testPath = path.join(dir, uniqueName);
  fs.copyFileSync(getSnapshotPath(), testPath);
  const database = new Database(testPath);
  configurePragmas(database);
  currentDbPath = testPath;
  currentDbIsEphemeral = true;
  return database;
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
    if (isTestEnv()) {
      if (!isSafeTestUrl(url)) {
        throw new Error(
          `[db] Unsafe test database URL detected: ${url}. Tests must use file::memory:, :memory:, or file:test-*.db`
        );
      }
    }
    if (!url.startsWith('file:')) {
      throw new Error('[db] Only SQLite (file:...) is supported currently.');
    }

    if (isTestEnv() && (isInMemoryUrl(url) || /^file:test-.*\.db$/i.test(url))) {
      // Optimize tests: run migrations & seeders once, then copy from snapshot
      if (isInMemoryUrl(url)) {
        db = openEphemeralFromSnapshot();
      } else {
        // file:test-*.db
        const filePath = url.replace(/^file:/, '');
        // If the test file does not exist yet, initialize it from snapshot
        if (!fs.existsSync(filePath)) {
          ensureSnapshot();
          ensureDir(filePath);
          fs.copyFileSync(getSnapshotPath(), filePath);
        }
        currentDbPath = filePath;
        currentDbIsEphemeral = false; // user-provided path; don't auto-delete
        db = new Database(filePath);
        configurePragmas(db);
      }
    } else {
      // Normal path (development/production)
      const filePath = url.replace(/^file:/, '');
      ensureDir(filePath);
      db = new Database(filePath);
      configurePragmas(db);
      applyMigrations(db);
      runSeeders(db);
      currentDbPath = filePath;
      currentDbIsEphemeral = false;
    }
  }
  return db;
}

export function resetDbCache() {
  if (db) {
    try { db.close(); } catch {}
  }
  db = null;
  // Remove ephemeral test DB files so next getDb() starts from a clean copy
  if (isTestEnv() && currentDbIsEphemeral && currentDbPath) {
    try {
      if (fs.existsSync(currentDbPath)) fs.unlinkSync(currentDbPath);
    } catch {}
  }
  currentDbPath = null;
  currentDbIsEphemeral = false;
}
