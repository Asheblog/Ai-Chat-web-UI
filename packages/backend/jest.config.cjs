const config = {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  rootDir: './',
  // Avoid <rootDir>/... absolute globs: on Windows under `.worktrees`, `\.` breaks micromatch.
  testMatch: ['**/src/**/*.test.ts', '**/src/**/__tests__/**/*.test.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^@aichat/shared$': '<rootDir>/../shared/src/index.ts',
    '^@aichat/shared/(.*)$': '<rootDir>/../shared/src/$1.ts',
  },
  extensionsToTreatAsEsm: ['.ts'],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: '<rootDir>/tsconfig.json',
      },
    ],
  },
}

module.exports = config
