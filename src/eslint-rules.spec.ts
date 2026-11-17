/**
 * Pins `scripts/eslint-max-unit-lines.mjs`, the rule behind the 50-line function limit, and
 * `scripts/eslint-file-header.mjs`, the rule behind the header every file opens with. Both are
 * plain ESM, so the suite runs the real ESLint over fixture files in a throwaway directory and reads
 * the messages it prints for each.
 *
 * Layer: repository tooling, tests.
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const REPO = resolve(__dirname, '..')
const RULE = pathToFileURL(join(REPO, 'scripts', 'eslint-max-unit-lines.mjs')).href
const PARSER = pathToFileURL(
  join(REPO, 'node_modules', '@typescript-eslint', 'parser', 'dist', 'index.js')
).href
const HEADER_RULE = pathToFileURL(join(REPO, 'scripts', 'eslint-file-header.mjs')).href
const ESLINT = join(REPO, 'node_modules', 'eslint', 'bin', 'eslint.js')

/** A function declaration `name` of exactly `total` physical lines. */
const fn = (name: string, total: number): string =>
  `function ${name}() {\n${'  void 0\n'.repeat(total - 2)}}\n`

/** A `describe` whose callback is `total` lines long, around one short test. */
const group = (total: number): string =>
  `describe('g', () => {\n${'  // x\n'.repeat(total - 3)}  it('t', () => {})\n})\n`

const FIXTURES: Record<string, string> = {
  'at-limit.ts': fn('atLimit', 50),
  'over-limit.ts': fn('overLimit', 51),
  'group.ts': group(200),
  'long-it.ts': `describe('g', () => {\n  it('long', () => {\n${'    void 0\n'.repeat(50)}  })\n})\n`,
  'long-each.ts': `describe.each([1])('g', () => {\n${'  // x\n'.repeat(80)}})\n`,
  'nested.ts': `function outer() {\n  const inner = () => {\n${'    void 0\n'.repeat(60)}  }\n  return inner\n}\n`,
  'twice.ts': `${fn('same', 10)}${fn('same', 60)}`,
  'listed-exact.ts': fn('listed', 60),
  'listed-grown.ts': fn('grown', 70),
  'listed-shrunk.ts': fn('shrunk', 55),
  'listed-fixed.ts': fn('fixed', 10),
  'listed-gone.ts': 'export const x = 1\n'
}

const BASELINE = {
  functions: {
    'listed-exact.ts': { listed: 60 },
    'listed-grown.ts': { grown: 60 },
    'listed-shrunk.ts': { shrunk: 60 },
    'listed-fixed.ts': { fixed: 60 },
    'listed-gone.ts': { vanished: 60 },
    'twice.ts': { 'same #2': 60 }
  }
}

const roots: string[] = []

/** Runs the real ESLint with `rules` over `fixtures` and returns the messages for each file. */
function lint(fixtures: Record<string, string>, rules: string): Map<string, string[]> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'repo-rules-spec-')))
  roots.push(root)
  for (const [name, text] of Object.entries(fixtures)) writeFileSync(join(root, name), text)
  writeFileSync(
    join(root, 'eslint.config.mjs'),
    `import parser from ${JSON.stringify(PARSER)}
import header from ${JSON.stringify(HEADER_RULE)}
import unit from ${JSON.stringify(RULE)}
export default [{
  files: ['*.ts'],
  languageOptions: { parser },
  plugins: { bymax: { rules: { unit, header } } },
  rules: ${rules}
}]
`
  )
  const run = spawnSync(process.execPath, [ESLINT, '-f', 'json', ...Object.keys(fixtures)], {
    cwd: root,
    encoding: 'utf8'
  })
  const report = JSON.parse(run.stdout) as { filePath: string; messages: { message: string }[] }[]
  return new Map(
    report.map((file) => [
      file.filePath.slice(root.length + 1),
      file.messages.map((m) => m.message)
    ])
  )
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

let messages = new Map<string, string[]>()

beforeAll(() => {
  messages = lint(
    FIXTURES,
    `{ 'bymax/unit': ['error', { baseline: ${JSON.stringify(BASELINE)} }] }`
  )
})

/** What the rule said about one fixture. */
const said = (name: string): string[] => messages.get(name) ?? ['<fixture was not linted>']

