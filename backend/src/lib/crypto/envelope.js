import crypto from 'crypto';
import { ALGORITHM, ENC_HEADER, ENC_PREFIX, ENC_VERSION, KEY_BYTES, NONCE_BYTES } from './constants.js';
import { EncryptionError, EncryptionErrorCodes } from './errors.js';

export function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith(ENC_PREFIX);
}

function assertKey(key) {
  if (!Buffer.isBuffer(key) || key.length !== KEY_BYTES) {
    throw new EncryptionError(
      EncryptionErrorCodes.ENCRYPT_FAILED,
      `Invalid key: expected ${KEY_BYTES} bytes`
    );
  }
}

/**
 * Encrypts plaintext using AES-256-GCM.
 * Returns format: $ENC$v1$<nonce_b64>$<ciphertext_b64>$<authTag_b64>
 * @param {string|Buffer|null|undefined} plaintext
 * @param {Buffer} key
 */
export function encryptData(plaintext, key) {
  if (plaintext == null) return null;
  assertKey(key);

  try {
    const nonce = crypto.randomBytes(NONCE_BYTES);
    const cipher = crypto.createCipheriv(ALGORITHM, key, nonce);

    const input = Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(String(plaintext), 'utf8');
    const ciphertext = Buffer.concat([cipher.update(input), cipher.final()]);
    const tag = cipher.getAuthTag();

    return `${ENC_HEADER}${nonce.toString('base64')}$${ciphertext.toString('base64')}$${tag.toString('base64')}`;
  } catch (cause) {
    throw new EncryptionError(EncryptionErrorCodes.ENCRYPT_FAILED, 'Failed to encrypt data', cause);
  }
}

/**
 * Decrypts ciphertext in $ENC$v1$... format using AES-256-GCM.
 * @param {string|null|undefined} ciphertext
 * @param {Buffer} key
 */
export function decryptData(ciphertext, key) {
  if (ciphertext == null) return null;
  assertKey(key);

  if (!isEncrypted(ciphertext)) {
    return String(ciphertext);
  }

  try {
    const parts = String(ciphertext).split('$');
    // ['', 'ENC', 'v1', nonce, ciphertext, tag]
    if (parts.length !== 6 || parts[1] !== 'ENC' || parts[2] !== ENC_VERSION) {
      throw new EncryptionError(EncryptionErrorCodes.VALUE_FORMAT_INVALID, 'Invalid encrypted value format');
    }

    const nonce = Buffer.from(parts[3], 'base64');
    const enc = Buffer.from(parts[4], 'base64');
    const tag = Buffer.from(parts[5], 'base64');

    const decipher = crypto.createDecipheriv(ALGORITHM, key, nonce);
    decipher.setAuthTag(tag);

    const plaintext = Buffer.concat([decipher.update(enc), decipher.final()]);
    return plaintext.toString('utf8');
  } catch (cause) {
    if (cause instanceof EncryptionError) throw cause;
    throw new EncryptionError(EncryptionErrorCodes.DECRYPT_FAILED, 'Failed to decrypt data', cause);
  }
}
