import { getDb } from './client.js';
import { randomUUID } from 'crypto';

export function getUserSetting(userId, name) {
  const db = getDb();
  const row = db.prepare(`SELECT id, user_id, name, value, created_at, updated_at FROM user_settings WHERE user_id = ? AND name = ?`).get(userId, name);
  return row || null;
}

export function upsertUserSetting(userId, name, value) {
  const db = getDb();
  const now = new Date().toISOString();

  const existing = getUserSetting(userId, name);
  if (existing) {
    db.prepare(`UPDATE user_settings SET value = ?, updated_at = ? WHERE id = ?`).run(value, now, existing.id);
    return getUserSetting(userId, name);
  }

  const id = randomUUID();
  db.prepare(`INSERT INTO user_settings (id, user_id, name, value, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(id, userId, name, value, now, now);
  return getUserSetting(userId, name);
}

export function deleteUserSetting(userId, name) {
  const db = getDb();
  const info = db.prepare(`DELETE FROM user_settings WHERE user_id = ? AND name = ?`).run(userId, name);
  return info.changes > 0;
}
