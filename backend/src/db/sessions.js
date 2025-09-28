import { getDb } from './client.js';

export function upsertSession(sessionId, meta = {}) {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO sessions (id, user_id, created_at, last_seen_at, user_agent, ip_hash)
     VALUES (@id, NULL, @now, @now, @ua, @ip)
     ON CONFLICT(id) DO UPDATE SET last_seen_at=@now`
  ).run({
    id: sessionId,
    now,
    ua: meta.userAgent || null,
    ip: meta.ipHash || null,
  });
}
