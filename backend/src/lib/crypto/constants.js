export const ENC_PREFIX = '$ENC$';
export const ENC_VERSION = 'v1';

export const ALGORITHM = 'aes-256-gcm';
export const KEY_BYTES = 32; // AES-256
export const NONCE_BYTES = 12; // Recommended for GCM
export const TAG_BYTES = 16;

export const ENC_HEADER = `${ENC_PREFIX}${ENC_VERSION}$`;
