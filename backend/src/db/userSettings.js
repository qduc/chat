import { getDb } from './client.js';
import { randomUUID } from 'crypto';
import { decryptForUser, encryptForUser } from './encryption.js';

const SENSITIVE_SETTING_NAMES = new Set(['tavily_api_key', 'exa_api_key', 'searxng_api_key']);

export function getUserSetting(userId, name) {
  const db = getDb();
  const row = db.prepare(`SELECT id, user_id, name, value, created_at, updated_at FROM user_settings WHERE user_id = ? AND name = ?`).get(userId, name);
  if (!row) return null;
  if (SENSITIVE_SETTING_NAMES.has(row.name)) {
    return { ...row, value: decryptForUser(userId, row.value) };
  }
  return row;
}

export function upsertUserSetting(userId, name, value) {
  const db = getDb();
  const now = new Date().toISOString();

  const valueToStore =
    SENSITIVE_SETTING_NAMES.has(name) ? encryptForUser(userId, value) : value;

  const existing = getUserSetting(userId, name);
  if (existing) {
    db.prepare(`UPDATE user_settings SET value = ?, updated_at = ? WHERE id = ?`).run(valueToStore, now, existing.id);
    return getUserSetting(userId, name);
  }

  const id = randomUUID();
  db.prepare(`INSERT INTO user_settings (id, user_id, name, value, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(id, userId, name, valueToStore, now, now);
  return getUserSetting(userId, name);
}

export function deleteUserSetting(userId, name) {
  const db = getDb();
  const info = db.prepare(`DELETE FROM user_settings WHERE user_id = ? AND name = ?`).run(userId, name);
  return info.changes > 0;
}
