import { describe, expect, test, beforeEach, afterAll, beforeAll } from '@jest/globals';
import {
  createUser,
  getUserByEmail,
  getUserById,
  isEmailAvailable,
  updateLastLogin,
  linkSessionToUser,
  getUserMaxToolIterations,
  updateUserMaxToolIterations,
  updateUser,
  getUserSessions
} from '../src/db/users.js';
import { getDb, resetDbCache } from '../src/db/index.js';
import bcrypt from 'bcryptjs';
import { safeTestSetup } from '../test_support/databaseSafety.js';
import { config } from '../src/env.js';

// Use a very low bcrypt cost in tests to keep them fast. Production code should
// still use a higher cost (configured elsewhere).
const TEST_BCRYPT_ROUNDS = 1;

beforeAll(() => {
  // Safety check: ensure we're using a test database and initialize it once for
  // the whole test suite. Creating the DB snapshot/migrations is relatively
  // expensive, so we warm it up here and reuse the snapshot for each test.
  safeTestSetup();

  // Ensure persistence is enabled and points to in-memory DB
  config.persistence.enabled = true;
  config.persistence.dbUrl = 'file::memory:';

  // Reset any previous DB handles and open the DB once. getDb() will create
  // the snapshot/migrations on first invocation which is faster than doing it
  // before every test.
  resetDbCache();
  getDb();
});

afterAll(() => {
  resetDbCache();
});

