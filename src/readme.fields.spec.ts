/**
 * Unit tests for the completeness of the README against the fields of the public interfaces.
 *
 * Layer: unit.
 * Goal: every field of every interface a public subpath exports, read through the compiler, is named
 * in the README, so a consumer can learn the shape of a result or a contract from the documentation.
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

/** The `Interface.field` of every interface a barrel exports. */
function interfaceFieldsOf(barrel: string): string[] {
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
  const exported = symbol === undefined ? [] : checker.getExportsOfModule(symbol)
  return exported.flatMap((entry) => {
    const target =
      (entry.flags & ts.SymbolFlags.Alias) === 0 ? entry : checker.getAliasedSymbol(entry)
    if ((target.flags & ts.SymbolFlags.Interface) === 0) return []
    return Array.from(target.members?.values() ?? [])
      .filter((member) => (member.flags & (ts.SymbolFlags.Property | ts.SymbolFlags.Method)) !== 0)
      .map((member) => `${entry.name}.${member.name}`)
  })
}

describe('every field of an exported interface is named in the README', () => {
  it.each(SUBPATHS)('%s (%s)', (_subpath, barrel) => {
    const fields = interfaceFieldsOf(barrel)
    const missing = fields.filter((field) => {
      const name = field.slice(field.indexOf('.') + 1)
      return !new RegExp(`\\b${name}\\b`).test(README)
    })
    expect(missing).toEqual([])
  })

  it('reads the fields of an interface the root barrel exports', () => {
    expect(interfaceFieldsOf('src/index.ts')).toContain('ITraceContextProvider.getTraceContext')
    expect(interfaceFieldsOf('src/pagination/index.ts')).toContain('PageMeta.totalItems')
  })
})
