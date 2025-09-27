import { test, expect } from '@jest/globals';
import {
  ensureSafeTestDatabase,
  setupSafeTestDatabase,
  validateTestEnvironment,
  safeTestSetup,
} from '../../test_support/databaseSafety.js';

export {
  ensureSafeTestDatabase,
  setupSafeTestDatabase,
  validateTestEnvironment,
  safeTestSetup,
};

// When Jest executes this file directly (because it lives in __tests__),
// register a trivial smoke test so the suite isn't considered empty. When
// imported from other test files, expect.getState().testPath resolves to the
// importing suite so this block is skipped and nothing extra runs.
const currentTestPath = expect.getState().testPath;
if (currentTestPath?.endsWith('database-safety.js')) {
  test('database safety helpers export functions', () => {
    expect(typeof ensureSafeTestDatabase).toBe('function');
    expect(typeof setupSafeTestDatabase).toBe('function');
    expect(typeof validateTestEnvironment).toBe('function');
    expect(typeof safeTestSetup).toBe('function');
  });
}