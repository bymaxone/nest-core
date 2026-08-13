#!/usr/bin/env node
/**
 * Consumer load gate.
 *
 * Every other gate reads the source or the type declarations. This one packs the
 * tarball, lays it out the way npm would, and loads every subpath from it — in
 * ESM and in CommonJS — asserting the values each one is supposed to export are
 * really there.
 *
 * `attw` proves the declarations *resolve*; it never runs the JavaScript. A
 * broken `exports` map, a bundler misconfiguration, or an entry that ships an
 * empty module all pass a type check and fail here.
 *
 * It then boots a real Nest application against the packed artifact and drives
 * `applyBymaxOpenApi` through all three of its outcomes. That probe exists
 * because of a specific defect class the unit suite structurally cannot see:
 * under ts-jest every module is loaded once, so a DI token shared between two
 * entries is one object no matter how it was minted. In the published package it
 * is not — each subpath is a separate bundle with the shared modules inlined —
 * and in 1.3.0 that made `applyBymaxOpenApi` unable to resolve a token the
 * package root had provided, throwing on every consumer boot. Only a probe that
 * loads two entries of the built artifact into one process can catch it.
 *
 * It shells out to `npm pack` and `tar`, both of which have to be on PATH. That
 * is deliberate: packing through npm itself is what makes the gate inspect the
 * same tarball a publish would produce, rather than a directory that resembles
 * it. On Windows, run it from a shell that provides `tar` (Git Bash, WSL, or
 * Windows 10 1803+, which ships bsdtar).
 *
 * Usage: `node scripts/check-consumer-runtime.mjs` (run after `pnpm build`).
 */
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..')
// Read from the manifest rather than hard-coded: this gate exists to inspect
// the packed artifact, so a rename must not leave it silently checking a
// package that no longer exists.
const packageName = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8')).name
// Inside the repository, and that is load-bearing rather than incidental: the
// packed package is laid out under `<consumerDir>/node_modules`, but its peers
// are not, so `@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express`,
// `@nestjs/swagger` and `reflect-metadata` resolve by walking up into the
// repository's own `node_modules`, where they sit as devDependencies. Moving
// this to `os.tmpdir()` — as the dogfood smoke test does, which makes it a
// plausible consistency refactor — cuts that path and every probe dies on
// MODULE_NOT_FOUND for a reason that has nothing to do with the package.
const consumerDir = join(rootDir, '.consumer-runtime-check')

/**
 * Subpath → the values a consumer must find on it.
 *
 * A subpath that exports mostly types still earns its entry here: loading it
 * proves the `exports` map resolves and the bundle was produced, which no type
 * check can tell you.
 */
const SUBPATHS = {
  '.': [
    'BymaxCoreModule',
    'BymaxExceptionFilter',
    'TimingInterceptor',
    'BymaxTimingMiddleware',
    'UNMATCHED_ROUTE',
    'buildErrorEnvelope',
    'codeForStatus',
    'BYMAX_CORE_OPTIONS',
    'BYMAX_HEALTH_INDICATORS',
    'BYMAX_METRICS_REGISTRY',
    'BYMAX_TIMING_SINK',
    'BYMAX_CORRELATION_PROVIDER',
    'BYMAX_VALIDATION_FAILED'
  ],
  // Types plus the discoverable-indicator marker: the only runtime value this
  // subpath ships, and the one a sibling library imports to mark its indicator.
  './health': ['BymaxHealthIndicator', 'BYMAX_HEALTH_INDICATOR_METADATA'],
  './pagination': [
    'buildPageResult',
    'normalizePageQuery',
    'buildCursorResult',
    'decodeCursor',
    'encodeCursor',
    'normalizeCursorQuery'
  ],
  './openapi': ['applyBymaxOpenApi'],
  './metrics': ['BymaxMetricsContributor', 'BYMAX_METRICS_CONTRIBUTOR_METADATA']
}

/**
 * Optional peers that must not be loaded by merely importing the package.
 *
 * Each is reached through a lazy dynamic import inside one loader, so a consumer
 * who leaves the corresponding feature disabled never resolves the module. That
 * is easy to break by accident — a top-level `import`, or a decorator, which
 * runs when its class is defined — and the break is invisible: the peers are
 * installed here as devDependencies, so a leaked import still resolves and every
 * other gate stays green. This one fails.
 */
const LAZY_PEERS = ['prom-client', '@nestjs/swagger', '@opentelemetry/api']

const probeBody = `
const failures = []
for (const [subpath, names] of Object.entries(SUBPATHS)) {
  const namespace = loaded[subpath]
  if (namespace === undefined) {
    failures.push(subpath + ' did not load')
    continue
  }
  const missing = names.filter((name) => namespace[name] === undefined)
  if (missing.length) failures.push(subpath + ' does not export: ' + missing.join(', '))
}
if (failures.length) {
  for (const failure of failures) console.error('  ✗ ' + failure)
  process.exit(1)
}
const total = Object.values(SUBPATHS).reduce((sum, names) => sum + names.length, 0)
console.log('  ✓ ' + FORMAT + ': ' + Object.keys(SUBPATHS).length + ' subpath(s), ' + total + ' export(s) present')
`

