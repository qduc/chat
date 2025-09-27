import { safeTestSetup } from './__tests__/test_utils/database-safety.js';
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
