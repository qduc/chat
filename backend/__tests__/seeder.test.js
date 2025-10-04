import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/db/migrations.js';
import { runSeeders } from '../src/db/seeders/index.js';
import { v4 as uuidv4 } from 'uuid';

describe('Seeder Idempotency', () => {
  let db;
  let testUser;

  beforeEach(() => {
    // Create in-memory database for testing
    db = new Database(':memory:');
    runMigrations(db);
    // Create a test user manually for seeding
    const userId = uuidv4();
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO users (id, email, password_hash, display_name, created_at, updated_at, email_verified, last_login_at, deleted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(userId, 'seeder@test.com', 'hash', 'Seeder Test User', now, now, 1, null, null);
    testUser = { id: userId, email: 'seeder@test.com', displayName: 'Seeder Test User' };
  });

  afterEach(() => {
    if (db) {
      db.close();
    }
  });

  test('OpenAI provider seeder is idempotent', () => {
    // First run - should create the provider
    runSeeders(db, { userId: testUser.id });

    const providers = db.prepare("SELECT * FROM providers WHERE deleted_at IS NULL").all();
    expect(providers).toHaveLength(1);
    expect(providers[0].id).toBe(`${testUser.id}-openai`);
    expect(providers[0].name).toBe('OpenAI');
    expect(providers[0].provider_type).toBe('openai');
    expect(providers[0].is_default).toBe(1);
    expect(providers[0].enabled).toBe(1);
    expect(providers[0].user_id).toBe(testUser.id);

    // Second run - should not create duplicate
    runSeeders(db, { userId: testUser.id });

    const providersAfterSecondRun = db.prepare("SELECT * FROM providers WHERE deleted_at IS NULL").all();
    expect(providersAfterSecondRun).toHaveLength(1);
    expect(providersAfterSecondRun[0].id).toBe(`${testUser.id}-openai`);

    // Third run - should still not create duplicate
    runSeeders(db, { userId: testUser.id });

    const providersAfterThirdRun = db.prepare("SELECT * FROM providers WHERE deleted_at IS NULL").all();
    expect(providersAfterThirdRun).toHaveLength(1);
    expect(providersAfterThirdRun[0].id).toBe(`${testUser.id}-openai`);
  });

  test('Seeder sets provider as default correctly', () => {
    runSeeders(db, { userId: testUser.id });

    const defaultProviders = db.prepare("SELECT * FROM providers WHERE is_default = 1 AND deleted_at IS NULL").all();
    expect(defaultProviders).toHaveLength(1);
    expect(defaultProviders[0].id).toBe(`${testUser.id}-openai`);
  });

  test('Seeder handles database errors gracefully', () => {
    // Close the database to simulate an error
    db.close();

    // Should not throw an error
    expect(() => {
      runSeeders(db, { userId: testUser.id });
    }).not.toThrow();
  });
});