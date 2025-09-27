import { beforeEach } from '@jest/globals';
import { safeTestSetup } from './test_support/databaseSafety.js';
import { resetDbCache } from './src/db/index.js';

// Ensure test environment flag is set for downstream guards
process.env.NODE_ENV = 'test';

// Establish a safe in-memory database before any tests execute
resetDbCache();
safeTestSetup();

beforeEach(() => {
  // Re-apply safety in case individual specs mutate persistence settings
  resetDbCache();
  safeTestSetup();
});
