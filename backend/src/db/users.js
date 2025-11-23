import { getDb } from './client.js';
import { randomUUID } from 'crypto';
import { createDefaultProviders } from './providers.js';
import { upsertSession } from './sessions.js';
import { logger } from '../logger.js';

/**
 * Create a new user
 * @param {Object} userData - User data
 * @param {string} userData.email - User email
 * @param {string} userData.passwordHash - Hashed password
 * @param {string} [userData.displayName] - Display name
 * @returns {Object} Created user (without password)
 */
export function createUser({ email, passwordHash, displayName }) {
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();

  const user = {
    id,
    email,
    password_hash: passwordHash,
    display_name: displayName || null,
    created_at: now,
    updated_at: now,
    email_verified: 0, // SQLite boolean as integer
    last_login_at: null,
    deleted_at: null
  };

  db.prepare(`
    INSERT INTO users (id, email, password_hash, display_name, created_at, updated_at, email_verified, last_login_at, deleted_at)
    VALUES (@id, @email, @password_hash, @display_name, @created_at, @updated_at, @email_verified, @last_login_at, @deleted_at)
  `).run(user);

  // Create default providers for the new user
  try {
    createDefaultProviders(id);
  } catch (error) {
    logger.warn(
      {
        err: error,
        userId: id,
        email,
      },
      '[users#createUser] Failed to create default providers'
    );
    // Don't fail user creation if provider creation fails
  }

  // Return user without password hash
  // eslint-disable-next-line no-unused-vars
  const { password_hash, ...userWithoutPassword } = user;
  return userWithoutPassword;
}

/**
 * Find user by email
 * @param {string} email - User email
 * @returns {Object|null} User data (without password) or null if not found
 */
export function getUserByEmail(email) {
  const db = getDb();
  const user = db.prepare(`
    SELECT id, email, password_hash, display_name, created_at, updated_at,
           email_verified, last_login_at, deleted_at
    FROM users
    WHERE email = ? AND deleted_at IS NULL
  `).get(email);

  return user || null;
}

/**
 * Find user by ID
 * @param {string} id - User ID
 * @returns {Object|null} User data (without password) or null if not found
 */
export function getUserById(id) {
  const db = getDb();
  const user = db.prepare(`
    SELECT id, email, display_name, created_at, updated_at,
           email_verified, last_login_at, deleted_at
    FROM users
    WHERE id = ? AND deleted_at IS NULL
  `).get(id);

  return user || null;
}

/**
 * Update user's last login time
 * @param {string} id - User ID
 */
export function updateLastLogin(id) {
  const db = getDb();
  const now = new Date().toISOString();

  db.prepare(`
    UPDATE users
    SET last_login_at = ?, updated_at = ?
    WHERE id = ?
  `).run(now, now, id);
}

/**
 * Update user profile
 * @param {string} id - User ID
 * @param {Object} updates - Fields to update
 * @param {string} [updates.displayName] - New display name
 * @param {string} [updates.email] - New email
 * @returns {Object|null} Updated user data or null if not found
 */
export function updateUser(id, updates) {
  const db = getDb();
  const now = new Date().toISOString();

  const validFields = ['display_name', 'email'];
  const updateFields = [];
  const values = [];

  for (const [key, value] of Object.entries(updates)) {
    const dbField = key === 'displayName' ? 'display_name' : key;
    if (validFields.includes(dbField)) {
      updateFields.push(`${dbField} = ?`);
      values.push(value);
    }
  }

  if (updateFields.length === 0) {
    return getUserById(id);
  }

  updateFields.push('updated_at = ?');
  values.push(now, id);

  const stmt = db.prepare(`
    UPDATE users
    SET ${updateFields.join(', ')}
    WHERE id = ? AND deleted_at IS NULL
  `);

  const result = stmt.run(...values);

  return result.changes > 0 ? getUserById(id) : null;
}

/**
 * Link a session to a user
 * @param {string} sessionId - Session ID
 * @param {string} userId - User ID
 */
export function linkSessionToUser(sessionId, userId, meta = {}) {
  if (!sessionId || !userId) return;

  // Ensure database connection is initialized before delegating.
  getDb();
  upsertSession(sessionId, { userId, ...meta });
}

/**
 * Get user sessions
 * @param {string} userId - User ID
 * @returns {Array} Array of session data
 */
export function getUserSessions(userId) {
  const db = getDb();

  return db.prepare(`
    SELECT id, created_at, last_seen_at, user_agent, ip_hash
    FROM sessions
    WHERE user_id = ?
    ORDER BY last_seen_at DESC
  `).all(userId);
}

/**
 * Check if email is available
 * @param {string} email - Email to check
 * @returns {boolean} True if email is available
 */
export function isEmailAvailable(email) {
  const db = getDb();
  const count = db.prepare(`
    SELECT COUNT(*) as count
    FROM users
    WHERE email = ? AND deleted_at IS NULL
  `).get(email);

  return count.count === 0;
}
