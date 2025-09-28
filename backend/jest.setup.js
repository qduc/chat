import {beforeAll, beforeEach, jest} from '@jest/globals';
import { safeTestSetup } from './test_support/databaseSafety.js';
import { resetDbCache } from './src/db/index.js';

// Ensure test environment flag is set for downstream guards
process.env.NODE_ENV = 'test';

// Store the original console.log function
const originalConsoleLog = console.log;
const originalConsoleWarn = console.warn;

// Mock console.log to do nothing during tests
console.log = jest.fn();
beforeAll(() => {
  // Mock console.warn using jest.spyOn for better compatibility with restoreMocks
  jest.spyOn(console, 'warn').mockImplementation(() => {});
})

// Establish a safe in-memory database before any tests execute
resetDbCache();
safeTestSetup();

beforeEach(() => {
  // Re-apply safety in case individual specs mutate persistence settings
  resetDbCache();
  safeTestSetup();
});
