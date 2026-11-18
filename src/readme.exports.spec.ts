/**
 * Unit tests for the completeness of the README against the public surface.
 *
 * Layer: unit.
 * Goal: every export of every public subpath, read from the barrel through the compiler, is named in
 * the README, so an export cannot ship that a consumer has no way to learn about.
 * Mocks: none; the barrels are read with the TypeScript compiler API.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as ts from 'typescript'

const ROOT = join(__dirname, '..')
const README = readFileSync(join(ROOT, 'README.md'), 'utf8')
const PACKAGE = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
  exports: Record<string, unknown>
}

/** The public subpaths, each with the source barrel that builds it. */
const SUBPATHS = Object.keys(PACKAGE.exports)
  .filter((subpath) => subpath !== './package.json')
  .map(
    (subpath) =>
      [subpath, subpath === '.' ? 'src/index.ts' : `src${subpath.slice(1)}/index.ts`] as const
  )

/** The names a barrel exports, values and types alike. */
function exportsOf(barrel: string): string[] {
  const program = ts.createProgram([join(ROOT, barrel)], {
    strict: true,
    skipLibCheck: true,
    experimentalDecorators: true,
    emitDecoratorMetadata: true,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022
  })
  const checker = program.getTypeChecker()
  const source = program.getSourceFile(join(ROOT, barrel))
  const symbol = source === undefined ? undefined : checker.getSymbolAtLocation(source)
  return symbol === undefined ? [] : checker.getExportsOfModule(symbol).map((entry) => entry.name)
}

describe('every export of a public subpath is named in the README', () => {
  it.each(SUBPATHS)('%s (%s)', (_subpath, barrel) => {
    const names = exportsOf(barrel)
    expect(names.length).toBeGreaterThan(0)
    const missing = names.filter((name) => !new RegExp(`\\b${name}\\b`).test(README))
    expect(missing).toEqual([])
  })
})
