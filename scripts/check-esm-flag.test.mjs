/**
 * Pins every `package.json` script that names Jest, and asserts that the Stryker test runner is
 * started with `--experimental-vm-modules`.
 *
 * Layer: repository tooling, run by `lint`.
 *
 * Some dependencies of the suites ship as ES modules only, and Jest loads those only under the flag.
 * A runner that omits it fails while booting an application, and under Stryker that surfaces as a
 * `TypeError` in the `afterAll` of whichever spec tried, not as a module error.
 *
 * The scripts are compared as whole strings and never parsed: reading shell text for unflagged runs
 * accepts whatever the reader does not model. A script that reaches Jest without naming it, through
 * another file, is outside what this sees.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const FLAG = '--experimental-vm-modules'

/** The one way a script starts Jest: Node, its flags, then Jest's entry file. */
const JEST = `node ${FLAG} --disable-warning=ExperimentalWarning node_modules/jest/bin/jest.js`

/** Every script that names Jest, in full. A change to any of them is made here too. */
const PINNED = {
  test: JEST,
  'test:cov': `${JEST} --coverage`,
  'test:cov:all': `${JEST} --config jest.coverage.config.ts --coverage`,
  'test:e2e': `${JEST} --config jest.e2e.config.ts`,
  'test:watch': `${JEST} --watch`
}

/** The JSON at `path`, relative to the repository root. */
const readJson = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'))

test('the scripts that name Jest are exactly the pinned, flagged ones', () => {
  const named = Object.entries(readJson('package.json').scripts).filter(([, script]) =>
    /jest/i.test(script)
  )
  assert.deepEqual(Object.fromEntries(named), PINNED)
})

test('the Stryker test runner is started with the flag', () => {
  const { testRunnerNodeArgs = [] } = readJson('stryker.config.json')
  assert.ok(testRunnerNodeArgs.includes(FLAG), `testRunnerNodeArgs lacks ${FLAG}`)
})
