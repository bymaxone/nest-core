/**
 * Unit tests pinning the README's error-code catalog and contract version to the code.
 *
 * Layer: unit.
 * Goal: prove every code constant the package exports has a row in the README's
 * catalog, that each row names the status `codeForStatus` really maps to it, and
 * that the README states the OpenAPI contract version the package really speaks.
 * Mocks: none (reads README.md from the repository root).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import * as core from './index'
import { BYMAX_OPENAPI_CONTRACT_VERSION } from './openapi'

const README = readFileSync(join(__dirname, '..', 'README.md'), 'utf8')

/** One catalog row: the constant's name and the status cell as written. */
interface CatalogRow {
  readonly name: string
  readonly status: string
}

/** The catalog only: from its lead sentence to the line naming `codeForStatus`, so the
 * DI-token table, whose rows also start with a `BYMAX_` name, is not read as codes. */
function catalogSection(): string {
  const start = README.indexOf('Every code the package assigns')
  const end = README.indexOf('`codeForStatus(status)` returns', start)
  return README.slice(start, end)
}

/** Every `| \`BYMAX_X\` | status | ... |` row of the catalog. */
function catalogRows(): CatalogRow[] {
  return [...catalogSection().matchAll(/^\| `(BYMAX_[A-Z_]+)`\s*\|\s*([^|]+?)\s*\|/gm)].flatMap(
    (match) =>
      match[1] !== undefined && match[2] !== undefined ? [{ name: match[1], status: match[2] }] : []
  )
}

/** The exported error-code constants: string values named `BYMAX_*` (tokens are symbols). */
function exportedCodes(): Record<string, string> {
  const codes: Record<string, string> = {}
  for (const [name, value] of Object.entries(core)) {
    if (name.startsWith('BYMAX_') && typeof value === 'string') codes[name] = value
  }
  return codes
}

describe('README error-code catalog', () => {
  const rows = catalogRows()
  const codes = exportedCodes()

  /**
   * The parser found the catalog.
   *
   * A parser that matches nothing would make the cases below vacuously pass, so
   * a floor on the row count is asserted first.
   */
  it('finds a row for every code the package exports', () => {
    expect(Object.keys(codes).length).toBeGreaterThanOrEqual(16)
    expect(rows.length).toBeGreaterThanOrEqual(Object.keys(codes).length)
  })

  /**
   * No exported code goes undocumented.
   *
   * The reverse direction: a constant added to the barrel must get a README row.
   */
  it('documents every exported code constant', () => {
    const documented = new Set(rows.map((row) => row.name))

    expect(Object.keys(codes).filter((name) => !documented.has(name))).toEqual([])
  })

  /**
   * Every documented code is a real one, with the status it maps from.
   *
   * A row names an exported constant, and a row with a numeric status is the code
   * `codeForStatus` returns for that status. `BYMAX_VALIDATION_FAILED` shares status
   * 400 with the bad-request code: it is chosen by the shape of the body, not by the
   * status, so it is the one row `codeForStatus` cannot confirm.
   */
  it.each(rows)('documents $name with its real status', ({ name, status }) => {
    expect(codes[name]).toBe(name)
    if (/^\d{3}$/.test(status) && name !== 'BYMAX_VALIDATION_FAILED') {
      expect(core.codeForStatus(Number(status))).toBe(codes[name])
    }
  })
})

describe('README OpenAPI contract version', () => {
  /**
   * The README states the version the package speaks.
   *
   * Every README line naming the constant together with "currently `N`" must
   * agree with `BYMAX_OPENAPI_CONTRACT_VERSION`.
   */
  it('states the contract version the package exports', () => {
    const stated = README.split('\n')
      .filter((line) => line.includes('BYMAX_OPENAPI_CONTRACT_VERSION'))
      .flatMap((line) => [...line.matchAll(/currently `(\d+)`/g)].map((match) => Number(match[1])))

    expect(stated.length).toBeGreaterThanOrEqual(1)
    expect(stated.every((version) => version === BYMAX_OPENAPI_CONTRACT_VERSION)).toBe(true)
  })
})
