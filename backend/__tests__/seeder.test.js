import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/db/migrations.js';
import { runSeeders } from '../src/db/seeders/index.js';

describe('Seeder Idempotency', () => {
  let db;

  beforeEach(() => {
    // Create in-memory database for testing
    db = new Database(':memory:');
    runMigrations(db);
  });

  afterEach(() => {
    if (db) {
      db.close();
    }
  });

  test('OpenAI provider seeder is idempotent', () => {
    // First run - should create the provider
    runSeeders(db);

    const providers = db.prepare("SELECT * FROM providers WHERE deleted_at IS NULL").all();
    expect(providers).toHaveLength(1);
    expect(providers[0].id).toBe('openai');
    expect(providers[0].name).toBe('OpenAI');
    expect(providers[0].provider_type).toBe('openai');
    expect(providers[0].is_default).toBe(1);
    expect(providers[0].enabled).toBe(1);

    // Second run - should not create duplicate
    runSeeders(db);

    const providersAfterSecondRun = db.prepare("SELECT * FROM providers WHERE deleted_at IS NULL").all();
    expect(providersAfterSecondRun).toHaveLength(1);
    expect(providersAfterSecondRun[0].id).toBe('openai');

    // Third run - should still not create duplicate
    runSeeders(db);

    const providersAfterThirdRun = db.prepare("SELECT * FROM providers WHERE deleted_at IS NULL").all();
    expect(providersAfterThirdRun).toHaveLength(1);
    expect(providersAfterThirdRun[0].id).toBe('openai');
  });

  test('Seeder sets provider as default correctly', () => {
    runSeeders(db);

    const defaultProviders = db.prepare("SELECT * FROM providers WHERE is_default = 1 AND deleted_at IS NULL").all();
    expect(defaultProviders).toHaveLength(1);
    expect(defaultProviders[0].id).toBe('openai');
  });

  test('Seeder handles database errors gracefully', () => {
    // Close the database to simulate an error
    db.close();

    // Should not throw an error
    expect(() => {
      runSeeders(db);
    }).not.toThrow();
  });
});