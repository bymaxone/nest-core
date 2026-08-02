#!/usr/bin/env node
// Zero-dependency bundle-size gate. Measures every published subpath's ESM
// bundle (raw + brotli-compressed) and fails when any subpath exceeds the
// hard-coded budget below.
//
// Why zero deps: this package ships `"dependencies": {}` on purpose. The
// CI/release runner must stay free of third-party tooling so a compromised
// devDep cannot tamper with the bundle before `pnpm publish`. `node:zlib`'s
// brotli matches what npm/CDN compression produces on the wire.

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { brotliCompressSync, constants } from 'node:zlib'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// Budgets are in bytes (KiB units, `n * 1024`) measured against the brotli'd
// .mjs bundle, what a consumer's bundler/CDN ships. Brotli, not gzip, to
// match real wire compression.
//
// Calibrated on 2026-07-16 against the real release artifacts (measured brotli
// sizes below), with tight headroom (1.35x to 1.5x, always under 2x) so the gate
// stays a bloat tripwire: it catches a peer or a heavy import leaking into the
// bundle without tripping on ordinary growth.
//   `.` (root)     measured 8.15 KiB -> budget 11 KiB   (1.35x)
//   `./pagination` measured 1.01 KiB -> budget  1.5 KiB (1.48x)
//   `./health`     measured 0.00 KiB -> budget  0.5 KiB (floor)
// The health barrel re-exports types only, so its runtime bundle is empty; its
// budget is a small absolute floor that trips the moment real runtime code
// leaks into a types-only subpath, rather than a multiple of a near-zero size.
const BUDGETS = [
  { name: '. (root)', path: 'dist/index.mjs', brotli: 11 * 1024 },
  { name: './pagination', path: 'dist/pagination/index.mjs', brotli: 1.5 * 1024 },
  { name: './health', path: 'dist/health/index.mjs', brotli: 0.5 * 1024 }
]

const fmt = (n) => `${(n / 1024).toFixed(2)} kB`

const BROTLI_OPTS = {
  params: { [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY }
}

let failed = 0
const rows = []

for (const { name, path, brotli: limit } of BUDGETS) {
  const abs = resolve(ROOT, path)
  // Read straight away rather than stat-then-read: two syscalls where one will
  // do, and the pair is a check-then-use race — the artifact can be replaced
  // between them, so the size reported would not be the size that was checked.
  let raw
  try {
    raw = readFileSync(abs)
  } catch (error) {
    // Only a genuinely absent artifact gets the friendly message. Anything
    // else — EACCES, EISDIR, a transient IO fault — keeps its own error, or
    // the real cause would be reported as "run pnpm build" and hide itself.
    if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error
    console.error(`Missing build artifact: ${path}, run \`pnpm build\` first.`)
    process.exit(2)
  }
  const compressed = brotliCompressSync(raw, BROTLI_OPTS).length
  const isWithinBudget = compressed <= limit
  if (!isWithinBudget) failed += 1
  rows.push({
    name,
    raw: raw.length,
    brotli: compressed,
    limit,
    delta: compressed - limit,
    ok: isWithinBudget
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
