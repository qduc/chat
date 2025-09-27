import { getDb } from '../db/client.js';

/**
 * Migrate conversations from session-based to user-based ownership
 * This allows authenticated users to claim their anonymous conversations
 *
 * @param {string} sessionId - The session ID to migrate from
 * @param {string} userId - The user ID to migrate to
 * @returns {number} Number of conversations migrated
 */
export function migrateSessionConversationsToUser(sessionId, userId) {
  const db = getDb();
  const now = new Date().toISOString();

  // Migrate conversations that belong to the session and have no user_id
  const result = db.prepare(`
    UPDATE conversations
    SET user_id = @userId, updated_at = @now
    WHERE session_id = @sessionId
      AND user_id IS NULL
      AND deleted_at IS NULL
  `).run({ sessionId, userId, now });

  return result.changes || 0;
}

/**
 * Get count of anonymous conversations that can be migrated for a session
 *
 * @param {string} sessionId - The session ID to check
 * @returns {number} Number of conversations that can be migrated
 */
export function countMigratableConversations(sessionId) {
  const db = getDb();

  const result = db.prepare(`
    SELECT COUNT(*) as count
    FROM conversations
    WHERE session_id = @sessionId
      AND user_id IS NULL
      AND deleted_at IS NULL
  `).get({ sessionId });

  return result?.count || 0;
}

/**
 * Check if a user already has conversations
 *
 * @param {string} userId - The user ID to check
 * @returns {boolean} True if user has existing conversations
 */
export function userHasConversations(userId) {
  const db = getDb();

  const result = db.prepare(`
    SELECT COUNT(*) as count
    FROM conversations
    WHERE user_id = @userId
      AND deleted_at IS NULL
    LIMIT 1
  `).get({ userId });

  return (result?.count || 0) > 0;
}