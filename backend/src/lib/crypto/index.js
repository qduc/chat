export { ENC_PREFIX, ENC_VERSION, ENC_HEADER } from './constants.js';
export { EncryptionError, EncryptionErrorCodes } from './errors.js';
export { isKekConfigured, getKek } from './kek.js';
export { generateDek, encryptDek, decryptDek } from './dek.js';
export { encryptData, decryptData, isEncrypted } from './envelope.js';
export { dekCache, DekCache } from './cache.js';
