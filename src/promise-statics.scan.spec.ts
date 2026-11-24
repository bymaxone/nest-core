/**
 * Tests for the rule that no `Promise` static is read in this package's source.
 *
 * Layer: unit.
 * Goal: no non-spec file under `src` calls `Promise.race`, `all`, `allSettled`, `any`, `resolve` or
 * `reject`, except the files listed here with the reason each may. A verdict that reads a static can be
 * answered by a function a host planted after load.
 * Mocks: none; reads the tracked source files.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(__dirname, '..')
const STATIC_CALL = /\bPromise\s*\.\s*(race|all|allSettled|any|resolve|reject|withResolvers)\s*\(/

/** The files that may call a static, each with why it cannot reach a verdict. */
const EXEMPT: Readonly<Record<string, string>> = {
  'src/contain-rejection.ts':
    'attaches a failure handler to what a sink returned and reads no result from it; a forged resolve ' +
    'leaves that sink’s own rejection unhandled and decides nothing'
}

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

describe('Promise statics in src', () => {
  it('are called nowhere outside the listed exemptions', () => {
    const found = sources().filter(
      (file) =>
        STATIC_CALL.test(code(readFileSync(resolve(ROOT, file), 'utf8'))) && !(file in EXEMPT)
    )

    expect(found).toEqual([])
  })

  it('keeps every exemption in use, so a stale one does not hide the next caller', () => {
    const used = Object.keys(EXEMPT).filter((file) =>
      STATIC_CALL.test(code(readFileSync(resolve(ROOT, file), 'utf8')))
    )

    expect(used).toEqual(Object.keys(EXEMPT))
  })

  it('finds a call in a source it is given, and not one in a comment or a string', () => {
    expect(STATIC_CALL.test(code('const a = Promise.race([x])'))).toBe(true)
    expect(STATIC_CALL.test(code('const a = Promise . all ( [x] )'))).toBe(true)
    expect(STATIC_CALL.test(code('// Promise.resolve(x)\nconst s = "Promise.race("'))).toBe(false)
  })
})
