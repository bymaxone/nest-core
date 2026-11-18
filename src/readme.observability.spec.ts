/**
 * Unit tests for the completeness of the observability catalogs in the README.
 *
 * Layer: unit.
 * Goal: every event code the source writes, and every metric it registers, is named in the README, and
 * every code the README lists exists in the source, so neither catalog drifts from the code.
 * Mocks: none; the source files are read from disk.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..')
const README = readFileSync(join(ROOT, 'README.md'), 'utf8')

/** Every non-test source file under `dir`. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) return entry === '__tests__' ? [] : sourceFiles(path)
    return path.endsWith('.ts') && !path.endsWith('.spec.ts') ? [path] : []
  })
}

const SOURCE = sourceFiles(join(ROOT, 'src'))
  .map((file) => readFileSync(file, 'utf8'))
  .join('\n')

describe('the log-event catalog', () => {
  const written = new Set(
    [...SOURCE.matchAll(/\[(CORE_[A-Z_]+)\]/g)].map((match) => match[1] as string)
  )
  const listed = new Set(
    [...README.matchAll(/`\[(CORE_[A-Z_]+)\]`/g)].map((match) => match[1] as string)
  )

  it('names every code the source writes', () => {
    expect(written.size).toBeGreaterThan(0)
    expect([...written].filter((code) => !listed.has(code))).toEqual([])
  })

  it('lists only codes the source writes', () => {
    expect([...listed].filter((code) => !written.has(code))).toEqual([])
  })
})

describe('the metrics catalog', () => {
  it.each(['http_requests_total', 'http_request_duration_seconds', 'bymax_core_health_status'])(
    'names the registered metric %s',
    (name) => {
      expect(SOURCE).toContain(`'${name}'`)
      expect(README).toContain(`\`${name}\``)
    }
  )
})
