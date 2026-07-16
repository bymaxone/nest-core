#!/usr/bin/env node
// Zero-dependency bundle-size gate. Measures every published subpath's ESM
// bundle (raw + brotli-compressed) and fails when any subpath exceeds the
// hard-coded budget below.
//
// Why zero deps: this package ships `"dependencies": {}` on purpose. The
// CI/release runner must stay free of third-party tooling so a compromised
// devDep cannot tamper with the bundle before `pnpm publish`. `node:zlib`'s
// brotli matches what npm/CDN compression produces on the wire.

import { readFileSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { brotliCompressSync, constants } from 'node:zlib'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// Budgets are in bytes (KiB units, `n * 1024`) measured against the brotli'd
// .mjs bundle, what a consumer's bundler/CDN ships. Brotli, not gzip, to
// match real wire compression.
//
// These are the provisional scaffold-time budgets from the technical
// specification (section 13.1): `.` 10 KiB, `./pagination` 3 KiB, `./health`
// 4 KiB. They are recalibrated once the first real feature artifact exists;
// until then the placeholder barrels sit far under budget.
const BUDGETS = [
  { name: '. (root)', path: 'dist/index.mjs', brotli: 10 * 1024 },
  { name: './pagination', path: 'dist/pagination/index.mjs', brotli: 3 * 1024 },
  { name: './health', path: 'dist/health/index.mjs', brotli: 4 * 1024 }
]

const fmt = (n) => `${(n / 1024).toFixed(2)} kB`

const BROTLI_OPTS = {
  params: { [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY }
}

let failed = 0
const rows = []

for (const { name, path, brotli: limit } of BUDGETS) {
  const abs = resolve(ROOT, path)
  try {
    statSync(abs)
  } catch {
    console.error(`Missing build artifact: ${path}, run \`pnpm build\` first.`)
    process.exit(2)
  }
  const raw = readFileSync(abs)
  const compressed = brotliCompressSync(raw, BROTLI_OPTS).length
  const ok = compressed <= limit
  if (!ok) failed += 1
  rows.push({
    name,
    raw: raw.length,
    brotli: compressed,
    limit,
    delta: compressed - limit,
    ok
  })
}

const pad = (s, n) => String(s).padEnd(n)
const padL = (s, n) => String(s).padStart(n)

console.log('')
console.log(
  `  ${pad('Subpath', 20)}${padL('Raw', 12)}${padL('Brotli', 12)}${padL('Budget', 12)}  Status`
)
console.log(`  ${'-'.repeat(20)}${'-'.repeat(12)}${'-'.repeat(12)}${'-'.repeat(12)}  ------`)
for (const r of rows) {
  const status = r.ok ? 'PASS' : `FAIL +${fmt(r.delta)}`
  console.log(
    `  ${pad(r.name, 20)}${padL(fmt(r.raw), 12)}${padL(fmt(r.brotli), 12)}${padL(fmt(r.limit), 12)}  ${status}`
  )
}
console.log('')

if (failed > 0) {
  console.error(`${failed} subpath(s) exceeded the brotli budget.`)
  process.exit(1)
}