const specifier = (subpath) => (subpath === '.' ? packageName : packageName + subpath.slice(1))

const esmProbe = `${Object.keys(SUBPATHS)
  .map((s, i) => `import * as m${i} from '${specifier(s)}'`)
  .join('\n')}
const SUBPATHS = ${JSON.stringify(SUBPATHS)}
const loaded = { ${Object.keys(SUBPATHS)
  .map((s, i) => `'${s}': m${i}`)
  .join(', ')} }
const FORMAT = 'ESM'
${probeBody}`

// Only the CommonJS probe can answer "was this module loaded?" — `require.cache`
// is the module registry, and ESM exposes no equivalent. One format is enough:
// both formats are built from the same sources, so a leaked import is in both.
const peerGuard = `
// Separators are normalized before matching: on Windows the cache keys are
// backslash-delimited, and a forward-slash-only check would never match — the
// guard would pass by never firing, which is worse than not having it.
const cached = Object.keys(require.cache).map((file) => file.split('\\\\').join('/'))
const leaked = LAZY_PEERS.filter((peer) =>
  cached.some((file) => file.includes('node_modules/' + peer + '/'))
)
if (leaked.length) {
  console.error('  ✗ optional peer loaded with its feature disabled: ' + leaked.join(', '))
  process.exit(1)
}
console.log('  ✓ CJS: ' + LAZY_PEERS.length + ' optional peer(s) stayed unloaded')
`

const cjsProbe = `${Object.keys(SUBPATHS)
  .map((s, i) => `const m${i} = require('${specifier(s)}')`)
  .join('\n')}
const SUBPATHS = ${JSON.stringify(SUBPATHS)}
const LAZY_PEERS = ${JSON.stringify(LAZY_PEERS)}
const loaded = { ${Object.keys(SUBPATHS)
  .map((s, i) => `'${s}': m${i}`)
  .join(', ')} }
const FORMAT = 'CJS'
${probeBody}
${peerGuard}`

/**
 * Cross-entry boot probe: the package root registers the module, the `./openapi`
 * subpath consumes what it registered.
 *
 * The two specifiers resolve to two separate bundles that each inline the shared
 * internals, so this is the only place any gate observes what a consumer
 * observes — a provider bound by one bundle being looked up by another. The
 * three cases are `applyBymaxOpenApi`'s entire contract, and the first of them
 * is the one that regressed: with the feature *off*, the helper still resolves
 * the options before it reads the flag, so a token that does not match takes
 * down the boot of an application that never asked for a document.
 *
 * The decorator is applied as a plain call rather than with `@` syntax so the
 * probe is valid JavaScript in both module formats with no transpiler involved.
 */
const bootBody = `
const failures = []

/** Build and initialize an application registering the module asynchronously. */
async function boot(openapi) {
  class ProbeModule {}
  Module({
    imports: [BymaxCoreModule.forRootAsync({ useFactory: () => ({ openapi }) })]
  })(ProbeModule)
  return NestFactory.create(ProbeModule, { logger: false, abortOnError: false })
}

/** Assert one outcome of the helper, booting a fresh application for it. */
async function check(label, nodeEnv, openapi, expected) {
  process.env.NODE_ENV = nodeEnv
  let app
  try {
    app = await boot(openapi)
    const outcome = await applyBymaxOpenApi(app)
    for (const key of ['mounted', 'reason', 'path']) {
      if (outcome[key] !== expected[key]) {
        failures.push(
          label + ': expected ' + key + '=' + String(expected[key]) +
            ', got ' + String(outcome[key])
        )
      }
    }
  } catch (error) {
    failures.push(label + ': threw "' + (error && error.message) + '"')
  } finally {
    if (app) await app.close()
  }
}

const originalNodeEnv = process.env.NODE_ENV
try {
  // Disabled: mounts nothing and must not throw. This is the case a consumer
  // that never enabled the feature hits on every single boot.
  await check('openapi disabled', 'development', undefined, {
    mounted: false,
    reason: 'disabled',
    path: undefined
  })
  // Enabled outside production: the document and its UI mount at the configured
  // route, which also proves the cross-entry options snapshot carried its values.
  await check('openapi enabled', 'development', { enabled: true, path: 'probe-docs' }, {
    mounted: true,
    reason: undefined,
    path: 'probe-docs'
  })
  // Enabled in production: refused, by the helper's own guard.
  await check('openapi enabled in production', 'production', { enabled: true }, {
    mounted: false,
    reason: 'production',
    path: undefined
  })
} finally {
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV
  else process.env.NODE_ENV = originalNodeEnv
}

if (failures.length) {
  for (const failure of failures) console.error('  ✗ ' + failure)
  process.exit(1)
}
console.log('  ✓ ' + FORMAT + ': applyBymaxOpenApi resolved the module registered by the package root (3 outcomes)')
`

