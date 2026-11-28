/**
 * Asserts that every way this repository starts Jest hands Node `--experimental-vm-modules`.
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

/** A script that runs Jest, by its binary name or by the path to its entry file. */
const RUNS_JEST = /(^|&&|\|\||;)\s*(jest(\s|$)|node\s[^&|;]*jest\/bin\/jest\.js)/

/** Node itself starting Jest, with the flag among the arguments Node receives. */
const FLAGGED = new RegExp(`node(\\s+--\\S+)*\\s+${FLAG}(\\s+--\\S+)*\\s+\\S*jest/bin/jest\\.js`)

const jestScripts = Object.entries(readJson('package.json').scripts).filter(([, command]) =>
  RUNS_JEST.test(command)
)

test('the search finds the scripts that run Jest', () => {
  const names = jestScripts.map(([name]) => name)
  for (const name of ['test', 'test:cov', 'test:cov:all', 'test:e2e', 'test:watch']) {
    assert.ok(names.includes(name), `no Jest invocation found in the "${name}" script`)
  }
})

test('every script that runs Jest passes the flag to Node', () => {
  const missing = jestScripts.filter(([, command]) => !FLAGGED.test(command)).map(([name]) => name)
  assert.deepEqual(missing, [], `these scripts start Jest without ${FLAG}`)
})

test('the Stryker test runner is started with the flag', () => {
  const { testRunnerNodeArgs = [] } = readJson('stryker.config.json')
  assert.ok(testRunnerNodeArgs.includes(FLAG), `testRunnerNodeArgs lacks ${FLAG}`)
})
