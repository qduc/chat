import crypto from 'crypto';
import { KEY_BYTES } from './constants.js';
import { getKek } from './kek.js';
import { decryptData, encryptData } from './envelope.js';

export function generateDek() {
  return crypto.randomBytes(KEY_BYTES);
}

/**
 * Wrap (encrypt) a DEK using the master KEK.
 * Stores the DEK as base64 inside the envelope ciphertext.
 * @param {Buffer} dek
 */
export function encryptDek(dek) {
  const kek = getKek();
  const b64 = Buffer.from(dek).toString('base64');
  return encryptData(b64, kek);
}

/**
 * Unwrap (decrypt) an encrypted DEK using the master KEK.
 * @param {string} encryptedDek
 */
export function decryptDek(encryptedDek) {
  const kek = getKek();
  const b64 = decryptData(encryptedDek, kek);
  return Buffer.from(String(b64), 'base64');
}
