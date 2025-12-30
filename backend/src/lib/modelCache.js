/**
 * In-memory model cache with per-user scoping.
 *
 * Provides caching for model lists fetched from providers, with support for:
 * - Per-user isolation (each user has their own cache entry)
 * - Refresh locking to prevent concurrent refreshes
 * - Background refresh support
 */

import { logger } from '../logger.js';

/**
 * @typedef {Object} ProviderModels
 * @property {Object} provider - Provider info (id, name, provider_type)
 * @property {Array} models - Array of model objects
 */

/**
 * @typedef {Object} CacheEntry
 * @property {ProviderModels[]} providers - Array of provider model data
 * @property {number} cachedAt - Timestamp when cached
 */

/** @type {Map<string, CacheEntry>} */
const modelCache = new Map();

/** @type {Map<string, boolean>} */
const refreshLocks = new Map();

/**
 * Get cached models for a user
 * @param {string} userId - User ID
 * @returns {CacheEntry|null} Cached entry or null if not found
 */
export function getCachedModels(userId) {
  return modelCache.get(userId) || null;
}

/**
 * Set cached models for a user
 * @param {string} userId - User ID
 * @param {ProviderModels[]} providers - Array of provider model data
 */
export function setCachedModels(userId, providers) {
  modelCache.set(userId, {
    providers,
    cachedAt: Date.now(),
  });
  logger.debug({ msg: 'modelcache:set', userId, providerCount: providers.length });
}

/**
 * Clear cache for a specific user
 * @param {string} userId - User ID
 */
export function clearUserCache(userId) {
  modelCache.delete(userId);
  logger.debug({ msg: 'modelcache:clear_user', userId });
}

/**
 * Clear all cached models
 */
export function clearAllCache() {
  const count = modelCache.size;
  modelCache.clear();
  logger.info({ msg: 'modelcache:clear_all', cleared: count });
}

/**
 * Get all user IDs with cached data
 * @returns {string[]} Array of user IDs
 */
export function getCachedUserIds() {
  return Array.from(modelCache.keys());
}

/**
 * Check if refresh is in progress for a user
 * @param {string} userId - User ID
 * @returns {boolean}
 */
export function isRefreshing(userId) {
  return refreshLocks.get(userId) === true;
}

/**
 * Set refresh lock for a user
 * @param {string} userId - User ID
 * @param {boolean} locked - Lock state
 */
export function setRefreshLock(userId, locked) {
  if (locked) {
    refreshLocks.set(userId, true);
  } else {
    refreshLocks.delete(userId);
  }
}

/**
 * Get cache statistics
 * @returns {{userCount: number, refreshingCount: number}}
 */
export function getCacheStats() {
  return {
    userCount: modelCache.size,
    refreshingCount: refreshLocks.size,
  };
}
