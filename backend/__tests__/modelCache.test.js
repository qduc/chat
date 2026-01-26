/**
 * Tests for modelCache.js - in-memory model cache with per-user scoping
 */

import assert from 'node:assert/strict';
import { jest } from '@jest/globals';
import {
  getCachedModels,
  setCachedModels,
  clearUserCache,
  clearAllCache,
  getCachedUserIds,
  isRefreshing,
  setRefreshLock,
  getCacheStats,
} from '../src/lib/modelCache.js';

describe('modelCache', () => {
  // Sample test data
  const userId1 = 'user-123';
  const userId2 = 'user-456';
  const userId3 = 'user-789';

  const sampleProviders1 = [
    {
      provider: { id: 1, name: 'OpenAI', provider_type: 'openai' },
      models: [
        { id: 'gpt-4', name: 'GPT-4' },
        { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo' },
      ],
    },
  ];

  const sampleProviders2 = [
    {
      provider: { id: 2, name: 'Anthropic', provider_type: 'anthropic' },
      models: [
        { id: 'claude-3-opus', name: 'Claude 3 Opus' },
      ],
    },
  ];

  const sampleProviders3 = [
    {
      provider: { id: 3, name: 'Google', provider_type: 'gemini' },
      models: [
        { id: 'gemini-pro', name: 'Gemini Pro' },
      ],
    },
  ];

  beforeEach(() => {
    // Clear all cache and locks before each test
    clearAllCache();
    // Clear all refresh locks
    setRefreshLock(userId1, false);
    setRefreshLock(userId2, false);
    setRefreshLock(userId3, false);
  });

  describe('getCachedModels', () => {
    test('returns null when no cache exists for user', () => {
      const result = getCachedModels(userId1);
      assert.strictEqual(result, null);
    });

    test('returns cached entry after setting cache', () => {
      setCachedModels(userId1, sampleProviders1);
      const result = getCachedModels(userId1);

      assert.ok(result);
      assert.ok(result.providers);
      assert.strictEqual(result.providers.length, 1);
      assert.strictEqual(result.providers[0].provider.name, 'OpenAI');
      assert.ok(result.cachedAt);
      assert.ok(typeof result.cachedAt === 'number');
    });

    test('returns correct cache for different users', () => {
      setCachedModels(userId1, sampleProviders1);
      setCachedModels(userId2, sampleProviders2);

      const result1 = getCachedModels(userId1);
      const result2 = getCachedModels(userId2);

      assert.strictEqual(result1.providers[0].provider.name, 'OpenAI');
      assert.strictEqual(result2.providers[0].provider.name, 'Anthropic');
    });

    test('maintains per-user isolation', () => {
      setCachedModels(userId1, sampleProviders1);

      const result1 = getCachedModels(userId1);
      const result2 = getCachedModels(userId2);

      assert.ok(result1);
      assert.strictEqual(result2, null);
    });
  });

  describe('setCachedModels', () => {
    test('sets cache with providers and timestamp', () => {
      const beforeTime = Date.now();
      setCachedModels(userId1, sampleProviders1);
      const afterTime = Date.now();

      const result = getCachedModels(userId1);

      assert.ok(result);
      assert.deepStrictEqual(result.providers, sampleProviders1);
      assert.ok(result.cachedAt >= beforeTime);
      assert.ok(result.cachedAt <= afterTime);
    });

    test('overwrites existing cache for same user', () => {
      setCachedModels(userId1, sampleProviders1);
      const firstResult = getCachedModels(userId1);
      const firstTimestamp = firstResult.cachedAt;

      // Wait a small amount to ensure timestamp changes
      jest.advanceTimersByTime(10);

      setCachedModels(userId1, sampleProviders2);
      const secondResult = getCachedModels(userId1);

      assert.strictEqual(secondResult.providers[0].provider.name, 'Anthropic');
      // In real scenarios, timestamp would be different, but since we're not using fake timers
      // by default, we just verify it exists
      assert.ok(secondResult.cachedAt);
    });

    test('sets cache for multiple users independently', () => {
      setCachedModels(userId1, sampleProviders1);
      setCachedModels(userId2, sampleProviders2);
      setCachedModels(userId3, sampleProviders3);

      assert.strictEqual(getCachedModels(userId1).providers[0].provider.name, 'OpenAI');
      assert.strictEqual(getCachedModels(userId2).providers[0].provider.name, 'Anthropic');
      assert.strictEqual(getCachedModels(userId3).providers[0].provider.name, 'Google');
    });

    test('handles empty providers array', () => {
      setCachedModels(userId1, []);
      const result = getCachedModels(userId1);

      assert.ok(result);
      assert.deepStrictEqual(result.providers, []);
      assert.ok(result.cachedAt);
    });

    test('preserves provider data structure', () => {
      const complexProviders = [
        {
          provider: {
            id: 1,
            name: 'Test Provider',
            provider_type: 'custom',
            customField: 'test',
          },
          models: [
            { id: 'model-1', name: 'Model 1', extra: { data: 'test' } },
            { id: 'model-2', name: 'Model 2', capabilities: ['chat', 'vision'] },
          ],
        },
      ];

      setCachedModels(userId1, complexProviders);
      const result = getCachedModels(userId1);

      assert.deepStrictEqual(result.providers, complexProviders);
    });
  });

  describe('clearUserCache', () => {
    test('clears cache for specific user', () => {
      setCachedModels(userId1, sampleProviders1);
      setCachedModels(userId2, sampleProviders2);

      clearUserCache(userId1);

      assert.strictEqual(getCachedModels(userId1), null);
      assert.ok(getCachedModels(userId2));
    });

    test('is safe to call when no cache exists', () => {
      // Should not throw
      assert.doesNotThrow(() => {
        clearUserCache(userId1);
      });
    });

    test('can clear cache multiple times', () => {
      setCachedModels(userId1, sampleProviders1);

      clearUserCache(userId1);
      clearUserCache(userId1);

      assert.strictEqual(getCachedModels(userId1), null);
    });
  });

  describe('clearAllCache', () => {
    test('clears all user caches', () => {
      setCachedModels(userId1, sampleProviders1);
      setCachedModels(userId2, sampleProviders2);
      setCachedModels(userId3, sampleProviders3);

      clearAllCache();

      assert.strictEqual(getCachedModels(userId1), null);
      assert.strictEqual(getCachedModels(userId2), null);
      assert.strictEqual(getCachedModels(userId3), null);
    });

    test('returns count of cleared entries via stats', () => {
      setCachedModels(userId1, sampleProviders1);
      setCachedModels(userId2, sampleProviders2);

      const statsBefore = getCacheStats();
      assert.strictEqual(statsBefore.userCount, 2);

      clearAllCache();

      const statsAfter = getCacheStats();
      assert.strictEqual(statsAfter.userCount, 0);
    });

    test('is safe to call on empty cache', () => {
      assert.doesNotThrow(() => {
        clearAllCache();
      });

      const stats = getCacheStats();
      assert.strictEqual(stats.userCount, 0);
    });
  });

  describe('getCachedUserIds', () => {
    test('returns empty array when no cache exists', () => {
      const userIds = getCachedUserIds();
      assert.ok(Array.isArray(userIds));
      assert.strictEqual(userIds.length, 0);
    });

    test('returns array of user IDs with cached data', () => {
      setCachedModels(userId1, sampleProviders1);
      setCachedModels(userId2, sampleProviders2);

      const userIds = getCachedUserIds();

      assert.strictEqual(userIds.length, 2);
      assert.ok(userIds.includes(userId1));
      assert.ok(userIds.includes(userId2));
    });

    test('updates when cache is modified', () => {
      setCachedModels(userId1, sampleProviders1);
      let userIds = getCachedUserIds();
      assert.strictEqual(userIds.length, 1);

      setCachedModels(userId2, sampleProviders2);
      userIds = getCachedUserIds();
      assert.strictEqual(userIds.length, 2);

      clearUserCache(userId1);
      userIds = getCachedUserIds();
      assert.strictEqual(userIds.length, 1);
      assert.ok(userIds.includes(userId2));
    });
  });

  describe('isRefreshing', () => {
    test('returns false when no refresh lock exists', () => {
      assert.strictEqual(isRefreshing(userId1), false);
    });

    test('returns true when refresh lock is set', () => {
      setRefreshLock(userId1, true);
      assert.strictEqual(isRefreshing(userId1), true);
    });

    test('returns false after lock is released', () => {
      setRefreshLock(userId1, true);
      setRefreshLock(userId1, false);
      assert.strictEqual(isRefreshing(userId1), false);
    });

    test('maintains per-user lock isolation', () => {
      setRefreshLock(userId1, true);

      assert.strictEqual(isRefreshing(userId1), true);
      assert.strictEqual(isRefreshing(userId2), false);
    });
  });

  describe('setRefreshLock', () => {
    test('sets lock to true', () => {
      setRefreshLock(userId1, true);
      assert.strictEqual(isRefreshing(userId1), true);
    });

    test('releases lock when set to false', () => {
      setRefreshLock(userId1, true);
      setRefreshLock(userId1, false);
      assert.strictEqual(isRefreshing(userId1), false);
    });

    test('can toggle lock multiple times', () => {
      setRefreshLock(userId1, true);
      assert.strictEqual(isRefreshing(userId1), true);

      setRefreshLock(userId1, false);
      assert.strictEqual(isRefreshing(userId1), false);

      setRefreshLock(userId1, true);
      assert.strictEqual(isRefreshing(userId1), true);
    });

    test('maintains independent locks for different users', () => {
      setRefreshLock(userId1, true);
      setRefreshLock(userId2, true);

      assert.strictEqual(isRefreshing(userId1), true);
      assert.strictEqual(isRefreshing(userId2), true);

      setRefreshLock(userId1, false);

      assert.strictEqual(isRefreshing(userId1), false);
      assert.strictEqual(isRefreshing(userId2), true);
    });

    test('is safe to release non-existent lock', () => {
      assert.doesNotThrow(() => {
        setRefreshLock(userId1, false);
      });
      assert.strictEqual(isRefreshing(userId1), false);
    });
  });

  describe('getCacheStats', () => {
    test('returns zero stats for empty cache', () => {
      const stats = getCacheStats();
      assert.strictEqual(stats.userCount, 0);
      assert.strictEqual(stats.refreshingCount, 0);
    });

    test('returns correct user count', () => {
      setCachedModels(userId1, sampleProviders1);
      setCachedModels(userId2, sampleProviders2);

      const stats = getCacheStats();
      assert.strictEqual(stats.userCount, 2);
    });

    test('returns correct refreshing count', () => {
      setRefreshLock(userId1, true);
      setRefreshLock(userId2, true);

      const stats = getCacheStats();
      assert.strictEqual(stats.refreshingCount, 2);
    });

    test('returns combined stats', () => {
      setCachedModels(userId1, sampleProviders1);
      setCachedModels(userId2, sampleProviders2);
      setRefreshLock(userId1, true);

      const stats = getCacheStats();
      assert.strictEqual(stats.userCount, 2);
      assert.strictEqual(stats.refreshingCount, 1);
    });

    test('updates as cache and locks change', () => {
      let stats = getCacheStats();
      assert.strictEqual(stats.userCount, 0);
      assert.strictEqual(stats.refreshingCount, 0);

      setCachedModels(userId1, sampleProviders1);
      setRefreshLock(userId1, true);

      stats = getCacheStats();
      assert.strictEqual(stats.userCount, 1);
      assert.strictEqual(stats.refreshingCount, 1);

      clearUserCache(userId1);
      setRefreshLock(userId1, false);

      stats = getCacheStats();
      assert.strictEqual(stats.userCount, 0);
      assert.strictEqual(stats.refreshingCount, 0);
    });
  });

  describe('Cache timestamp behavior', () => {
    test('timestamp reflects when cache was set', () => {
      const beforeSet = Date.now();
      setCachedModels(userId1, sampleProviders1);
      const afterSet = Date.now();

      const cached = getCachedModels(userId1);

      assert.ok(cached.cachedAt >= beforeSet);
      assert.ok(cached.cachedAt <= afterSet);
    });

    test('timestamp updates when cache is refreshed', () => {
      setCachedModels(userId1, sampleProviders1);
      const firstCached = getCachedModels(userId1);
      const firstTimestamp = firstCached.cachedAt;

      // Small delay to ensure different timestamp
      const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

      return delay(5).then(() => {
        setCachedModels(userId1, sampleProviders1);
        const secondCached = getCachedModels(userId1);

        // Timestamp should be updated
        assert.ok(secondCached.cachedAt >= firstTimestamp);
      });
    });

    test('different users have independent timestamps', () => {
      const time1Before = Date.now();
      setCachedModels(userId1, sampleProviders1);
      const time1After = Date.now();

      // Small delay
      const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

      return delay(5).then(() => {
        const time2Before = Date.now();
        setCachedModels(userId2, sampleProviders2);
        const time2After = Date.now();

        const cached1 = getCachedModels(userId1);
        const cached2 = getCachedModels(userId2);

        // User 1 timestamp should be from first set
        assert.ok(cached1.cachedAt >= time1Before);
        assert.ok(cached1.cachedAt <= time1After);

        // User 2 timestamp should be from second set
        assert.ok(cached2.cachedAt >= time2Before);
        assert.ok(cached2.cachedAt <= time2After);
      });
    });
  });

  describe('Concurrent access patterns', () => {
    test('handles rapid cache updates', () => {
      for (let i = 0; i < 100; i++) {
        setCachedModels(userId1, sampleProviders1);
      }

      const cached = getCachedModels(userId1);
      assert.ok(cached);
      assert.deepStrictEqual(cached.providers, sampleProviders1);
    });

    test('handles multiple users updating simultaneously', () => {
      setCachedModels(userId1, sampleProviders1);
      setCachedModels(userId2, sampleProviders2);
      setCachedModels(userId3, sampleProviders3);

      assert.ok(getCachedModels(userId1));
      assert.ok(getCachedModels(userId2));
      assert.ok(getCachedModels(userId3));

      const stats = getCacheStats();
      assert.strictEqual(stats.userCount, 3);
    });

    test('handles interleaved lock and cache operations', () => {
      setRefreshLock(userId1, true);
      setCachedModels(userId1, sampleProviders1);

      assert.strictEqual(isRefreshing(userId1), true);
      assert.ok(getCachedModels(userId1));

      setRefreshLock(userId1, false);
      clearUserCache(userId1);

      assert.strictEqual(isRefreshing(userId1), false);
      assert.strictEqual(getCachedModels(userId1), null);
    });
  });

  describe('Edge cases', () => {
    test('handles null or undefined userId gracefully', () => {
      // These will be stored with the actual keys 'null' and 'undefined' as strings
      // Testing that the cache doesn't crash with unusual keys
      setCachedModels(null, sampleProviders1);
      setCachedModels(undefined, sampleProviders2);

      const cachedNull = getCachedModels(null);
      const cachedUndefined = getCachedModels(undefined);

      assert.ok(cachedNull);
      assert.ok(cachedUndefined);
    });

    test('handles very long user IDs', () => {
      const longUserId = 'user-' + 'a'.repeat(1000);
      setCachedModels(longUserId, sampleProviders1);

      const cached = getCachedModels(longUserId);
      assert.ok(cached);
    });

    test('handles providers with many models', () => {
      const manyModels = {
        provider: { id: 1, name: 'Test', provider_type: 'test' },
        models: Array.from({ length: 100 }, (_, i) => ({
          id: `model-${i}`,
          name: `Model ${i}`,
        })),
      };

      setCachedModels(userId1, [manyModels]);
      const cached = getCachedModels(userId1);

      assert.strictEqual(cached.providers[0].models.length, 100);
    });

    test('cache and locks are independent systems', () => {
      // Setting a lock doesn't create a cache entry
      setRefreshLock(userId1, true);
      assert.strictEqual(getCachedModels(userId1), null);

      // Setting cache doesn't create a lock
      setCachedModels(userId2, sampleProviders1);
      assert.strictEqual(isRefreshing(userId2), false);

      // Clearing cache doesn't clear lock
      setCachedModels(userId3, sampleProviders1);
      setRefreshLock(userId3, true);
      clearUserCache(userId3);
      assert.strictEqual(isRefreshing(userId3), true);
    });
  });

  describe('Integration scenarios', () => {
    test('typical cache hit scenario', () => {
      // Initial fetch - cache miss
      let cached = getCachedModels(userId1);
      assert.strictEqual(cached, null);

      // Set cache after fetching
      setCachedModels(userId1, sampleProviders1);

      // Subsequent fetch - cache hit
      cached = getCachedModels(userId1);
      assert.ok(cached);
      assert.strictEqual(cached.providers[0].provider.name, 'OpenAI');
    });

    test('background refresh scenario', () => {
      // Initial cache
      setCachedModels(userId1, sampleProviders1);

      // Start background refresh
      setRefreshLock(userId1, true);
      assert.strictEqual(isRefreshing(userId1), true);

      // Cache is still available during refresh
      const cached = getCachedModels(userId1);
      assert.ok(cached);

      // Update cache with new data
      setCachedModels(userId1, sampleProviders2);

      // Release lock
      setRefreshLock(userId1, false);
      assert.strictEqual(isRefreshing(userId1), false);

      // Verify updated cache
      const updated = getCachedModels(userId1);
      assert.strictEqual(updated.providers[0].provider.name, 'Anthropic');
    });

    test('cache invalidation scenario', () => {
      // Setup multiple users with cache
      setCachedModels(userId1, sampleProviders1);
      setCachedModels(userId2, sampleProviders2);

      const statsBefore = getCacheStats();
      assert.strictEqual(statsBefore.userCount, 2);

      // Invalidate specific user
      clearUserCache(userId1);

      const statsAfter = getCacheStats();
      assert.strictEqual(statsAfter.userCount, 1);

      // User 1 cache is gone
      assert.strictEqual(getCachedModels(userId1), null);

      // User 2 cache is intact
      assert.ok(getCachedModels(userId2));
    });

    test('full cache lifecycle', () => {
      // Empty state
      let stats = getCacheStats();
      assert.strictEqual(stats.userCount, 0);

      // Add users
      setCachedModels(userId1, sampleProviders1);
      setCachedModels(userId2, sampleProviders2);
      setCachedModels(userId3, sampleProviders3);

      stats = getCacheStats();
      assert.strictEqual(stats.userCount, 3);

      // Clear all
      clearAllCache();

      stats = getCacheStats();
      assert.strictEqual(stats.userCount, 0);

      // All caches should be gone
      assert.strictEqual(getCachedModels(userId1), null);
      assert.strictEqual(getCachedModels(userId2), null);
      assert.strictEqual(getCachedModels(userId3), null);
    });
  });
});
