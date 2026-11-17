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

/**
 * One page of a user's journal entries, newest first, with a `hasMore` flag.
 * @param {string} userId
 * @param {number} page - 1-based page number
 * @param {number} pageSize
 * @returns {{ entries: Array<{id: number, model_name: string, content: string, created_at: string}>, hasMore: boolean }}
 */
export function listJournalEntriesPage(userId, page = 1, pageSize = 20) {
  if (!userId) throw new Error('userId is required');
  const db = getDb();
  const offset = (Math.max(1, page) - 1) * pageSize;

  // Fetch one extra row to learn whether another page exists.
  const rows = db
    .prepare(
      `SELECT id, model_name, content, created_at
       FROM journal
       WHERE user_id = @userId
       ORDER BY created_at DESC, id DESC
       LIMIT @limit OFFSET @offset`
    )
    .all({ userId, limit: pageSize + 1, offset });

  return { entries: rows.slice(0, pageSize), hasMore: rows.length > pageSize };
}

/**
 * Delete one journal entry owned by the user.
 * @param {string} userId
 * @param {number} id
 * @returns {boolean} true when an entry was deleted
 */
export function deleteJournalEntry(userId, id) {
  if (!userId) throw new Error('userId is required');
  const db = getDb();
  const info = db
    .prepare(`DELETE FROM journal WHERE id = @id AND user_id = @userId`)
    .run({ id, userId });
  return info.changes > 0;
}
