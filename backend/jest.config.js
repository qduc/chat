/** @type {import('jest').Config} */
const config = {
  testEnvironment: 'node',
  transform: {}, // Needed for ESM

  // Improve test isolation and worker cleanup
  maxWorkers: 1, // Run tests serially to prevent port conflicts and resource leaks
  forceExit: false, // Force exit after tests complete to prevent hanging workers
  detectOpenHandles: true, // Let tests handle their own cleanup

  // Timeout configuration
  testTimeout: 10000, // 10 second timeout for individual tests

  // Setup and teardown
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],

  // Verbose output for debugging
  verbose: false,

  // Clear mocks between tests
  clearMocks: true,
  restoreMocks: true,
};

export default config;
