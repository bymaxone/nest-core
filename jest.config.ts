import type { Config } from 'jest'

/**
 * Unit-test Jest configuration.
 *
 * Discovers specs co-located with source under `src/` and enforces the 100%
 * coverage floor on every axis. This is the fast, day-to-day suite; the
 * aggregated unit + e2e run lives in `jest.coverage.config.ts`.
 */
const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  testMatch: ['**/*.spec.ts', '**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  // Mirror the subpath aliases declared in tsconfig.json "paths" so tests
  // exercise the exact same import specifiers that consumers and the tsup
  // bundler use. Without this, tests would need relative imports while build
  // uses package specifiers, an easy source of drift.
  moduleNameMapper: {
    '^@bymax-one/nest-core$': '<rootDir>/index.ts',
    '^@bymax-one/nest-core/pagination$': '<rootDir>/pagination/index.ts',
    '^@bymax-one/nest-core/health$': '<rootDir>/health/index.ts'
  },
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/../tsconfig.jest.json'
      }
    ]
  },
  collectCoverageFrom: [
    '**/*.ts',
    '!**/*.spec.ts',
    '!**/*.test.ts',
    '!**/__tests__/**',
    '!**/*.d.ts'
  ],
  coverageThreshold: {
    global: {
      branches: 100,
      functions: 100,
      lines: 100,
      statements: 100
    }
  },
  coverageReporters: ['text', 'lcov', 'clover'],
  maxWorkers: '50%',
  clearMocks: true,
  restoreMocks: true,
  // No spec files exist yet at this stage of the repository; the placeholder
  // barrels keep the coverage threshold green with zero tests.
  passWithNoTests: true
}

export default config
