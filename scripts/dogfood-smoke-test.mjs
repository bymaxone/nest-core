#!/usr/bin/env node
/**
 * Dogfood smoke test, validates the published package shape before tagging.
 *
 * What this script validates:
 *   1. Build artifacts exist for every subpath (ESM, CJS, .d.ts, .d.cts)
 *   2. ESM import resolves and exposes every expected named export
 *   3. CJS require resolves and exposes every expected named export
 *   4. The tarball contains only dist/ + meta files (the listing of `PACKAGE_TARBALL`, or an
 *      `npm pack --dry-run` of the working tree without it)
 *   5. Scaffolds a minimal consumer in an OS temp dir (os.tmpdir()), installs the tarball (or,
 *      without `PACKAGE_TARBALL`, the working tree) via a file: link with `--ignore-scripts`, and
 *      verifies the package resolves from the consumer side through its published `exports` map
 *
 * Exit codes:
 *   0, all assertions pass
 *   1, one or more assertions failed (details printed to stderr)
 *   2, build artifacts missing (run `pnpm build` first)
 *
 * Usage:
 *   pnpm build && node scripts/dogfood-smoke-test.mjs
 *   PACKAGE_TARBALL=/path/to/package.tgz node scripts/dogfood-smoke-test.mjs
 */

import { execFileSync, execSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const req = createRequire(import.meta.url)

// `PACKAGE_TARBALL` names the tarball a release gate has already packed: the package is inspected
// from that file and installed by the consumer from it, not read from the working tree. Without it
// the script inspects `dist/` and packs the working tree, for a run on a developer machine.
const TARBALL = process.env['PACKAGE_TARBALL'] ?? ''
let packageRoot = ROOT
if (TARBALL !== '') {
  // Inside the repository, so Node resolves the peer dependencies from its `node_modules`. It is
  // removed when the process exits, whatever the exit code.
  const extracted = mkdtempSync(join(ROOT, '.dogfood-package-'))
  process.on('exit', () => rmSync(extracted, { recursive: true, force: true }))
  execFileSync('tar', ['-xzf', TARBALL, '-C', extracted, '--strip-components=1'])
  packageRoot = extracted
}

// Each subpath's dist basename, its import specifier, and its expected named
// exports. The barrels ship empty at scaffold time (`export {}`); later
// phases append real names here as the feature surface lands.
const SUBPATHS = [
  { label: '. (root)', distName: 'index', specifier: '@bymax-one/nest-core', exports: [] },
  {
    label: './pagination',
    distName: 'pagination/index',
    specifier: '@bymax-one/nest-core/pagination',
    exports: [
      'normalizePageQuery',
      'buildPageResult',
      'normalizeCursorQuery',
      'buildCursorResult',
      'encodeCursor',
      'decodeCursor'
    ]
  },
  {
    label: './health',
    distName: 'health/index',
    specifier: '@bymax-one/nest-core/health',
    exports: ['BymaxHealthIndicator', 'BYMAX_HEALTH_INDICATOR_METADATA']
  },
  {
    label: './openapi',
    distName: 'openapi/index',
    specifier: '@bymax-one/nest-core/openapi',
    exports: ['applyBymaxOpenApi']
  },
  {
    label: './http',
    distName: 'http/index',
    specifier: '@bymax-one/nest-core/http',
    exports: ['applyHttpFloors']
  },
  {
    label: './metrics',
    distName: 'metrics/index',
    specifier: '@bymax-one/nest-core/metrics',
    exports: ['BymaxMetricsContributor', 'BYMAX_METRICS_CONTRIBUTOR_METADATA']
  }
]

const ALLOWED_TARBALL_PATHS = ['package.json', 'README.md', 'CHANGELOG.md', 'LICENSE', 'dist/']

let failures = 0
let consumerDir

function fail(msg) {
  console.error(`  FAIL: ${msg}`)
  failures++
}

function pass(msg) {
  console.log(`  PASS: ${msg}`)
}

function section(title) {
  console.log(`\n-- ${title}`)
}

// -- 1. Build artifact presence ----------------------------------------------

section('1. Build artifacts')
for (const { distName } of SUBPATHS) {
  for (const ext of ['mjs', 'cjs', 'd.ts', 'd.cts']) {
    const rel = `dist/${distName}.${ext}`
    const abs = resolve(packageRoot, rel)
    if (!existsSync(abs)) {
      console.error(`Missing build artifact: ${rel}, run \`pnpm build\` first.`)
      process.exit(2)
    }
    pass(rel)
  }
}

// -- 2. ESM named exports -----------------------------------------------------

section('2. ESM named exports')
for (const { label, distName, exports: expected } of SUBPATHS) {
  const mod = await import(resolve(packageRoot, `dist/${distName}.mjs`))
  for (const name of expected) {
    if (name in mod) {
      pass(`${label}: export ${name}`)
    } else {
      fail(`${label}: missing export ${name}`)
    }
  }
  pass(`${label}: ESM import resolved`)
}

// -- 3. CJS named exports ------------------------------------------------------

section('3. CJS named exports')
for (const { label, distName, exports: expected } of SUBPATHS) {
  const mod = req(resolve(packageRoot, `dist/${distName}.cjs`))
  for (const name of expected) {
    if (name in mod) {
      pass(`${label}: cjs export ${name}`)
    } else {
      fail(`${label}: missing cjs export ${name}`)
    }
  }
  pass(`${label}: CJS require resolved`)
}

// -- 4. Tarball contents -------------------------------------------------------

section(TARBALL === '' ? '4. Tarball contents (npm pack --dry-run)' : '4. Tarball contents')
try {
  let contentLines
  if (TARBALL !== '') {
    // The member names of the file that is published, without the `package/` prefix npm adds.
    contentLines = execFileSync('tar', ['-tzf', TARBALL], { encoding: 'utf8' })
      .split('\n')
      .map((line) => line.replace(/^package\//, '').trim())
      .filter((line) => line !== '' && line !== 'package')
  } else {
    const packOut = execSync('npm pack --dry-run 2>&1', { cwd: ROOT, encoding: 'utf8' })
    // Lines with file sizes look like: "npm notice  2.4kB  CHANGELOG.md"
    const SIZE_RE = /\s+[\d.]+\s*(?:[Mm][Bb]|[Kk][Bb]?|[Bb])\s+\S+/
    const SIZE_STRIP_RE = /.*npm notice\s+[\d.]+\s*(?:[Mm][Bb]|[Kk][Bb]?|[Bb])\s+/
    contentLines = packOut
      .split('\n')
      .filter((l) => l.includes('npm notice') && SIZE_RE.test(l))
      .map((l) => l.replace(SIZE_STRIP_RE, '').trim())
      .filter((l) => Boolean(l) && !l.startsWith('npm notice') && !/^sha\d+:/i.test(l))
  }

  const unexpectedFiles = contentLines.filter(
    (f) => !ALLOWED_TARBALL_PATHS.some((prefix) => f === prefix || f.startsWith(prefix))
  )
  if (unexpectedFiles.length === 0) {
    pass(`Tarball contains only dist/ + meta files (${contentLines.length} entries)`)
  } else {
    for (const f of unexpectedFiles) {
      fail(`Unexpected file in tarball: ${f}`)
    }
  }
} catch (err) {
  fail(`Listing the tarball failed: ${String(err.message)}`)
}

// -- 5. Consumer file: link smoke ---------------------------------------------

section('5. Consumer file: link smoke (minimal resolution check)')
try {
  // Scaffold a minimal consumer in a unique, unpredictable temp dir (mkdtemp
  // appends random chars), avoids the symlink/race hazards of a fixed /tmp
  // path. Created here, not at module load, so early exits leak nothing.
  consumerDir = mkdtempSync(join(tmpdir(), 'dogfood-consumer-'))
  const consumerPkgJson = {
    name: 'dogfood-consumer',
    version: '0.0.1',
    type: 'module',
    dependencies: {
      '@bymax-one/nest-core': `file:${TARBALL === '' ? ROOT : TARBALL}`
    }
  }
  writeFileSync(resolve(consumerDir, 'package.json'), JSON.stringify(consumerPkgJson, null, 2))

  // `--ignore-scripts`: no install script of the package or of anything it pulls in runs here.
  const installResult = spawnSync('pnpm', ['install', '--no-frozen-lockfile', '--ignore-scripts'], {
    cwd: consumerDir,
    encoding: 'utf8',
    timeout: 60_000
  })
  if (installResult.status !== 0) {
    fail(`pnpm install in consumer failed: ${installResult.stderr}`)
  } else {
    pass('pnpm install with file: link succeeded')

    for (const { label, distName } of SUBPATHS) {
      const consumerPath = resolve(
        consumerDir,
        `node_modules/@bymax-one/nest-core/dist/${distName}.mjs`
      )
      if (existsSync(consumerPath)) {
        pass(`${label}: resolves from consumer node_modules`)
      } else {
        fail(`${label}: missing from consumer node_modules`)
      }
    }

    // Import by PACKAGE SPECIFIER from the consumer's cwd (not an absolute
    // path) so this exercises the published `exports` map exactly as a real
    // consumer's `import '@bymax-one/nest-core'` would resolve it.
    const probeLines = SUBPATHS.map(
      ({ specifier }, i) =>
        `${i === 0 ? '' : '.then(() => '}import(${JSON.stringify(specifier)})${i === 0 ? '' : ')'}`
    )
    const specifierProbe = [
      ...probeLines,
      '.catch((e) => { console.error(e); process.exit(5) })'
    ].join('')
    const importResult = spawnSync('node', ['--input-type=module', '-e', specifierProbe], {
      cwd: consumerDir,
      encoding: 'utf8',
      timeout: 30_000
    })
    if (importResult.status === 0) {
      pass('package specifiers resolve via exports map from consumer cwd')
    } else {
      fail(
        `Consumer-side specifier import failed (code ${importResult.status}): ${importResult.stderr}`
      )
    }
  }
} catch (err) {
  fail(`Consumer scaffolding failed: ${String(err.message)}`)
} finally {
  if (consumerDir) {
    try {
      rmSync(consumerDir, { recursive: true, force: true })
    } catch {
      // ignore cleanup failure, temp dir is disposable
    }
  }
}

// -- Result ---------------------------------------------------------------------

console.log('')
if (failures === 0) {
  console.log('All dogfood smoke assertions passed.')
  process.exit(0)
} else {
  console.error(`${failures} assertion(s) failed.`)
  process.exit(1)
}
