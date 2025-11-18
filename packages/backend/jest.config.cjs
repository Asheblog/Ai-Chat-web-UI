const config = {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  rootDir: './',
  testMatch: ['<rootDir>/src/**/*.test.ts', '<rootDir>/src/**/__tests__/**/*.test.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
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