const esmBoot = `import 'reflect-metadata'
import { Module } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { BymaxCoreModule } from '${specifier('.')}'
import { applyBymaxOpenApi } from '${specifier('./openapi')}'
const FORMAT = 'ESM'
${bootBody}`

const cjsBoot = `require('reflect-metadata')
const { Module } = require('@nestjs/common')
const { NestFactory } = require('@nestjs/core')
const { BymaxCoreModule } = require('${specifier('.')}')
const { applyBymaxOpenApi } = require('${specifier('./openapi')}')
const FORMAT = 'CJS'
// Wrapped because a CommonJS file has no top-level await. The rejection handler
// is not decoration: without it a throw inside the IIFE would leave the exit
// code at 0 and the gate would report a pass.
void (async () => {
${bootBody}
})().catch((error) => {
  console.error(error)
  process.exit(1)
})`

function run(command, args, options = {}) {
  return execFileSync(command, args, { encoding: 'utf8', stdio: 'pipe', ...options })
}

function cleanup() {
  rmSync(consumerDir, { recursive: true, force: true })
}

console.log('Consumer load gate')

if (!existsSync(join(rootDir, 'dist'))) {
  console.error('✗ dist/ is missing — run `pnpm build` first')
  process.exit(1)
}

cleanup()
const packDir = mkdtempSync(join(tmpdir(), 'pack-'))
let failed = false

try {
  // `--ignore-scripts` keeps `prepublishOnly` from rebuilding underneath the
  // artifact this gate is meant to inspect.
  // The tarball is located by reading the directory it was packed into, not by
  // parsing `npm pack`'s stdout. Inside a publish, npm writes notices around the
  // filename, so taking the last line yields a path with trailing text and `tar`
  // fails on a name that does not exist. The directory is freshly created and
  // holds exactly one archive.
  // `npm_config_dry_run` is cleared for the child: a `npm publish --dry-run`
  // pre-flight exports it, the nested pack inherits it, and a dry pack writes no
  // file — so the gate would report a missing tarball for a reason that has
  // nothing to do with the package. Cleared, the gate means the same thing in
  // every context it can be invoked from.
  const packEnv = { ...process.env }
  delete packEnv['npm_config_dry_run']
  // `cwd: rootDir`: the package to pack is this repository's, whatever directory
  // the script was invoked from. Without it the gate would inspect whichever
  // package npm resolved from the caller's cwd.
  run('npm', ['pack', '--ignore-scripts', '--silent', '--pack-destination', packDir], {
    cwd: rootDir,
    env: packEnv
  })
  const packed = readdirSync(packDir).filter((name) => name.endsWith('.tgz'))
  if (packed.length !== 1) {
    throw new Error(`expected one tarball in ${packDir}, found ${packed.length}`)
  }
  const tarball = join(packDir, packed[0])

  const packageDir = join(consumerDir, 'node_modules', packageName)
  mkdirSync(packageDir, { recursive: true })
  run('tar', ['-xzf', tarball, '-C', packageDir, '--strip-components=1'])

  writeFileSync(
    join(consumerDir, 'package.json'),
    `${JSON.stringify({ name: 'consumer-runtime-check', private: true, version: '0.0.0', type: 'module' }, null, 2)}\n`
  )
  writeFileSync(join(consumerDir, 'probe.mjs'), esmProbe)
  writeFileSync(join(consumerDir, 'probe.cjs'), cjsProbe)
  writeFileSync(join(consumerDir, 'boot.mjs'), esmBoot)
  writeFileSync(join(consumerDir, 'boot.cjs'), cjsBoot)

  // The boot probes run last: they are the only ones that need the framework
  // peers resolvable, and a failure to even load a subpath is a clearer message
  // than a failure to bootstrap one.
  for (const probe of ['probe.mjs', 'probe.cjs', 'boot.mjs', 'boot.cjs']) {
    try {
      process.stdout.write(run('node', [probe], { cwd: consumerDir, stdio: 'pipe' }))
    } catch (error) {
      process.stdout.write(error.stdout ?? '')
      process.stderr.write(error.stderr ?? '')
      failed = true
    }
  }
} catch (error) {
  console.error(`✗ gate setup failed: ${error.message}`)
  if (error.stderr) process.stderr.write(error.stderr)
  failed = true
} finally {
  cleanup()
  rmSync(packDir, { recursive: true, force: true })
}

if (failed) {
  console.error('\n✗ The published artifact does not load for a consumer.')
  process.exit(1)
}

console.log('✓ Every subpath loads in ESM and CommonJS.')
