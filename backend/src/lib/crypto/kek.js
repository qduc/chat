import { Buffer } from 'buffer';
import { KEY_BYTES } from './constants.js';
import { EncryptionError, EncryptionErrorCodes } from './errors.js';

function tryParseHexKey(raw) {
  const s = String(raw).trim();
  if (!/^[0-9a-fA-F]+$/.test(s)) return null;
  if (s.length !== KEY_BYTES * 2) return null;
  try {
    const buf = Buffer.from(s, 'hex');
    return buf.length === KEY_BYTES ? buf : null;
  } catch {
    return null;
  }
}

function tryParseBase64Key(raw) {
  const s = String(raw).trim();
  try {
    const buf = Buffer.from(s, 'base64');
    return buf.length === KEY_BYTES ? buf : null;
  } catch {
    return null;
  }
}

function tryParseUtf8Key(raw) {
  const s = String(raw);
  const buf = Buffer.from(s, 'utf8');
  return buf.length === KEY_BYTES ? buf : null;
}

export function isKekConfigured() {
  // Encryption is disabled for Electron builds (local-first, data stays on user's machine)
  if (process.env.IS_ELECTRON === 'true') {
    return false;
  }
  return !!process.env.ENCRYPTION_MASTER_KEY;
}

/**
 * Returns the master key (KEK) as a 32-byte Buffer.
 * Accepts:
 * - 64-char hex
 * - base64 that decodes to 32 bytes
 * - raw utf8 string of length 32 bytes
 */
export function getKek() {
  const raw = process.env.ENCRYPTION_MASTER_KEY;
  if (!raw) {
    throw new EncryptionError(
      EncryptionErrorCodes.KEK_NOT_CONFIGURED,
      'ENCRYPTION_MASTER_KEY is not configured'
    );
  }

  const fromHex = tryParseHexKey(raw);
  if (fromHex) return fromHex;

  const fromB64 = tryParseBase64Key(raw);
  if (fromB64) return fromB64;

  const fromUtf8 = tryParseUtf8Key(raw);
  if (fromUtf8) return fromUtf8;

  throw new EncryptionError(
    EncryptionErrorCodes.KEK_INVALID,
    `ENCRYPTION_MASTER_KEY must be ${KEY_BYTES} bytes (got ${Buffer.from(String(raw)).length})`
  );
}
