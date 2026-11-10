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

// Under Jest's VM modules, `structuredClone` is Node's outer-realm function, so
// its copies carry another realm's Object/Array prototypes and never
// `isDeepStrictEqual` the originals. Production has one realm, where they do;
// @qduc/agent-core's continuity relies on that. Rebuild plain data locally.
const outerStructuredClone = globalThis.structuredClone;
function toLocalRealm(value) {
  if (Array.isArray(value)) return Array.from(value, toLocalRealm);
  if (value === null || typeof value !== 'object') return value;
  const proto = Object.getPrototypeOf(value);
  if (proto !== null && proto?.constructor?.name !== 'Object') return value;
  const copy = proto === null ? Object.create(null) : {};
  for (const key of Object.keys(value)) copy[key] = toLocalRealm(value[key]);
  return copy;
}
globalThis.structuredClone = (value, options) => toLocalRealm(outerStructuredClone(value, options));

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
