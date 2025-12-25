import { getDb } from './client.js';
import { logger } from '../logger.js';
import {
  dekCache,
  decryptData,
  decryptDek,
  encryptData,
  encryptDek,
  generateDek,
  isEncrypted,
  isKekConfigured,
} from '../lib/crypto/index.js';

let warnedMissingKek = false;
let warnedEncryptedWithoutKek = false;

function warnMissingKekOnce() {
  if (warnedMissingKek) return;
  warnedMissingKek = true;
  logger.warn('[encryption] ENCRYPTION_MASTER_KEY is not set; sensitive values will be stored in plaintext');
}

function warnEncryptedWithoutKekOnce() {
  if (warnedEncryptedWithoutKek) return;
  warnedEncryptedWithoutKek = true;
  logger.warn('[encryption] Encrypted values exist but ENCRYPTION_MASTER_KEY is not set; returning null for encrypted fields');
}

/**
 * Ensure a user has a DEK available (creates and stores one if missing).
 * Returns the decrypted DEK buffer, or null when encryption is disabled.
 * @param {string} userId
 */
export function ensureUserDek(userId) {
  if (!userId) {
    throw new Error('userId is required');
  }

  if (!isKekConfigured()) {
    warnMissingKekOnce();
    return null;
  }

  const cached = dekCache.get(userId);
  if (cached) return cached;

  const db = getDb();
  const row = db
    .prepare(`SELECT id, encrypted_dek FROM users WHERE id = ? AND deleted_at IS NULL`)
    .get(userId);

  if (!row) {
    throw new Error(`User not found: ${userId}`);
  }

  if (row.encrypted_dek) {
    const dek = decryptDek(row.encrypted_dek);
    dekCache.set(userId, dek);
    return dek;
  }

  const dek = generateDek();
  const encryptedDek = encryptDek(dek);
  const now = new Date().toISOString();

  db.prepare(
    `UPDATE users
     SET encrypted_dek = ?, dek_created_at = ?, dek_version = COALESCE(dek_version, 1), updated_at = ?
     WHERE id = ? AND deleted_at IS NULL`
  ).run(encryptedDek, now, now, userId);

  dekCache.set(userId, dek);
  return dek;
}

/**
 * Encrypt data for a user (idempotent; skips already encrypted strings).
 * Graceful degradation: when KEK is missing, returns plaintext.
 * @param {string} userId
 * @param {string|null|undefined} data
 */
export function encryptForUser(userId, data) {
  if (data == null) return data;
  if (typeof data !== 'string') data = String(data);

  if (isEncrypted(data)) return data;

  const dek = ensureUserDek(userId);
  if (!dek) return data;

  return encryptData(data, dek);
}

/**
 * Decrypt data for a user.
 * - If value is plaintext, returns as-is.
 * - If value is encrypted and KEK is missing, returns null.
 * @param {string} userId
 * @param {string|null|undefined} data
 */
export function decryptForUser(userId, data) {
  if (data == null) return data;
  if (typeof data !== 'string') data = String(data);

  if (!isEncrypted(data)) return data;

  if (!isKekConfigured()) {
    warnEncryptedWithoutKekOnce();
    return null;
  }

  try {
    const dek = ensureUserDek(userId);
    if (!dek) return null;
    return decryptData(data, dek);
  } catch (error) {
    logger.error({ err: error, userId }, '[encryption] Failed to decrypt value');
    return null;
  }
}
