import { getDb } from './client.js';

/**
 * Create or update a session row.
 * Requires a user id now that sessions.user_id is NOT NULL.
 * If no user id is provided we skip the write entirely.
 */
export function upsertSession(sessionId, meta = {}) {
  const userId = meta.userId;
  if (!sessionId || !userId) return;

  const db = getDb();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO sessions (id, user_id, created_at, last_seen_at, user_agent, ip_hash)
     VALUES (@id, @userId, @now, @now, @ua, @ip)
     ON CONFLICT(id) DO UPDATE SET
       user_id = excluded.user_id,
       last_seen_at = excluded.last_seen_at,
       user_agent = excluded.user_agent,
       ip_hash = excluded.ip_hash`
  ).run({
    id: sessionId,
    userId,
    now,
    ua: meta.userAgent || null,
    ip: meta.ipHash || null,
  });
}
