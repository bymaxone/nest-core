import js from '@eslint/js'
import tsPlugin from '@typescript-eslint/eslint-plugin'
import tsParser from '@typescript-eslint/parser'
import prettierConfig from 'eslint-config-prettier'
import importPlugin from 'eslint-plugin-import'
import prettier from 'eslint-plugin-prettier'
import security from 'eslint-plugin-security'
import globals from 'globals'

export default [
  // Global ignores. Only build artifacts and coverage, not config files.
  {
    ignores: ['node_modules/**', 'dist/**', 'coverage/**', 'reports/**', '.stryker-tmp/**']
  },

  // Base recommended config
  js.configs.recommended,

  // TypeScript production files (Node-only library; no DOM, no JSX). Shared
  // between src/ and the e2e fixture: the fixture is real application code
  // (a Nest module the README mirrors), not test code, so it holds the same
  // strict bar as the published package.
  {
    files: ['src/**/*.ts', 'test/e2e/fixture/**/*.ts'],
    // `__tests__/` holds scaffolding shared between spec files — fixtures and
    // builders, never production code. Both Jest coverage configs and the
    // Stryker `mutate` list already exclude it; this is the one config that had
    // not been told, and without it a helper reading a document by key trips
    // the object-injection rule that specs are not held to.
    ignores: ['**/*.spec.ts', '**/*.test.ts', '**/__tests__/**'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: ['./tsconfig.json', './tsconfig.e2e.json'],
        tsconfigRootDir: import.meta.dirname,
        ecmaVersion: 2022,
        sourceType: 'module'
      },
      globals: {
        ...globals.node
      }
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      import: importPlugin,
      prettier,
      security
    },
    settings: {
      'import/resolver': {
        typescript: {
          alwaysTryTypes: true,
          project: ['./tsconfig.json', './tsconfig.e2e.json'],
          // Both projects are consulted per-file (src/ vs. test/e2e/fixture/);
          // this is deliberate, not a perf mistake, so the informational
          // "multiple projects" notice is silenced.
          noWarnOnMultipleProjects: true
        },
        node: {
          extensions: ['.js', '.ts']
        }
      }
    },
    rules: {
      // TypeScript, strict: zero `any`, explicit return types on exports.
      // typescript-eslint advises both off: the compiler reports undefined names, and the base
      // unused rule can report incorrect errors beside its typed replacement.
      'no-undef': 'off',
      'no-unused-vars': 'off',
      // `^_` mirrors TypeScript's own exemption; typescript-eslint documents the option.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_'
        }
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-function-return-type': 'error',
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        {
          prefer: 'type-imports',
          fixStyle: 'separate-type-imports'
        }
      ],
      '@typescript-eslint/no-empty-function': 'error',

      // Code quality
      'prefer-const': 'error',
      'no-var': 'error',
      'no-empty': 'error',
      'no-console': ['error', { allow: ['warn', 'error'] }],

      // Security, block dynamic code evaluation
      'no-eval': 'error',
      'no-new-func': 'error',
      'no-implied-eval': 'error',

      // Security, ban bare 'crypto' and external crypto/id packages (node:crypto only).
      // A Bymax-wide guard rail: even a package with no current cryptography surface
      // must reach for node: builtins, never a third-party dependency, if it ever adds one.
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'crypto', message: "Use 'node:crypto' with the node: prefix instead." },
            { name: 'bcrypt', message: 'Use node:crypto scrypt instead.' },
            { name: 'argon2', message: 'Use node:crypto scrypt instead.' },
            { name: 'uuid', message: 'Use crypto.randomUUID() from node:crypto instead.' },
            { name: 'nanoid', message: 'Use crypto.randomBytes() from node:crypto instead.' },
            { name: 'crypto-js', message: 'Use node:crypto instead.' }
          ]
        }
      ],

      // Security plugin rules. `detect-object-injection` flags any computed member access and
      // has no option to tell an own key from an inherited one; its README expects human triage.
      // The controls here are `Object.hasOwn`, `Map` and null-prototype copies, held by specs.
      'security/detect-object-injection': 'off',
      'security/detect-non-literal-regexp': 'error',
      'security/detect-possible-timing-attacks': 'error',

      // Import ordering: node: -> external -> internal -> parent/sibling -> index
      'import/order': [
        'error',
        {
          groups: ['builtin', 'external', 'internal', ['parent', 'sibling'], 'index'],
          pathGroups: [
            {
              pattern: 'node:*',
              group: 'builtin',
              position: 'before'
            }
          ],
          pathGroupsExcludedImportTypes: ['builtin'],
          'newlines-between': 'always',
          alphabetize: {
            order: 'asc',
            caseInsensitive: true
          }
        }
      ],
      'import/no-cycle': 'error',
      'import/no-self-import': 'error',

      // Prettier reads from .prettierrc; no inline options to avoid conflicts.
      'prettier/prettier': 'error'
    }
  },

  // Node.js scripts, plain ESM, no TypeScript parser needed
  {
    files: ['scripts/**/*.mjs', 'scripts/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node
      }
    },
    rules: {
      'no-eval': 'error',
      'no-new-func': 'error',
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'crypto', message: "Use 'node:crypto' with the node: prefix instead." },
            { name: 'bcrypt', message: 'Use node:crypto scrypt instead.' },
            { name: 'argon2', message: 'Use node:crypto scrypt instead.' },
            { name: 'uuid', message: 'Use crypto.randomUUID() from node:crypto instead.' },
            { name: 'nanoid', message: 'Use crypto.randomBytes() from node:crypto instead.' },
            { name: 'crypto-js', message: 'Use node:crypto instead.' }
          ]
        }
      ]
    }
  },

  // Config files (tsup.config.ts, jest.config.ts, etc.), TS parser, no type-aware project
  {
    files: ['*.config.ts', '*.config.mjs', '*.config.js'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module'
      },
      globals: {
        ...globals.node
      }
    },
    rules: {
      'no-eval': 'error',
      'no-new-func': 'error',
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'crypto', message: "Use 'node:crypto' with the node: prefix instead." },
            { name: 'bcrypt', message: 'Use node:crypto scrypt instead.' },
            { name: 'argon2', message: 'Use node:crypto scrypt instead.' },
            { name: 'uuid', message: 'Use crypto.randomUUID() from node:crypto instead.' },
            { name: 'nanoid', message: 'Use crypto.randomBytes() from node:crypto instead.' },
            { name: 'crypto-js', message: 'Use node:crypto instead.' }
          ]
        }
      ]
    }
  },

  // Test files, Jest + Node globals, the rules specs are held to. Covers unit specs
  // (`**/*.spec.ts`), e2e specs (`**/*.e2e-spec.ts`, run under
  // jest.e2e.config.ts from test/e2e/), and the fixtures they share.
  {
    files: [
      '**/*.spec.ts',
      '**/*.test.ts',
      '**/*.e2e-spec.ts',
      '**/__tests__/**/*.ts',
      // Helpers the suites share, outside any spec's own directory.
      'test/*.ts',
      'test/support/**/*.ts'
    ],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: ['./tsconfig.json', './tsconfig.e2e.json'],
        tsconfigRootDir: import.meta.dirname,
        ecmaVersion: 2022,
        sourceType: 'module'
      },
      globals: {
        ...globals.jest,
        ...globals.node
      }
    },
    plugins: {
      '@typescript-eslint': tsPlugin
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }
      ],
      'no-console': 'error',
      // Off for the same reasons as in production code.
      'no-unused-vars': 'off',
      'no-undef': 'off'
    }
  },

  // Prettier disables conflicting formatting rules; must stay last.
  prettierConfig
]
