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
// Root budget 23.52 KiB = 24084 B: measured 24043 B brotli (raw 104862 B) plus 41 B of headroom. The
// growth over 23.44 KiB is the wrapper for a thrown non-Error (one class, two guarded helpers and the
// call at each site that logs or chains a host's throw) and the `routes` and `entries` fields: code,
// plus the docblocks of one new module.
// Root budget 23.71 KiB = 24279 B: measured 24234 B brotli (raw 105573 B) plus 45 B of headroom. The
// growth over 23.52 KiB is the instance mark and `instanceof` of the thrown-value wrapper, the check for
// an Error of another realm, the guarded logger call of the late-handler line and the escaping and cap of
// the listed items: code, plus their docblocks.
// `./openapi` budget 7.89 KiB = 8079 B: measured 8042 B brotli (raw 32712 B) plus 37 B of headroom, from
// 7404 B. The growth is the thrown-value wrapper that this entry now bundles for the boot error of a
// contributor that throws: one class, its guarded helpers and the description of a value; the root entry
// carries its own copy, and the instance mark is what keeps `instanceof` true across the two.
// Root budget 23.76 KiB = 24330 B: measured 24292 B brotli (raw 105722 B) plus 38 B of headroom. The
// growth over 23.71 KiB is the log writer that absorbs a throw of the application's logger, now the one
// call at every site that logs, and the escape of line separators and bidirectional controls: code.
// `./openapi` budget 7.98 KiB = 8171 B: measured 8144 B brotli (raw 33147 B) plus 27 B of headroom, from
// 8079 B. The growth is the same log writer, which this entry bundles for its three lines, and the
// escape of line separators and bidirectional controls in the listed items.
// Root budget 23.78 KiB = 24351 B: measured 24325 B brotli (raw 105851 B) plus 26 B of headroom. The
// growth over 23.76 KiB is the guarded description of a value that `NonErrorThrownError` and the contract
// version error share, and the zero-width characters and byte order mark in the escape: code and messages.
// `./openapi` budget 8.05 KiB = 8243 B: measured 8222 B brotli (raw 33471 B) plus 21 B of headroom, from
// 8171 B. The growth is the same description, the cause of the contract version error and the wider escape.
// Measured at these figures: cutting the docblock of `writeLog` to one sentence left both bundles byte for
// byte the same, and its text is absent from `dist`, so that docblock is not part of the growth.
// Root budget 23.82 KiB = 24392 B: measured 24368 B brotli (raw 106073 B) plus 24 B of headroom. The
// growth over 23.78 KiB is the boot-error builder, the fields it carries on the metrics and health boot
// errors, and the escape by Unicode category: code and messages.
// `./openapi` budget 8.12 KiB = 8315 B: measured 8308 B brotli (raw 33871 B) plus 7 B of headroom, from
// 8243 B. The growth is the same builder, the fields on the contributor, handler-key, scheme and
// operation boot errors, and the guarded read of a fragment: code and messages.
// `./openapi` budget 8.19 KiB = 8386 B: measured 8376 B brotli (raw 34222 B) plus 10 B of headroom, from
// 8315 B. The growth is the copy of a fragment's operations and of each component section made inside the
// guard of `callContributor`, so a proxy that throws or is revoked fails as the contributor's error, and
// the lone-surrogate category in the escape: code. The root entry stays at 23.82 KiB (measured 24379 B).
// Root budget 24.08 KiB = 24658 B: measured 24629 B brotli (raw 106913 B) plus 29 B of headroom, from
// 24391 B. `./openapi` budget 8.26 KiB = 8458 B: measured 8427 B (raw 34505 B) plus 31 B, from 8386 B.
// `./http` budget 3.75 KiB = 3840 B: measured 3807 B (raw 14044 B) plus 33 B, from 3574 B. The growth is
// one module, `escapeUnseen`, which `bootError` now applies to every string a boot error carries (the
// escape moved out of the OpenAPI bootstrap, where `./openapi` already had it), and the loop in `bootError`
// that applies it: `./http` and the root reach it through the unknown-option refusal. Code only.
// Root budget 24.37 KiB = 24955 B: measured 24930 B brotli (raw 108625 B) plus 25 B of headroom, from
// 24658 B. `./openapi` budget 8.53 KiB = 8734 B: measured 8706 B (raw 35482 B) plus 28 B, from 8458 B.
// `./http` budget 4.01 KiB = 4106 B: measured 4076 B (raw 15118 B) plus 30 B, from 3840 B; it reads the options
// of `applyHttpFloors` through `readOptions`, which brings `ownCopy` and `bootError` into this entry. The
// cause is what the host threw, as it was thrown: wrapping a non-Error with `asHostError` would add
// 438 B here, measured, and the cause of this error is read by code, not logged. The growth is
// `ownCopy`, the deep copy of what a host hands over (a contributor's fragment in `./openapi`, the options in
// the root, which also carries the guarded reads of a marked provider), and the ten-item cap of a list a boot
// error carries, which reaches `./http` through `bootError`. Code only.
// Root budget 24.48 KiB = 25068 B: measured 25036 B brotli (raw 108880 B) plus 32 B of headroom, from
// 24955 B. `./openapi` budget 8.60 KiB = 8806 B: measured 8771 B (raw 35733 B) plus 35 B, from 8734 B.
// `./http` budget 4.09 KiB = 4188 B: measured 4154 B (raw 15369 B) plus 34 B, from 4106 B. The growth is the
// copy taking every own property, enumerable or not, with its flag, symbols included, in `ownCopy`: the copy
// must keep an option held by a non-enumerable property, such as a token behind a getter. Code only.
// Root budget 24.50 KiB = 25088 B: measured 25053 B brotli (raw 109082 B) plus 35 B of headroom, from
// 25068 B. `./openapi` budget 8.66 KiB = 8868 B: measured 8837 B (raw 36015 B) plus 31 B, from 8806 B.
// `./http` budget 4.15 KiB = 4250 B: measured 4219 B (raw 15571 B) plus 31 B, from 4188 B. The growth is
// the memo of finished copies in `ownCopy`, which keeps an object reached twice copied once, and the
// snapshot of a component section's entries in `callContributor`. Code only.
const BUDGETS = [
  { name: '. (root)', path: 'dist/index.mjs', brotli: 24.5 * 1024 },
  { name: './pagination', path: 'dist/pagination/index.mjs', brotli: 1.5 * 1024 },
  { name: './health', path: 'dist/health/index.mjs', brotli: 0.5 * 1024 },
  { name: './openapi', path: 'dist/openapi/index.mjs', brotli: 8.66 * 1024 },
  { name: './metrics', path: 'dist/metrics/index.mjs', brotli: 0.5 * 1024 },
  { name: './http', path: 'dist/http/index.mjs', brotli: 4.15 * 1024 }
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
