#!/usr/bin/env node

import { getDb, resetDbCache } from '../src/db/index.js';
import { getCurrentVersion } from '../src/db/migrations.js';
import { config } from '../src/env.js';
import { logger } from '../src/logger.js';

// Ensure directories exist
import fs from 'fs';
import path from 'path';

function main() {
  const command = process.argv[2];

  if (!config.persistence.enabled) {
    logger.error('❌ Persistence is not enabled. Set PERSIST_TRANSCRIPTS=true in your .env file');
    process.exit(1);
  }

  if (!config.persistence.dbUrl) {
    logger.error('❌ Database URL not configured. Set DB_URL in your .env file');
    process.exit(1);
  }

  logger.info(`📊 Database: ${config.persistence.dbUrl}`);

  try {
    switch (command) {
      case 'status':
        showMigrationStatus();
        break;
      case 'up':
      case 'migrate':
        runMigrations();
        break;
      case 'fresh':
        freshMigrate();
        break;
      default:
        showHelp();
    }
  } catch (error) {
    logger.error('❌ Migration failed:', error.message);
    process.exit(1);
  }
}

function showMigrationStatus() {
  const db = getDb();
  if (!db) {
    logger.error('❌ Could not connect to database');
    return;
  }

  const currentVersion = getCurrentVersion(db);
  logger.info(`📋 Current database version: ${currentVersion}`);

  // Show table info
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
  logger.info(`📊 Tables: ${tables.map(t => t.name).join(', ')}`);

  db.close();
}

function runMigrations() {
  logger.info('🔄 Running migrations...');
  const db = getDb(); // This automatically runs migrations
  const version = getCurrentVersion(db);
  logger.info(`✅ Migrations complete! Current version: ${version}`);
  db.close();
}

function freshMigrate() {
  logger.warn('🗑️  Fresh migration - this will delete all data!');

  const dbPath = config.persistence.dbUrl.replace(/^file:/, '');
  if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
    logger.info('🗑️  Deleted existing database');
  }

  resetDbCache();
  runMigrations();
}

function showHelp() {
  logger.info(`
📚 Database Migration Commands:

  migrate status    Show current migration status
  migrate up        Run pending migrations  
  migrate fresh     Delete database and run all migrations (⚠️  DESTROYS DATA)
  
Examples:
  npm run migrate status
  npm run migrate up
  npm run migrate fresh
`);
}

main();