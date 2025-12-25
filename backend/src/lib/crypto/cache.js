const DEFAULT_TTL_MS = 5 * 60 * 1000;

/**
 * Simple in-memory DEK cache with TTL.
 */
export class DekCache {
  constructor(ttlMs = DEFAULT_TTL_MS) {
    this.ttlMs = ttlMs;
    /** @type {Map<string, { dek: Buffer, expiresAt: number }>} */
    this.map = new Map();
  }

  /** @param {string} userId */
  get(userId) {
    const item = this.map.get(userId);
    if (!item) return null;
    if (Date.now() > item.expiresAt) {
      this.map.delete(userId);
      return null;
    }
    return item.dek;
  }

  /** @param {string} userId @param {Buffer} dek */
  set(userId, dek) {
    this.map.set(userId, { dek, expiresAt: Date.now() + this.ttlMs });
  }

  /** @param {string} userId */
  delete(userId) {
    this.map.delete(userId);
  }

  clear() {
    this.map.clear();
  }
}

export const dekCache = new DekCache();
