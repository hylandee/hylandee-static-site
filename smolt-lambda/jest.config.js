/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  globalSetup: '<rootDir>/jest.globalSetup.js',
  globalTeardown: '<rootDir>/jest.globalTeardown.js',
  setupFiles: ['<rootDir>/jest.env.js'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
  moduleNameMapper: {
    // Strip .js extension so ts-jest resolves .ts source files
    '^(\\.{1,2}/.+)\\.js$': '$1',
  },
  testMatch: ['**/__tests__/**/*.test.ts'],
  // Run test files serially — auth.test and workout.test share the same DynamoDB Local instance
  maxWorkers: 1,
};
