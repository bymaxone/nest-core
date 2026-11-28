/**
 * Asserts that every `package.json` script running Jest, and the Stryker test runner, hand Node
 * `--experimental-vm-modules`.
 *
 * Layer: repository tooling, run by `lint`.
 *
 * Some dependencies of the suites ship as ES modules only, and Jest loads those only under the flag.
 * A runner that omits it fails while booting an application, and under Stryker that surfaces as a
 * `TypeError` in the `afterAll` of whichever spec tried, not as a module error.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const FLAG = '--experimental-vm-modules'

/** The JSON at `path`, relative to the repository root. */
const readJson = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'))

/** Where one command of a script ends and the next begins. */
const SEPARATORS = /&&|\|\||[;|&()<>]/

/** A word naming Jest's binary or entry file, whatever starts it: `jest`, `.../jest.js`. */
const IS_JEST = /(^|\/)jest(\.js|\.cmd|@[\w.^~-]+)?$/

/** The words of each command in `script`, without surrounding quotes. */
const commandsOf = (script) =>
  script.split(SEPARATORS).map((command) => command.replace(/['"]/g, '').trim().split(/\s+/))

/** Whether Node itself starts Jest's entry file here, with the flag among Node's own arguments. */
function isFlagged(words) {
  const jest = words.findIndex((word) => IS_JEST.test(word))
  const node = words.indexOf('node')
  if (node === -1 || node > jest || !words.at(jest).endsWith('jest/bin/jest.js')) return false
  const nodeArguments = words.slice(node + 1, jest)
  return nodeArguments.includes(FLAG) && nodeArguments.every((word) => word.startsWith('--'))
}

/** Whether any command of `script` starts Jest. */
const runsJest = (script) => commandsOf(script).some((words) => words.some((w) => IS_JEST.test(w)))

/** Whether any command of `script` starts Jest other than through Node with the flag. */
const hasUnflaggedRun = (script) =>
  commandsOf(script).some((words) => words.some((w) => IS_JEST.test(w)) && !isFlagged(words))

const scripts = Object.entries(readJson('package.json').scripts)

const FLAGGED_RUN = `node ${FLAG} node_modules/jest/bin/jest.js`

test('a Jest run is reported unless Node starts it with the flag before the entry file', () => {
  const unflagged = [
    'jest',
    'node node_modules/jest/bin/jest.js --coverage',
    'pnpm exec jest --ci',
    'npx jest',
    'CI=1 jest',
    'cross-env CI=1 jest',
    'node_modules/.bin/jest --watch',
    "sh -c 'jest'",
    'npx jest@30',
    'node_modules/.bin/jest.cmd',
    '(jest)',
    'jest>log.txt',
    `node node_modules/jest/bin/jest.js ${FLAG}`,
    `node wrapper.js ${FLAG} node_modules/jest/bin/jest.js`,
    `${FLAGGED_RUN} && jest --config jest.e2e.config.ts`,
    `${FLAGGED_RUN}; npx jest`,
    `tsc --noEmit | ${FLAGGED_RUN} || jest`
  ]
  assert.deepEqual(
    unflagged.filter((command) => !hasUnflaggedRun(command)),
    []
  )
})

test('a flagged run, and a command that only names Jest in a file, are accepted', () => {
  const accepted = [
    FLAGGED_RUN,
    `CI=1 node --disable-warning=ExperimentalWarning ${FLAG} node_modules/jest/bin/jest.js --config jest.e2e.config.ts`,
    `${FLAGGED_RUN} && ${FLAGGED_RUN} --coverage`,
    'node --test scripts/check-jest-esm-flag.test.mjs',
    'eslint jest.config.ts'
  ]
  assert.deepEqual(accepted.filter(hasUnflaggedRun), [])
})

test('the search finds the scripts that run Jest', () => {
  const names = scripts.filter(([, command]) => runsJest(command)).map(([name]) => name)
  for (const name of ['test', 'test:cov', 'test:cov:all', 'test:e2e', 'test:watch']) {
    assert.ok(names.includes(name), `no Jest invocation found in the "${name}" script`)
  }
})

test('every script that runs Jest passes the flag to Node', () => {
  const missing = scripts.filter(([, command]) => hasUnflaggedRun(command)).map(([name]) => name)
  assert.deepEqual(missing, [], `these scripts start Jest without ${FLAG}`)
})

test('the Stryker test runner is started with the flag', () => {
  const { testRunnerNodeArgs = [] } = readJson('stryker.config.json')
  assert.ok(testRunnerNodeArgs.includes(FLAG), `testRunnerNodeArgs lacks ${FLAG}`)
})
