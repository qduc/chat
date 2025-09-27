/**
 * Database Safety Utilities for Tests
 *
 * Prevents tests from accidentally running against production or development databases.
 * All database tests MUST use in-memory SQLite databases only.
 */

import { config } from '../../src/env.js';

/**
 * Ensures tests only run against safe in-memory databases
 * Call this at the beginning of any test that interacts with the database
 *
 * @throws {Error} If the database URL is not a safe test database
 */
export function ensureSafeTestDatabase() {
  const dbUrl = config.persistence.dbUrl || process.env.DB_URL || '';

  // Check for dangerous database URLs
  const dangerousPatterns = [
    // Production-like patterns
    /prod/i,
    /production/i,
    /live/i,
    /main/i,

    // Development database files
    /dev\.db$/i,
    /development\.db$/i,
    /app\.db$/i,
    /chat\.db$/i,

    // File paths that could be production/dev databases
    /\/data\//i,
    /\/db\//i,
    /\/database\//i,

    // Remote database URLs
    /^postgresql:/i,
    /^mysql:/i,
    /^mongodb:/i,
    /^redis:/i,
    /^http:/i,
    /^https:/i,
  ];

  // Only allow safe test database patterns
  const safePatterns = [
    /^file::memory:$/,           // In-memory SQLite
    /^:memory:$/,                // Alternative in-memory syntax
    /^file:test-.*\.db$/,        // Explicit test files (temporary)
    /^$/,                        // Empty string (will be set to memory)
  ];

  // Check if database URL matches any dangerous pattern
  for (const pattern of dangerousPatterns) {
    if (pattern.test(dbUrl)) {
      throw new Error(
        `🚨 SAFETY ERROR: Test attempted to use potentially dangerous database!\n` +
        `Database URL: ${dbUrl}\n` +
        `Tests must only use in-memory databases (file::memory:)\n` +
        `This prevents accidental data loss in production or development databases.`
      );
    }
  }

  // Check if database URL matches a safe pattern
  const isSafe = safePatterns.some(pattern => pattern.test(dbUrl));
  if (!isSafe) {
    throw new Error(
      `🚨 SAFETY ERROR: Test database URL is not explicitly safe!\n` +
      `Database URL: ${dbUrl}\n` +
      `Allowed patterns: file::memory:, :memory:, or empty string\n` +
      `If you need to use a file-based test database, prefix with 'test-' and suffix with '.db'`
    );
  }
}

/**
 * Sets up a safe test database configuration
 * Call this in beforeAll() hooks for database tests
 */
export function setupSafeTestDatabase() {
  // Force in-memory database for tests
  config.persistence.enabled = true;
  config.persistence.dbUrl = 'file::memory:';

  // Verify the configuration is safe
  ensureSafeTestDatabase();
}

/**
 * Validates that the current environment is suitable for testing
 */
export function validateTestEnvironment() {
  // Check NODE_ENV
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      `🚨 SAFETY ERROR: Tests should never run in NODE_ENV=production!\n` +
      `Current NODE_ENV: ${process.env.NODE_ENV}\n` +
      `Set NODE_ENV=test before running tests.`
    );
  }

  // Warn about development environment
  if (process.env.NODE_ENV === 'development') {
    console.warn(
      `⚠️  WARNING: Running tests in NODE_ENV=development\n` +
      `Consider setting NODE_ENV=test for cleaner test isolation.`
    );
  }

  // Check for production-like environment variables
  const productionEnvVars = [
    'PRODUCTION_DB_URL',
    'PROD_DATABASE_URL',
    'DATABASE_URL', // Common production variable
  ];

  for (const envVar of productionEnvVars) {
    if (process.env[envVar] && !process.env[envVar].includes('test')) {
      console.warn(
        `⚠️  WARNING: Production-like environment variable detected: ${envVar}\n` +
        `Value: ${process.env[envVar]}\n` +
        `Ensure this is not being used by tests.`
      );
    }
  }
}

/**
 * Complete safety setup for database tests
 * Use this in test files that interact with the database
 */
export function safeTestSetup() {
  validateTestEnvironment();
  setupSafeTestDatabase();
  ensureSafeTestDatabase();
}