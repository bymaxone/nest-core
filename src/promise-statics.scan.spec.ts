/**
 * Tests for the rule that no `Promise` static is read in this package's source.
 *
 * Layer: unit.
 * Goal: no non-spec file under `src` reaches a `Promise` static (by dot, bracket, alias, destructuring,
 * `globalThis` or `.call`) builds one with `new Promise`, or attaches `.then`, `.catch` or `.finally`, except at the sites listed here
 * with the reason each may. A verdict that reads one can be answered by a function a host planted after load.
 * Mocks: none; reads the tracked source files.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(__dirname, '..')
/** What reaches a `Promise` static, or a public `then`, `catch` or `finally` that a host can replace. */
const REACH = new RegExp(
  [
    String.raw`\bPromise\s*(?:\?\.|\.|\[)`,
    String.raw`[=(,]\s*Promise\b(?!\s*[<(.\[])`,
    String.raw`\bglobalThis\b[^\n]*\bPromise\b`,
    String.raw`\.\s*(?:then|catch|finally)\s*\(`,
    String.raw`\bthen\s*\.\s*(?:call|apply|bind)\b`,
    String.raw`\bnew\s+Promise\b`
  ].join('|')
)

/** The sites that may match, each as `file` plus the line's text, with why it cannot reach a verdict. */
const EXEMPT: ReadonlyArray<{ file: string; line: string; why: string }> = [
  {
    file: 'src/passthrough.providers.ts',
    line: 'this.delegate.catch(exception, host)',
    why: 'an exception filter’s `catch`, not a promise'
  }
]

/** The text of `source` with comments and string literals blanked, keeping line numbers. */
function code(source: string): string {
  return source.replace(
    /\/\*[\s\S]*?\*\/|\/\/[^\n]*|`(?:\\[\s\S]|[^`\\])*`|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"/g,
    (match) => match.replace(/[^\n]/g, ' ')
  )
}

/** Tracked non-spec TypeScript under `src`. */
function sources(): string[] {
  return execFileSync('git', ['ls-files', 'src'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter(
      (file) =>
        file.endsWith('.ts') &&
        !file.endsWith('.spec.ts') &&
        !file.includes('/__tests__/') &&
        !file.endsWith('.d.ts')
    )
}

/** `file:line` of every line of `source` the scan matches that no exemption names. */
function reached(file: string, source: string): string[] {
  return code(source)
    .split('\n')
    .flatMap((text, index) =>
      REACH.test(text) && !EXEMPT.some((site) => site.file === file && site.line === text.trim())
        ? [`${file}:${index + 1}`]
        : []
    )
}

describe('Promise statics in src', () => {
  it('are reached nowhere outside the listed sites', () => {
    const found = sources().flatMap((file) =>
      reached(file, readFileSync(resolve(ROOT, file), 'utf8'))
    )

    expect(found).toEqual([])
  })

  it('keeps every exemption on a line that still matches, so a stale one hides nothing', () => {
    const stale = EXEMPT.filter((site) =>
      code(readFileSync(resolve(ROOT, site.file), 'utf8'))
        .split('\n')
        .every((text) => text.trim() !== site.line || !REACH.test(text))
    )

    expect(stale).toEqual([])
  })

  it.each([
    'const a = Promise.race([x])',
    'const a = Promise . all ( [x] )',
    "const a = Promise['race']([x])",
    'const a = Promise?.resolve(x)',
    'const { race } = Promise',
    'const P = Promise\n',
    'const a = globalThis.Promise',
    'const a = Promise.try(() => x)',
    'const a = Promise.withResolvers()',
    'work().then(a)',
    'work().catch(a)',
    'work().finally(a)',
    'then.call(x, a, b)',
    'const r = race.call(Promise, [x])',
    'const p = new Promise(() => {})',
    'return new Promise<string>((r) => r(x))',
    'await new Promise(() => {})'
  ])('matches %s', (line) => {
    expect(REACH.test(code(line))).toBe(true)
  })

  it.each([
    '// Promise.resolve(x)',
    'const s = "Promise.race("',
    'async function f(): Promise<void> {}',
    'const p: Promise<string> = work()',
    'await work()'
  ])('does not match %s', (line) => {
    expect(REACH.test(code(line))).toBe(false)
  })
})
