import { describe, expect, test, beforeEach, afterEach, beforeAll } from '@jest/globals';
import { createUser, getUserByEmail, getUserById, isEmailAvailable, updateLastLogin, linkSessionToUser } from '../src/db/users.js';
import { getDb, resetDbCache } from '../src/db/index.js';
import bcrypt from 'bcryptjs';
import { safeTestSetup } from '../test_support/databaseSafety.js';

// Mock environment for testing
process.env.PERSIST_TRANSCRIPTS = 'true';
process.env.DB_URL = 'file::memory:';

beforeAll(() => {
  // Safety check: ensure we're using a test database
  safeTestSetup();
});

describe('User Database Operations', () => {
  let db;

  beforeEach(() => {
    resetDbCache();
    db = getDb();
    db.exec(`
      DELETE FROM sessions;
      DELETE FROM users;
    `);
  });

  afterEach(() => {
    if (db) {
      db.close();
    }
  });

  test('should create a new user', async () => {
    const userData = {
      email: 'test@example.com',
      passwordHash: await bcrypt.hash('password123', 12),
      displayName: 'Test User'
    };

    const user = createUser(userData);

    expect(user).toBeDefined();
    expect(user.id).toBeDefined();
    expect(user.email).toBe('test@example.com');
    expect(user.display_name).toBe('Test User');
  expect(user.email_verified).toBe(0);
    expect(user.password_hash).toBeUndefined(); // Should not return password hash
  });

  test('should find user by email', async () => {
    // Create a user first
    const passwordHash = await bcrypt.hash('password123', 12);
    const createdUser = createUser({
      email: 'findme@example.com',
      passwordHash,
      displayName: 'Find Me'
    });

    const foundUser = getUserByEmail('findme@example.com');

    expect(foundUser).toBeDefined();
    expect(foundUser.id).toBe(createdUser.id);
    expect(foundUser.email).toBe('findme@example.com');
    expect(foundUser.password_hash).toBeDefined(); // This method returns password for auth
  });

  test('should find user by ID', async () => {
    // Create a user first
    const passwordHash = await bcrypt.hash('password123', 12);
    const createdUser = createUser({
      email: 'findbyid@example.com',
      passwordHash,
      displayName: 'Find By ID'
    });

    const foundUser = getUserById(createdUser.id);

    expect(foundUser).toBeDefined();
    expect(foundUser.id).toBe(createdUser.id);
    expect(foundUser.email).toBe('findbyid@example.com');
    expect(foundUser.password_hash).toBeUndefined(); // This method doesn't return password
  });

  test('should check email availability', async () => {
    expect(isEmailAvailable('available@example.com')).toBe(true);

    // Create a user
    const passwordHash = await bcrypt.hash('password123', 12);
    createUser({
      email: 'taken@example.com',
      passwordHash,
      displayName: 'Taken User'
    });

    expect(isEmailAvailable('taken@example.com')).toBe(false);
    expect(isEmailAvailable('still.available@example.com')).toBe(true);
  });

  test('should update last login', async () => {
    // Create a user first
    const passwordHash = await bcrypt.hash('password123', 12);
    const createdUser = createUser({
      email: 'login@example.com',
      passwordHash,
      displayName: 'Login User'
    });

    expect(createdUser.last_login_at).toBeNull();

    updateLastLogin(createdUser.id);

    const updatedUser = getUserById(createdUser.id);
    expect(updatedUser.last_login_at).toBeDefined();
    expect(new Date(updatedUser.last_login_at)).toBeInstanceOf(Date);
  });

  test('should link session to user', async () => {
    // Create a user first
    const passwordHash = await bcrypt.hash('password123', 12);
    const createdUser = createUser({
      email: 'session@example.com',
      passwordHash,
      displayName: 'Session User'
    });

    const sessionId = 'test-session-id';

    // First create a session
    db.prepare(`
      INSERT INTO sessions (id, user_id, created_at, last_seen_at)
      VALUES (?, NULL, datetime('now'), datetime('now'))
    `).run(sessionId);

    linkSessionToUser(sessionId, createdUser.id);

    const session = db.prepare(`
      SELECT * FROM sessions WHERE id = ?
    `).get(sessionId);

    expect(session.user_id).toBe(createdUser.id);
  });

  test('should return null for non-existent user', () => {
    expect(getUserById('non-existent-id')).toBeNull();
    expect(getUserByEmail('nonexistent@example.com')).toBeNull();
  });
});