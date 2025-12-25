#!/usr/bin/env node

import { getDb } from '../src/db/index.js';
import { config } from '../src/env.js';
import { logger } from '../src/logger.js';
import { encryptForUser } from '../src/db/encryption.js';
import { isEncrypted, isKekConfigured } from '../src/lib/crypto/index.js';

function parseArgs(argv) {
  const flags = new Set(argv);
  const batchArg = argv.find((a) => a.startsWith('--batch='));
  const batchSize = batchArg ? Number(batchArg.split('=')[1]) : 100;
  return {
    providers: flags.has('--providers'),
    settings: flags.has('--settings'),
    messages: flags.has('--messages'),
    batchSize: Number.isFinite(batchSize) && batchSize > 0 ? Math.floor(batchSize) : 100,
  };
}

function requireEncryptionConfigured() {
  if (!isKekConfigured()) {
    logger.error('❌ ENCRYPTION_MASTER_KEY must be set to run this migration');
    process.exit(1);
  }
}

function ensurePersistenceEnabled() {
  if (!config.persistence.enabled) {
    logger.error('❌ Persistence is not enabled. Set PERSIST_TRANSCRIPTS=true');
    process.exit(1);
  }
  if (!config.persistence.dbUrl) {
    logger.error('❌ Database URL not configured. Set DB_URL');
    process.exit(1);
  }
}

function migrateProviders(db, batchSize) {
  logger.info('🔐 Encrypting providers.api_key ...');

  let total = 0;
  let updated = 0;
  let lastRowId = 0;

  while (true) {
    const rows = db
      .prepare(
        `SELECT rowid as rowid, id, user_id, api_key
         FROM providers
         WHERE deleted_at IS NULL
           AND user_id IS NOT NULL
           AND api_key IS NOT NULL
           AND rowid > @lastRowId
         ORDER BY rowid ASC
         LIMIT @limit`
      )
      .all({ lastRowId, limit: batchSize });

    if (rows.length === 0) break;

    const tx = db.transaction((batch) => {
      for (const r of batch) {
        total++;
        lastRowId = r.rowid;
        if (!r.api_key || isEncrypted(r.api_key)) continue;
        const enc = encryptForUser(r.user_id, r.api_key);
        db.prepare(`UPDATE providers SET api_key=@apiKey, updated_at=@now WHERE id=@id AND user_id=@userId`).run({
          apiKey: enc,
          now: new Date().toISOString(),
          id: r.id,
          userId: r.user_id,
        });
        updated++;
      }
    });

    tx(rows);
  }

  logger.info(`✅ providers: scanned=${total}, encrypted=${updated}`);
}

function migrateSettings(db, batchSize) {
  logger.info('🔐 Encrypting user_settings.value for sensitive keys ...');

  const sensitive = ['tavily_api_key', 'exa_api_key', 'searxng_api_key'];

  let total = 0;
  let updated = 0;
  let lastRowId = 0;

  while (true) {
    const rows = db
      .prepare(
        `SELECT rowid as rowid, id, user_id, name, value
         FROM user_settings
         WHERE user_id IS NOT NULL
           AND value IS NOT NULL
           AND name IN (${sensitive.map(() => '?').join(',')})
           AND rowid > ?
         ORDER BY rowid ASC
         LIMIT ?`
      )
      .all(...sensitive, lastRowId, batchSize);

    if (rows.length === 0) break;

    const tx = db.transaction((batch) => {
      for (const r of batch) {
        total++;
        lastRowId = r.rowid;
        if (!r.value || isEncrypted(r.value)) continue;
        const enc = encryptForUser(r.user_id, r.value);
        db.prepare(`UPDATE user_settings SET value=?, updated_at=? WHERE id=?`).run(enc, new Date().toISOString(), r.id);
        updated++;
      }
    });

    tx(rows);
  }

  logger.info(`✅ user_settings: scanned=${total}, encrypted=${updated}`);
}

function migrateMessages(db, batchSize) {
  logger.info('🔐 Encrypting messages.content and messages.content_json ...');

  let total = 0;
  let updated = 0;
  let lastId = 0;

  while (true) {
    const rows = db
      .prepare(
        `SELECT m.id as id, m.conversation_id as conversation_id, m.content as content, m.content_json as content_json, c.user_id as user_id
         FROM messages m
         JOIN conversations c ON m.conversation_id = c.id
         WHERE c.deleted_at IS NULL
           AND c.user_id IS NOT NULL
           AND m.id > @lastId
         ORDER BY m.id ASC
         LIMIT @limit`
      )
      .all({ lastId, limit: batchSize });

    if (rows.length === 0) break;

    const tx = db.transaction((batch) => {
      for (const r of batch) {
        total++;
        lastId = r.id;

        const needsContent = r.content != null && !isEncrypted(r.content);
        const needsJson = r.content_json != null && !isEncrypted(r.content_json);
        if (!needsContent && !needsJson) continue;

        const newContent = needsContent ? encryptForUser(r.user_id, r.content ?? '') : r.content;
        const newJson = needsJson ? encryptForUser(r.user_id, r.content_json) : r.content_json;

        db.prepare(`UPDATE messages SET content=@content, content_json=@contentJson, updated_at=@now WHERE id=@id`).run({
          id: r.id,
          content: newContent,
          contentJson: newJson,
          now: new Date().toISOString(),
        });
        updated++;
      }
    });

    tx(rows);
  }

  logger.info(`✅ messages: scanned=${total}, encrypted=${updated}`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.providers && !args.settings && !args.messages) {
    logger.info(`
Usage:
  node scripts/migrate-encrypt-data.js --providers --settings [--messages] [--batch=100]

Notes:
  - Idempotent: skips already encrypted values (via $ENC$ prefix)
  - Requires ENCRYPTION_MASTER_KEY
`);
    process.exit(0);
  }

  ensurePersistenceEnabled();
  requireEncryptionConfigured();

  const db = getDb();

  try {
    if (args.providers) migrateProviders(db, args.batchSize);
    if (args.settings) migrateSettings(db, args.batchSize);
    if (args.messages) migrateMessages(db, args.batchSize);
  } finally {
    db.close();
  }
}

main();
