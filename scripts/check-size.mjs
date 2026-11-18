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
// Calibrated against the real release artifacts (measured brotli sizes below),
// with tight headroom (1.35x to 1.5x, always under 2x) so the gate stays a bloat
// tripwire: it catches a peer or a heavy import leaking into the bundle without
// tripping on ordinary growth.
//
// The root was recalibrated on 2026-08-05, after four features landed in it
// (indicator discovery, metrics contribution, trace correlation, and the shared
// provider scan). The growth is the features themselves — the optional peers are
// still reached only through dynamic imports, which the consumer-runtime gate
// asserts on the packed artifact — so the budget moved with the measurement
// rather than the measurement being argued down.
//   `.` (root)     measured 11.01 KiB -> budget 15 KiB  (1.36x, was 8.15 -> 11)
//   `./pagination` measured 1.01 KiB -> budget  1.5 KiB (1.48x)
//   `./health`     measured 0.17 KiB -> budget  0.5 KiB (floor)
//   `./openapi`    measured 5.65 KiB -> budget  7.5 KiB (1.33x, recalibrated 2026-08-12)
//
// The `./openapi` subpath was recalibrated when document fidelity landed there:
// the served document now drops the routes of disabled features, applies the
// security requirements, and references the contributed schemas from the
// operations that return them. The first measurement after that work was 4.40
// KiB, and this gate is why it is 3.67: importing two route-default constants
// from `core.options` had inlined that module's entire resolver — deep-freeze
// and every `resolve*` — into this bundle, because it evaluates
// `normalizeCoreOptions()` at load time and the bundler cannot prove the rest
// unused. Moving the constants to a leaf module (`route-defaults.ts`) removed
// 0.64 KiB of code this subpath never runs. What remains is the feature.
//
// Recalibrated again on 2026-08-12 when the contributor lane landed: a library
// can now describe its own routes, which brings the marker, the provider scan,
// the handler-to-operation map and the fragment merge into this bundle. Checked
// before moving the number rather than after: the resolver has not leaked back
// in, and every added symbol belongs to the lane. +1.58 KiB for an extension
// mechanism is the feature, not drift.
// The health barrel is types plus one decorator, so its runtime bundle is a few
// hundred bytes; its budget is a small absolute floor that trips the moment
// anything substantial leaks into a subpath meant to stay near-empty, rather
// than a multiple of a near-zero size.
//
// The root was recalibrated again on 2026-08-29, when the readiness transition
// sink landed: the aggregator now holds the last state of every check, reports
// each change, orders overlapping probes so a stale outcome cannot overwrite a
// newer one, and describes the three causes apart. Measured 14.25 -> 15.82 KiB,
// budget 15 -> 17.
//
// Checked before moving the number, not after. The transition contract itself
// (`health/health.transition.ts`) is types-only, so it erases at build time and
// costs this bundle nothing; the growth is entirely `health.service.ts`, and no
// module entered the root that was not already in it. Part of the growth was
// prose rather than code — this bundle ships its comments, so a docblock is
// bytes on the wire — and the rationale was moved into the types-only file,
// which is free, before the budget was touched.
//
// The number is 17 rather than 16 for a reason worth writing down, because 16
// was tried first and was wrong. It left ~180 bytes of headroom, which is not a
// tight tripwire but a broken one: at that margin the gate fires on an edited
// comment and cannot distinguish that from a leaked import, so the next person
// to trip it learns to raise the number rather than to look. A gate that cries
// wolf is worse than a looser gate that does not. 1.07x is still far tighter
// than the 1.33x-1.5x the other subpaths carry — this is the bundle every
// consumer loads — while leaving room for prose to change without a false
// alarm. A real leak here is kilobytes, not hundreds of bytes.
//
// Root budget 17.75 KiB = 18176 B: measured 17930 B brotli (raw 76940 B) plus 246 B of headroom.
// The growth over the previous budget is the opt-in body-depth floor (one middleware class, its
// depth walk and the option's validation): code, none of it comment text. `helmet` is not in this
// bundle: it lives in `./http`, whose own budget is below.
// Re-derive it when the measurement exceeds it, after checking that the growth is code and not
// prose (comment text is absent from `dist/index.mjs`), that no module entered the bundle, and
// that the optional peers stay unloaded with their features off (`pnpm check:runtime`).
// Root budget 18 KiB = 18432 B: measured 18294 B brotli (raw 78460 B) plus 138 B of headroom at the time. The
// growth over 17.75 KiB is the readiness sharing in `HealthService` (one shared run, the result
// window, the abort signal) and the validation of its option: code, none of it comment text.
// Root budget 18.25 KiB = 18688 B: measured 18508 B brotli (raw 79333 B) plus 180 B of headroom. The
// growth over 18 KiB is the shutdown drain in `HealthService` (one flag, one hook, the early
// answer): code, none of it comment text.
// Root budget 18.97 KiB = 19425 B: measured 19367 B brotli (raw 82613 B) plus 58 B of headroom. The
// growth over 18.25 KiB is the repeat window (a map of open windows, an unreferenced timer per key,
// the summary and the flush) and the filter's reporting of a 5xx `HttpException`: code, none of it
// comment text.
// Root budget 19.34 KiB = 19804 B: measured 19740 B brotli (raw 84253 B) plus 64 B of headroom. The
// growth over 18.97 KiB is the scrape deadline (one shared collection, an unreferenced deadline timer
// and its option's validation): code, none of it comment text.
//   `./http` measured 787 B brotli (raw 2495 B) -> budget 1 KiB (1.30x): one helper and a loader.
// `./http` budget 1.25 KiB = 1280 B: measured 1242 B brotli (raw 4170 B) plus 38 B of headroom. The
// growth over 1 KiB is the keep-alive timeout and the two body limits: their validation, the size-string
// pattern and the conversion to a byte count: code, none of it comment text (the bundle carries none
// of the source's comments, which `dist/http/index.mjs` shows).
// Root budget 19.44 KiB = 19907 B: measured 19868 B brotli (raw 84972 B) plus 39 B of headroom. The
// growth over 19.34 KiB is the metrics production guard (one function and its refusal message, in
// its own module): code, none of it comment text.
// `./http` budget 1.81 KiB = 1853 B: measured 1821 B brotli (raw 6472 B) plus 32 B of headroom. The
// growth over 1.25 KiB is the CORS allowlist: the validation of the origins and lists, and the
// refusal messages: code, none of it comment text.
// Root budget 21.14 KiB = 21647 B: measured 21611 B brotli (raw 92844 B) plus 36 B of headroom. The
// growth over 20.65 KiB is the shutdown deadline armed by a signal and by each of the module's three
// hooks, and the handler timeout rewritten to bound the whole duration, release a client that went
// away and log an error after the 504: code, none of it comment text, and `rxjs` stays external.
// `./http` budget 2.64 KiB = 2703 B: measured 2667 B brotli (raw 9808 B) plus 36 B of headroom. The
// growth over 2.52 KiB is the header-name check and the sparse-list handling of the CORS options:
// code and refusal messages, none of it comment text.
// Root budget 22.82 KiB = 23368 B: measured 23328 B brotli (raw 101272 B) plus 40 B of headroom. The
// growth over 21.14 KiB is the validation of every option the module takes: the type check of each
// boolean, string, route and number, the refusal of an option a block does not have, the shape checks
// of the OpenAPI servers, security schemes and requirements, and the metrics labels: code and refusal
// messages, none of it comment text, and no module entered the bundle that was not already in it.
// Root budget raised to 22.87 KiB = 23418 B: measured 23390 B brotli (raw 101358 B) plus 28 B of headroom;
// the growth over 22.82 KiB is the final form of the same checks: code and refusal messages.
// `./http` budget 3.16 KiB = 3236 B: measured 3204 B brotli (raw 11671 B) plus 32 B of headroom. The
// growth over 2.64 KiB is the same checks applied to `applyHttpFloors`: the option tables, helmet's 22
// option names, and the type-only refusal messages: code, none of it comment text.
// Root budget 23.00 KiB = 23552 B: measured 23520 B brotli (raw 102163 B) plus 32 B of headroom. The
// growth over 22.87 KiB is the type check of `oauth2` and `openIdConnect` schemes, the built-in
// object check on blocks and the reserved label names: code and refusal messages.
// `./http` budget 3.49 KiB = 3574 B: measured 3535 B brotli (raw 13255 B) plus 39 B of headroom. The
// growth over 3.16 KiB is the helmet option types and the refusal that reports the option helmet
// rejected and not its value: code and messages, none of it comment text.
// Root budget 23.44 KiB = 24002 B: measured 23971 B brotli (raw 104297 B) plus 31 B of headroom. The
// growth over 23.00 KiB is the health-status gauge (one class, its resolver and provider, and the
// recorder call in the readiness aggregator) and the event codes of the log lines: code and message
// text, none of it comment text.
const BUDGETS = [
  { name: '. (root)', path: 'dist/index.mjs', brotli: 23.44 * 1024 },
  { name: './pagination', path: 'dist/pagination/index.mjs', brotli: 1.5 * 1024 },
  { name: './health', path: 'dist/health/index.mjs', brotli: 0.5 * 1024 },
  { name: './openapi', path: 'dist/openapi/index.mjs', brotli: 7.5 * 1024 },
  { name: './metrics', path: 'dist/metrics/index.mjs', brotli: 0.5 * 1024 },
  { name: './http', path: 'dist/http/index.mjs', brotli: 3.49 * 1024 }
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