describe('max-unit-lines', () => {
  /**
   * The limit is 50 physical lines, inclusive.
   *
   * 50 passes and 51 fails, so the boundary is the one AGENTS.md states.
   */
  it('accepts 50 lines and refuses 51', () => {
    expect(said('at-limit.ts')).toEqual([])
    expect(said('over-limit.ts')).toEqual([
      'overLimit has 51 lines, over the limit of 50. Split it by responsibility.'
    ])
  })

  /**
   * A grouping call's callback is a table of cases, and a test body is a function.
   *
   * A 200-line `describe` and a `describe.each` pass; the same file with a 52-line `it` fails.
   */
  it('exempts the callback of describe and counts the body of an it', () => {
    expect(said('group.ts')).toEqual([])
    expect(said('long-each.ts')).toEqual([])
    expect(said('long-it.ts')).toEqual([
      '(anonymous) has 52 lines, over the limit of 50. Split it by responsibility.'
    ])
  })

  /**
   * Names chain through the named functions around a function and number repeats.
   *
   * The baseline can only address a function by that name, so it is part of the contract.
   */
  it('names a nested function by its chain and numbers a repeated name', () => {
    expect(said('nested.ts')).toEqual([
      'outer has 65 lines, over the limit of 50. Split it by responsibility.',
      'outer > inner has 62 lines, over the limit of 50. Split it by responsibility.'
    ])
    expect(said('twice.ts')).toEqual([])
  })

  /**
   * The baseline admits what it records and nothing else, from both sides.
   *
   * Exactly at its record passes; growth, a smaller length still over the limit, a function now
   * under the limit and a function that is gone each fail with the entry to change.
   */
  it('holds the baseline to the recorded length in both directions', () => {
    expect(said('listed-exact.ts')).toEqual([])
    expect(said('listed-grown.ts')).toEqual([
      'grown has 70 lines, above the 60 recorded in the baseline.'
    ])
    expect(said('listed-shrunk.ts')).toEqual([
      'shrunk has 55 lines and is recorded at 60: lower its baseline entry.'
    ])
    expect(said('listed-fixed.ts')).toEqual([
      'fixed is recorded at 60 lines but is not over the limit of 50 (or is gone): remove its baseline entry.'
    ])
    expect(said('listed-gone.ts')).toEqual([
      'vanished is recorded at 60 lines but is not over the limit of 50 (or is gone): remove its baseline entry.'
    ])
  })
})

describe('file-header', () => {
  const body = 'export const x = 1\n'.repeat(12)
  const headers: Record<string, string> = {
    'tag.ts': `/**\n * Purpose.\n * @layer util\n */\n${body}`,
    'line.ts': `/**\n * Purpose.\n *\n * Layer: unit.\n */\n${body}`,
    'none.ts': body,
    'plain-block.ts': `/* Layer: unit */\n${body}`,
    'line-comment.ts': `// Layer: unit\n${body}`,
    'no-layer.ts': `/**\n * Purpose only.\n */\n${body}`,
    'after-code.ts': `${body}/**\n * @layer util\n */\n`,
    'tiny.ts': 'export const x = 1\n'
  }
  const FAILS =
    'The file must open with a `/** ... */` header that states its layer (`@layer` or `Layer:`).'
  let said = new Map<string, string[]>()

  beforeAll(() => {
    said = lint(headers, "{ 'bymax/header': 'error' }")
  })

  /**
   * A header naming the layer passes, in either of the two spellings the repository uses.
   *
   * The tag and the `Layer:` line both satisfy the rule; a file under ten lines is exempt.
   */
  it('accepts a header with @layer or a Layer: line, and a trivial file', () => {
    expect(said.get('tag.ts')).toEqual([])
    expect(said.get('line.ts')).toEqual([])
    expect(said.get('tiny.ts')).toEqual([])
  })

  /**
   * Anything else fails: no header, a header that is not a doc block, one without a layer, or one
   * that comes after code.
   */
  it('refuses a missing, plain, layerless or late header', () => {
    for (const name of [
      'none.ts',
      'plain-block.ts',
      'line-comment.ts',
      'no-layer.ts',
      'after-code.ts'
    ]) {
      expect([name, said.get(name)]).toEqual([name, [FAILS]])
    }
  })
})
