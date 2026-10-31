/**
 * Unit tests pinning the README's option tables to the real defaults.
 *
 * Layer: unit.
 * Goal: parse every option table under the README's Configuration section and
 * prove each documented default equals the value `DEFAULT_CORE_OPTIONS`
 * resolves, and that no resolved option is missing from its table. The
 * published README is what consumers read; a default that drifts from the code
 * must fail here rather than ship.
 * Mocks: none (reads README.md from the repository root).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { DEFAULT_CORE_OPTIONS } from './core.options'

/** A documented default that means "no default": the option is absent unless set. */
const UNSET = Symbol('unset')

/** Resolved fields that exist for the bootstrap helper and are not consumer options. */
const NOT_AN_OPTION: Readonly<Record<string, readonly string[]>> = {
  openapi: ['suppressedInProduction']
}

/** One parsed table row: where it sits, and the default the README states. */
interface DocumentedDefault {
  readonly block: string
  readonly option: string
  readonly cell: string
}

const README = readFileSync(join(__dirname, '..', 'README.md'), 'utf8')

/** The Configuration section only, so a table elsewhere cannot be mistaken for it. */
function configurationSection(): string {
  const start = README.indexOf('\n## ⚙️ Configuration')
  const end = README.indexOf('\n## ', start + 1)
  return README.slice(start, end)
}

/** Every `| \`option\` | type | default | ... |` row, tagged with its `### \`block\`` heading. */
function documentedDefaults(): DocumentedDefault[] {
  const rows: DocumentedDefault[] = []
  let block = ''
  for (const line of configurationSection().split('\n')) {
    const heading = /^### `([A-Za-z]+)`/.exec(line)
    if (heading?.[1] !== undefined) {
      block = heading[1]
      continue
    }
    const row = /^\| `([A-Za-z]+)`\s*\|[^|]*\|([^|]*)\|/.exec(line)
    if (block !== '' && row?.[1] !== undefined && row[2] !== undefined) {
      rows.push({ block, option: row[1], cell: row[2].trim() })
    }
  }
  return rows
}

/** Turn a default cell into the value it states; an unfamiliar form fails loudly. */
function parseDefault(cell: string): unknown {
  const text = cell.replace(/^[_`(]+|[_`)]+$/g, '')
  if (text === 'unset' || text === 'peer default') return UNSET
  if (text === 'true') return true
  if (text === 'false') return false
  if (text === '{}') return {}
  if (text === '[]') return []
  if (/^-?\d+$/.test(text)) return Number(text)
  const quoted = /^'(.*)'$/.exec(text)
  if (quoted?.[1] !== undefined) return quoted[1]
  throw new Error(`README default cell not understood by this test: ${cell}`)
}

/** Narrow a resolved value to an object whose keys can be listed. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

const RESOLVED: Record<string, unknown> = Object.fromEntries(Object.entries(DEFAULT_CORE_OPTIONS))

describe('README option tables', () => {
  const documented = documentedDefaults()

  /**
   * The parser found the tables.
   *
   * A parser that matches nothing would make every other case vacuously pass,
   * so the blocks and a floor on the row count are asserted first.
   */
  it('finds a table for every configuration block', () => {
    const blocks = new Set(documented.map((row) => row.block))

    expect([...blocks].sort()).toEqual(
      ['envelope', 'environment', 'health', 'metrics', 'openapi', 'telemetry', 'timing'].sort()
    )
    expect(documented.length).toBeGreaterThanOrEqual(25)
  })

  /**
   * Every documented default is the real one.
   *
   * Each row's default cell is parsed and compared with the value the resolver
   * produces for that option; an option with no default must be absent.
   */
  it.each(documented)('documents the real default of $block.$option', ({ block, option, cell }) => {
    const expected = parseDefault(cell)
    const resolved = block === 'environment' ? RESOLVED : RESOLVED[block]
    const actual = isRecord(resolved) ? resolved[option] : undefined

    if (expected === UNSET) {
      expect(actual).toBeUndefined()
    } else {
      expect(actual).toEqual(expected)
    }
  })

  /**
   * No resolved option goes undocumented.
   *
   * The reverse direction: a field the resolver always sets must have a row,
   * apart from the fields that are not consumer options.
   */
  it.each(Object.keys(RESOLVED))('documents every resolved option of %s', (block) => {
    const resolved = RESOLVED[block]
    const options = isRecord(resolved) ? Object.keys(resolved) : []
    const rows = new Set(documented.filter((row) => row.block === block).map((row) => row.option))
    const hidden = NOT_AN_OPTION[block] ?? []

    expect(options.filter((option) => !rows.has(option) && !hidden.includes(option))).toEqual([])
  })
})
