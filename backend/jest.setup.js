import {beforeAll, beforeEach, jest} from '@jest/globals';
import { safeTestSetup } from './test_support/databaseSafety.js';
// Avoid importing heavy DB modules at top-level in setup (they may transitively
// import server modules which Jest will try to resolve before test mocks).
let resetDbCache = null;
async function tryLoadResetDbCache() {
  if (resetDbCache) return;
  try {
    const mod = await import('./src/db/index.js');
    resetDbCache = mod.resetDbCache;
  } catch {
    // If dynamic import fails in setup, swallow the error — tests can opt-in to reset DB explicitly.
    // This avoids module resolution errors during early setup.
    resetDbCache = null;
  }
}

// Ensure test environment flag is set for downstream guards
process.env.NODE_ENV = 'test';

// Mock console.log to do nothing during tests
console.log = jest.fn();
beforeAll(() => {
  // Mock console.warn using jest.spyOn for better compatibility with restoreMocks
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  // Attempt to dynamically load DB reset if possible
  tryLoadResetDbCache();
})

// Establish a safe in-memory database before any tests execute
// If resetDbCache was successfully imported, call it; otherwise proceed.
beforeAll(async () => {
  if (resetDbCache) resetDbCache();
  safeTestSetup();
});

beforeEach(async () => {
  // Re-apply safety in case individual specs mutate persistence settings
  if (resetDbCache) resetDbCache();
  safeTestSetup();
});
