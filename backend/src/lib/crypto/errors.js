export class EncryptionError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {unknown} [cause]
   */
  constructor(code, message, cause) {
    super(message);
    this.name = 'EncryptionError';
    this.code = code;
    if (cause !== undefined) this.cause = cause;
  }
}

export const EncryptionErrorCodes = {
  KEK_NOT_CONFIGURED: 'KEK_NOT_CONFIGURED',
  KEK_INVALID: 'KEK_INVALID',
  VALUE_FORMAT_INVALID: 'VALUE_FORMAT_INVALID',
  DECRYPT_FAILED: 'DECRYPT_FAILED',
  ENCRYPT_FAILED: 'ENCRYPT_FAILED',
};