describe('User Database Operations', () => {
  beforeEach(() => {
    // Clear just the tables we modify rather than recreating the DB each time.
    const db = getDb();
    db.exec('DELETE FROM sessions; DELETE FROM users;');
  });

  test('should create a new user', async () => {
    const userData = {
      email: 'test@example.com',
    passwordHash: await bcrypt.hash('password123', TEST_BCRYPT_ROUNDS),
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
  const passwordHash = await bcrypt.hash('password123', TEST_BCRYPT_ROUNDS);
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
  const passwordHash = await bcrypt.hash('password123', TEST_BCRYPT_ROUNDS);
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
  const passwordHash = await bcrypt.hash('password123', TEST_BCRYPT_ROUNDS);
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
  const passwordHash = await bcrypt.hash('password123', TEST_BCRYPT_ROUNDS);
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
    const passwordHash = await bcrypt.hash('password123', TEST_BCRYPT_ROUNDS);
    const createdUser = createUser({
      email: 'session@example.com',
      passwordHash,
      displayName: 'Session User'
    });

    const sessionId = 'test-session-id';

    const db = getDb();
    linkSessionToUser(sessionId, createdUser.id, { userAgent: 'jest-test' });

    const session = db.prepare(`
      SELECT * FROM sessions WHERE id = ?
    `).get(sessionId);

    expect(session.user_id).toBe(createdUser.id);
  });

  test('should return null for non-existent user', () => {
    expect(getUserById('non-existent-id')).toBeNull();
    expect(getUserByEmail('nonexistent@example.com')).toBeNull();
  });

  test('should create user without display name', async () => {
    const passwordHash = await bcrypt.hash('password123', TEST_BCRYPT_ROUNDS);
    const user = createUser({
      email: 'nodisplay@example.com',
      passwordHash
    });

    expect(user).toBeDefined();
    expect(user.email).toBe('nodisplay@example.com');
    expect(user.display_name).toBeNull();
  });

  test('should not return password hash when creating user', async () => {
    const passwordHash = await bcrypt.hash('secretpass', TEST_BCRYPT_ROUNDS);
    const user = createUser({
      email: 'secure@example.com',
      passwordHash
    });

    expect(user.password_hash).toBeUndefined();

    // But getUserByEmail should return it for authentication
    const userWithPassword = getUserByEmail('secure@example.com');
    expect(userWithPassword.password_hash).toBeDefined();
  });

  test('should enforce unique email constraint', async () => {
    const passwordHash = await bcrypt.hash('password123', TEST_BCRYPT_ROUNDS);

    createUser({
      email: 'duplicate@example.com',
      passwordHash,
      displayName: 'First User'
    });

    // Attempting to create another user with same email should throw
    expect(() => {
      createUser({
        email: 'duplicate@example.com',
        passwordHash,
        displayName: 'Second User'
      });
    }).toThrow();
  });

  test('should verify password correctly with bcrypt', async () => {
    const plainPassword = 'mySecurePassword123';
    const passwordHash = await bcrypt.hash(plainPassword, TEST_BCRYPT_ROUNDS);

    const user = createUser({
      email: 'bcrypttest@example.com',
      passwordHash
    });

    const foundUser = getUserByEmail('bcrypttest@example.com');

    // Verify the password hash can be compared
    const isValid = await bcrypt.compare(plainPassword, foundUser.password_hash);
    expect(isValid).toBe(true);

    // Verify wrong password fails
    const isInvalid = await bcrypt.compare('wrongPassword', foundUser.password_hash);
    expect(isInvalid).toBe(false);
  });

  test('should not find soft-deleted users', async () => {
    const passwordHash = await bcrypt.hash('password123', TEST_BCRYPT_ROUNDS);
    const user = createUser({
      email: 'deleteme@example.com',
      passwordHash
    });

    // Soft delete the user
    const db = getDb();
    db.prepare('UPDATE users SET deleted_at = ? WHERE id = ?')
      .run(new Date().toISOString(), user.id);

    // Should not be found
    expect(getUserById(user.id)).toBeNull();
    expect(getUserByEmail('deleteme@example.com')).toBeNull();

    // Email should be available again
    expect(isEmailAvailable('deleteme@example.com')).toBe(true);
  });

  describe('updateUser', () => {
    test('should update user display name', async () => {
      const passwordHash = await bcrypt.hash('password123', TEST_BCRYPT_ROUNDS);
      const user = createUser({
        email: 'updatetest@example.com',
        passwordHash,
        displayName: 'Original Name'
      });

      const updated = updateUser(user.id, { displayName: 'Updated Name' });

      expect(updated).toBeDefined();
      expect(updated.display_name).toBe('Updated Name');
      expect(updated.email).toBe('updatetest@example.com');
    });

    test('should update user email', async () => {
      const passwordHash = await bcrypt.hash('password123', TEST_BCRYPT_ROUNDS);
      const user = createUser({
        email: 'oldemail@example.com',
        passwordHash
      });

      const updated = updateUser(user.id, { email: 'newemail@example.com' });

      expect(updated).toBeDefined();
      expect(updated.email).toBe('newemail@example.com');
    });

    test('should update multiple fields at once', async () => {
      const passwordHash = await bcrypt.hash('password123', TEST_BCRYPT_ROUNDS);
      const user = createUser({
        email: 'multi@example.com',
        passwordHash,
        displayName: 'Old Name'
      });

      const updated = updateUser(user.id, {
        displayName: 'New Name',
        email: 'newmulti@example.com'
      });

      expect(updated.display_name).toBe('New Name');
      expect(updated.email).toBe('newmulti@example.com');
    });

    test('should ignore invalid fields', async () => {
      const passwordHash = await bcrypt.hash('password123', TEST_BCRYPT_ROUNDS);
      const user = createUser({
        email: 'invalidfields@example.com',
        passwordHash,
        displayName: 'Test User'
      });

      const updated = updateUser(user.id, {
        displayName: 'Updated',
        invalidField: 'should be ignored',
        anotherBad: 'also ignored'
      });

      expect(updated.display_name).toBe('Updated');
      expect(updated.invalidField).toBeUndefined();
    });

    test('should return null when updating non-existent user', () => {
      const updated = updateUser('non-existent-id', { displayName: 'Ghost' });
      expect(updated).toBeNull();
    });

    test('should return user unchanged if no valid fields provided', async () => {
      const passwordHash = await bcrypt.hash('password123', TEST_BCRYPT_ROUNDS);
      const user = createUser({
        email: 'nochange@example.com',
        passwordHash,
        displayName: 'Original'
      });

      const updated = updateUser(user.id, { invalidField: 'value' });

      expect(updated).toBeDefined();
      expect(updated.display_name).toBe('Original');
    });

    test('should not update soft-deleted users', async () => {
      const passwordHash = await bcrypt.hash('password123', TEST_BCRYPT_ROUNDS);
      const user = createUser({
        email: 'softdeleted@example.com',
        passwordHash
      });

      // Soft delete
      const db = getDb();
      db.prepare('UPDATE users SET deleted_at = ? WHERE id = ?')
        .run(new Date().toISOString(), user.id);

      const updated = updateUser(user.id, { displayName: 'Should Not Update' });
      expect(updated).toBeNull();
    });
  });

  describe('getUserMaxToolIterations', () => {
    test('should return default value of 10 for new users', async () => {
      const passwordHash = await bcrypt.hash('password123', TEST_BCRYPT_ROUNDS);
      const user = createUser({
        email: 'iterations@example.com',
        passwordHash
      });

      const maxIterations = getUserMaxToolIterations(user.id);
      expect(maxIterations).toBe(10);
    });

    test('should return 10 for non-existent user', () => {
      const maxIterations = getUserMaxToolIterations('non-existent-id');
      expect(maxIterations).toBe(10);
    });

    test('should return custom value if set', async () => {
      const passwordHash = await bcrypt.hash('password123', TEST_BCRYPT_ROUNDS);
      const user = createUser({
        email: 'custom@example.com',
        passwordHash
      });

      // Set custom value
      const db = getDb();
      db.prepare('UPDATE users SET max_tool_iterations = ? WHERE id = ?')
        .run(20, user.id);

      const maxIterations = getUserMaxToolIterations(user.id);
      expect(maxIterations).toBe(20);
    });

    test('should not return value for soft-deleted users', async () => {
      const passwordHash = await bcrypt.hash('password123', TEST_BCRYPT_ROUNDS);
      const user = createUser({
        email: 'deletediter@example.com',
        passwordHash
      });

      // Soft delete
      const db = getDb();
      db.prepare('UPDATE users SET deleted_at = ? WHERE id = ?')
        .run(new Date().toISOString(), user.id);

      const maxIterations = getUserMaxToolIterations(user.id);
      expect(maxIterations).toBe(10); // Returns default
    });
  });

  describe('updateUserMaxToolIterations', () => {
    test('should update max tool iterations', async () => {
      const passwordHash = await bcrypt.hash('password123', TEST_BCRYPT_ROUNDS);
      const user = createUser({
        email: 'updateiter@example.com',
        passwordHash
      });

      const result = updateUserMaxToolIterations(user.id, 25);
      expect(result).toBe(true);

      const maxIterations = getUserMaxToolIterations(user.id);
      expect(maxIterations).toBe(25);
    });

    test('should clamp value to minimum of 1', async () => {
      const passwordHash = await bcrypt.hash('password123', TEST_BCRYPT_ROUNDS);
      const user = createUser({
        email: 'miniter@example.com',
        passwordHash
      });

      updateUserMaxToolIterations(user.id, 0);
      expect(getUserMaxToolIterations(user.id)).toBe(1);

      updateUserMaxToolIterations(user.id, -5);
      expect(getUserMaxToolIterations(user.id)).toBe(1);
    });

    test('should clamp value to maximum of 50', async () => {
      const passwordHash = await bcrypt.hash('password123', TEST_BCRYPT_ROUNDS);
      const user = createUser({
        email: 'maxiter@example.com',
        passwordHash
      });

      updateUserMaxToolIterations(user.id, 100);
      expect(getUserMaxToolIterations(user.id)).toBe(50);

      updateUserMaxToolIterations(user.id, 1000);
      expect(getUserMaxToolIterations(user.id)).toBe(50);
    });

    test('should floor decimal values', async () => {
      const passwordHash = await bcrypt.hash('password123', TEST_BCRYPT_ROUNDS);
      const user = createUser({
        email: 'decimaliter@example.com',
        passwordHash
      });

      updateUserMaxToolIterations(user.id, 15.7);
      expect(getUserMaxToolIterations(user.id)).toBe(15);

      updateUserMaxToolIterations(user.id, 20.1);
      expect(getUserMaxToolIterations(user.id)).toBe(20);
    });

    test('should return false for non-existent user', () => {
      const result = updateUserMaxToolIterations('non-existent-id', 20);
      expect(result).toBe(false);
    });

    test('should not update soft-deleted users', async () => {
      const passwordHash = await bcrypt.hash('password123', TEST_BCRYPT_ROUNDS);
      const user = createUser({
        email: 'deletedupdate@example.com',
        passwordHash
      });

      // Soft delete
      const db = getDb();
      db.prepare('UPDATE users SET deleted_at = ? WHERE id = ?')
        .run(new Date().toISOString(), user.id);

      const result = updateUserMaxToolIterations(user.id, 30);
      expect(result).toBe(false);
    });
  });

  describe('getUserSessions', () => {
    test('should return empty array for user with no sessions', async () => {
      const passwordHash = await bcrypt.hash('password123', TEST_BCRYPT_ROUNDS);
      const user = createUser({
        email: 'nosessions@example.com',
        passwordHash
      });

      const sessions = getUserSessions(user.id);
      expect(sessions).toEqual([]);
    });

    test('should return user sessions ordered by last_seen_at', async () => {
      const passwordHash = await bcrypt.hash('password123', TEST_BCRYPT_ROUNDS);
      const user = createUser({
        email: 'multisessions@example.com',
        passwordHash
      });

      // Create multiple sessions
      linkSessionToUser('session1', user.id, { userAgent: 'browser1' });
      linkSessionToUser('session2', user.id, { userAgent: 'browser2' });
      linkSessionToUser('session3', user.id, { userAgent: 'browser3' });

      const sessions = getUserSessions(user.id);
      expect(sessions.length).toBe(3);
      expect(sessions[0].id).toBeDefined();
      expect(sessions[0].user_agent).toBeDefined();

      // Verify ordering by last_seen_at (most recent first)
      for (let i = 0; i < sessions.length - 1; i++) {
        const current = new Date(sessions[i].last_seen_at);
        const next = new Date(sessions[i + 1].last_seen_at);
        expect(current >= next).toBe(true);
      }
    });

    test('should only return sessions for specified user', async () => {
      const passwordHash = await bcrypt.hash('password123', TEST_BCRYPT_ROUNDS);
      const user1 = createUser({
        email: 'user1@example.com',
        passwordHash
      });
      const user2 = createUser({
        email: 'user2@example.com',
        passwordHash
      });

      linkSessionToUser('user1-session', user1.id);
      linkSessionToUser('user2-session', user2.id);

      const user1Sessions = getUserSessions(user1.id);
      const user2Sessions = getUserSessions(user2.id);

      expect(user1Sessions.length).toBe(1);
      expect(user2Sessions.length).toBe(1);
      expect(user1Sessions[0].id).toBe('user1-session');
      expect(user2Sessions[0].id).toBe('user2-session');
    });
  });

  describe('linkSessionToUser', () => {
    test('should handle null sessionId gracefully', async () => {
      const passwordHash = await bcrypt.hash('password123', TEST_BCRYPT_ROUNDS);
      const user = createUser({
        email: 'nullsession@example.com',
        passwordHash
      });

      // Should not throw
      expect(() => {
        linkSessionToUser(null, user.id);
      }).not.toThrow();

      const sessions = getUserSessions(user.id);
      expect(sessions.length).toBe(0);
    });

    test('should handle null userId gracefully', () => {
      // Should not throw
      expect(() => {
        linkSessionToUser('session-id', null);
      }).not.toThrow();
    });

    test('should handle both null values gracefully', () => {
      // Should not throw
      expect(() => {
        linkSessionToUser(null, null);
      }).not.toThrow();
    });

    test('should store metadata with session', async () => {
      const passwordHash = await bcrypt.hash('password123', TEST_BCRYPT_ROUNDS);
      const user = createUser({
        email: 'metadata@example.com',
        passwordHash
      });

      linkSessionToUser('meta-session', user.id, {
        userAgent: 'Mozilla/5.0',
        ipHash: 'hashed-ip'
      });

      const db = getDb();
      const session = db.prepare('SELECT * FROM sessions WHERE id = ?')
        .get('meta-session');

      expect(session.user_id).toBe(user.id);
      expect(session.user_agent).toBe('Mozilla/5.0');
      expect(session.ip_hash).toBe('hashed-ip');
    });
  });

  describe('Email validation and edge cases', () => {
    test('should handle empty string email check', () => {
      expect(isEmailAvailable('')).toBe(true);
    });

    test('should be case-sensitive for emails', async () => {
      const passwordHash = await bcrypt.hash('password123', TEST_BCRYPT_ROUNDS);
      createUser({
        email: 'Case@Example.com',
        passwordHash
      });

      // SQLite is case-sensitive by default for strings
      expect(isEmailAvailable('case@example.com')).toBe(true);
      expect(isEmailAvailable('Case@Example.com')).toBe(false);
    });
  });

  describe('Password security', () => {
    test('should never store plaintext passwords', async () => {
      const plainPassword = 'myPlaintextPassword';
      const passwordHash = await bcrypt.hash(plainPassword, TEST_BCRYPT_ROUNDS);

      const user = createUser({
        email: 'security@example.com',
        passwordHash
      });

      // Get user from database
      const db = getDb();
      const dbUser = db.prepare('SELECT password_hash FROM users WHERE id = ?')
        .get(user.id);

      // Password hash should not equal plaintext
      expect(dbUser.password_hash).not.toBe(plainPassword);

      // Should start with bcrypt identifier
      expect(dbUser.password_hash).toMatch(/^\$2[aby]\$/);
    });

    test('should use bcrypt for password hashing', async () => {
      const password = 'testPassword123';
      const hash = await bcrypt.hash(password, TEST_BCRYPT_ROUNDS);

      createUser({
        email: 'bcrypt@example.com',
        passwordHash: hash
      });

      const user = getUserByEmail('bcrypt@example.com');

      // Verify bcrypt can validate the hash
      const isValid = await bcrypt.compare(password, user.password_hash);
      expect(isValid).toBe(true);
    });

    test('should create different hashes for same password', async () => {
      const password = 'samePassword';
      const hash1 = await bcrypt.hash(password, TEST_BCRYPT_ROUNDS);
      const hash2 = await bcrypt.hash(password, TEST_BCRYPT_ROUNDS);

      // Hashes should be different due to salt
      expect(hash1).not.toBe(hash2);

      // But both should validate correctly
      expect(await bcrypt.compare(password, hash1)).toBe(true);
      expect(await bcrypt.compare(password, hash2)).toBe(true);
    });
  });
});
