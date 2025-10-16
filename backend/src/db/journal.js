import { getDb } from './client.js';

/**
 * Insert a journal entry for a user
 * @param {Object} params
 * @param {string} params.userId
 * @param {string} params.modelName
 * @param {string} params.content
 * @returns {Object} Inserted entry
 */
export function insertJournalEntry({ userId, modelName, content }) {
  const db = getDb();
  const now = new Date().toISOString();

  const info = db.prepare(
    `INSERT INTO journal (user_id, model_name, content, created_at) VALUES (@userId, @modelName, @content, @now)`
  ).run({ userId, modelName, content, now });

  return { id: info.lastInsertRowid, userId, modelName, content, created_at: now };
}

/**
 * List journal entries for a user, paginated by page (1-based) and pageSize
 * Returns most recent entries first
 * @param {string} userId
 * @param {number} page
 * @param {number} pageSize
 */
export function listJournalEntries(userId, page = 1, pageSize = 10) {
  const db = getDb();
  const offset = (Math.max(1, page) - 1) * pageSize;

  const rows = db
    .prepare(
      `SELECT id, user_id, model_name, content, created_at
       FROM journal
       WHERE user_id = @userId
       ORDER BY created_at DESC
       LIMIT @pageSize OFFSET @offset`
    )
    .all({ userId, pageSize, offset });

  return rows;
}
