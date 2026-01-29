import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { runMigrations, migrations } from '../src/db/migrations.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readdir } from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function loadBaselineMigration() {
  const baselinePath = join(__dirname, '../src/db/migrations/baseline.js');
  const migration = await import(baselinePath);
  return migration.default;
}

function getSchema(db) {
  // Get all tables, indexes, and triggers
  // We exclude 'sqlite_sequence' as it's internal and depends on inserts
  // We also exclude 'migrations' table if it exists (created by the migration library)
  const schema = db
    .prepare(`
      SELECT name, type, sql
      FROM sqlite_master
      WHERE name NOT LIKE 'sqlite_%'
        AND name != 'migrations'
      ORDER BY name
    `)
    .all();

  // Normalize SQL: remove comments, extra whitespace, and quotes
  return schema.map(item => {
    let sql = item.sql;
    if (sql) {
      // Remove single-line comments
      sql = sql.replace(/--.*$/gm, '');
      // Remove multi-line comments
      sql = sql.replace(/\/\*[\s\S]*?\*\//g, '');
      // Normalize whitespace
      sql = sql.replace(/\s+/g, ' ').trim();
      // Remove quotes around names
      sql = sql.replace(/["`]([^"`\s]+)["`]/g, '$1');
      // Normalize spaces around commas and parentheses
      sql = sql.replace(/\s*,\s*/g, ', ');
      sql = sql.replace(/\s*\(\s*/g, ' (');
      sql = sql.replace(/\s*\)\s*/g, ') ');
      sql = sql.trim();
    }
    return {
      name: item.name,
      type: item.type,
      sql: sql
    };
  });
}

describe('Migration Baseline Consistency', () => {
  let dbIncremental;
  let dbBaseline;

  beforeEach(() => {
    dbIncremental = new Database(':memory:');
    dbBaseline = new Database(':memory:');
  });

  afterEach(() => {
    dbIncremental.close();
    dbBaseline.close();
  });

  test('baseline schema should match incremental migrations schema', async () => {
    // 1. Run incremental migrations on dbIncremental
    // To force incremental, we can just use the internal migrate library
    // but runMigrations also does it if we can bypass the baseline check.
    // Actually, we can just call the library directly.
    const { migrate } = await import('@blackglory/better-sqlite3-migrations');
    migrate(dbIncremental, migrations);

    // 2. Run baseline migration on dbBaseline
    const baselineMigration = await loadBaselineMigration();
    dbBaseline.exec(baselineMigration.up);
    // Set the version to match
    const latestVersion = migrations[migrations.length - 1].version;
    dbBaseline.pragma(`user_version = ${latestVersion}`);

    // 3. Compare schemas
    const schemaInc = getSchema(dbIncremental);
    const schemaBase = getSchema(dbBaseline);

    // Filter out items that are expected to be different (if any)
    // For example, some indexes might be named differently if not explicitly named?
    // But they should be named explicitly in both.

    // Check if they have the same number of items
    if (schemaInc.length !== schemaBase.length) {
      const incNames = schemaInc.map(i => i.name);
      const baseNames = schemaBase.map(i => i.name);

      const missingInBase = incNames.filter(n => !baseNames.includes(n));
      const missingInInc = baseNames.filter(n => !incNames.includes(n));

      const details = [];
      if (missingInBase.length > 0) details.push(`Missing in Baseline: ${missingInBase.join(', ')}`);
      if (missingInInc.length > 0) details.push(`Missing in Incremental: ${missingInInc.join(', ')}`);

      assert.fail(`Incremental (${schemaInc.length}) and Baseline (${schemaBase.length}) have different number of items.\n${details.join('\n')}`);
    }

    for (let i = 0; i < schemaInc.length; i++) {
      const inc = schemaInc[i];
      const base = schemaBase.find(b => b.name === inc.name);

      assert.ok(base, `Item ${inc.name} missing in baseline`);
      assert.equal(base.type, inc.type, `Type mismatch for ${inc.name}`);

      // Some SQL might differ in minor ways (case of keywords, etc.)
      // but they should be mostly identical if written similarly.
      // If this fails, we might need a more sophisticated SQL comparison.
      assert.equal(base.sql, inc.sql, `SQL mismatch for ${inc.name}`);
    }
  });
});
