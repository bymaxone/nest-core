import type { Config } from 'jest'

/**
 * Jest configuration for end-to-end tests.
 *
 * Lives separately from the unit-test config (`jest.config.ts`) so that the
 * coverage thresholds enforced for the unit suite never interfere with e2e
 * runs, and so that e2e specs can be discovered under `test/e2e/` rather than
 * inside `src/`.
 */
const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'test/e2e',
  testMatch: ['**/*.e2e-spec.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  // Mirror the subpath aliases declared in tsconfig.json "paths" so e2e tests
  // and production code resolve the same module instance.
  moduleNameMapper: {
    '^@bymax-one/nest-core$': '<rootDir>/../../src/index.ts',
    '^@bymax-one/nest-core/pagination$': '<rootDir>/../../src/pagination/index.ts',
    '^@bymax-one/nest-core/health$': '<rootDir>/../../src/health/index.ts',
    '^@bymax-one/nest-core/openapi$': '<rootDir>/../../src/openapi/index.ts',
    '^@bymax-one/nest-core/metrics$': '<rootDir>/../../src/metrics/index.ts'
  },
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/../../tsconfig.e2e.json'
      }
    ]
  },
  testTimeout: 30_000,
  maxWorkers: '50%',
  clearMocks: true,
  restoreMocks: true,
  // The test/e2e directory does not exist yet; a real spec lands in a later phase.
  passWithNoTests: true
}

export default config
