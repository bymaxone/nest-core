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
// the memo of finished copies in `ownCopy`, which keeps an object reached twice copied once; the root and
// `./openapi` also carry the snapshot of a component section's entries in `callContributor`, and `./http`
// carries only the memo. Code only.
// Root budget 24.74 KiB = 25334 B: measured 25302 B brotli (raw 110256 B) plus 32 B of headroom, from
// 25088 B. `./http` budget 4.32 KiB = 4424 B: measured 4389 B (raw 16492 B) plus 35 B, from 4250 B.
// `./openapi` is unchanged at 8.66 KiB (8837 B). The growth is `readBlock`, which reads each documented option
// by its name from the tables the options are checked against, and the tables the root and `./http` now
// carry for it. Reading by name keeps an option a host serves only through `get`. Code only.
// Root budget 24.80 KiB = 25395 B: measured 25369 B brotli (raw 110720 B) plus 26 B of headroom, from
// 25334 B. `./openapi` budget 8.69 KiB = 8898 B: measured 8869 B (raw 36287 B) plus 29 B, from 8868 B.
// `./http` is unchanged at 4.32 KiB (4389 B). The growth is the one guarded read of the options that
// `forRoot` hands to the builder, and the guarded reads of a marked class's name and of an indicator's
// name; `./openapi` carries the class-name read through the shared discovery. Code only.
// Root budget 24.87 KiB = 25466 B: measured 25439 B brotli (raw 111081 B) plus 27 B of headroom, from
// 25395 B. Every other subpath is unchanged. The growth is the single read of each health indicator's
// name, which refuses a name that is not a non-empty string and sorts the names read. Code only.
// Root budget 24.94 KiB = 25540 B: measured 25506 B brotli plus 34 B of headroom, from 25466 B. `./http`
// budget 4.46 KiB = 4570 B: measured 4535 B plus 35 B, from 4424 B. `./openapi` is unchanged. The growth is the
// table of the settings the options of `helmet` take, which `./http` reads them by, and the refusal of an
// option held behind a proxy that lists no keys, in the shared `readBlock`. Code only.
// Root budget 25.18 KiB = 25784 B: measured 25756 B brotli plus 28 B of headroom, from 25540 B. `./http`
// budget 4.70 KiB = 4812 B: measured 4794 B plus 18 B, from 4570 B. The growth is the read of a map option by
// every name it answers to (own, non-enumerable and inherited accessors, capped) that the policy
// `directives` are read by, and the refusal of a list item behind a proxy that lists no keys. Code only.
// Root budget 25.26 KiB = 25866 B: measured 25839 B brotli plus 27 B of headroom, from 25784 B. `./http` budget
// 4.80 KiB = 4915 B: measured 4885 B plus 30 B, from 4812 B. The growth is the read of a list option once, by
// index, under a cap, which is the one place an item is checked and copied. Code only.
// `./openapi` budget 8.72 KiB = 8929 B: measured 8907 B brotli plus 22 B of headroom, from 8898 B. Root (25850 B)
// and `./http` (4890 B) stay within the budgets above. The growth is the shared copy judging a proxy that lists no
// keys at every depth, and copying each property as an enumerable one. Code only.
// Root budget 25.35 KiB = 25958 B: measured 25927 B brotli plus 31 B of headroom, from 25866 B. `./http` budget
// 4.90 KiB = 5018 B: measured 4978 B plus 40 B, from 4915 B. `./openapi` budget 8.76 KiB = 8970 B: measured 8941 B plus
// 29 B, from 8929 B. The growth is the shared copy refusing a proxy that lists no keys where a security requirement
// is held, a switch the options pass for the keys that hold one. Code only.
// Root budget 25.44 KiB = 26050 B: measured 26017 B brotli plus 33 B of headroom, from 25958 B. `./http` budget
// 4.96 KiB = 5079 B: measured 5048 B plus 31 B, from 5018 B. `./openapi` budget 8.83 KiB = 9042 B: measured 9011 B plus
// 31 B, from 8970 B. The growth is the shared copy keeping its copies apart for the places that refuse a proxy
// that lists no keys, so the order a shared object is reached in cannot decide the refusal. Code only.
// `./http` budget 5.00 KiB = 5120 B: measured 5101 B brotli plus 19 B of headroom, from 5079 B. `./openapi` budget
// 8.89 KiB = 9103 B: measured 9076 B plus 27 B, from 9042 B. Root (26025 B) stays within its budget. The growth is the
// shared copy never handing back a proxy as itself and building a list by index. Code only.
// Root budget 25.49 KiB = 26101 B: measured 26072 B brotli plus 29 B of headroom, from 26050 B. `./http` budget
// 5.04 KiB = 5161 B: measured 5139 B plus 22 B, from 5120 B. `./openapi` budget 8.93 KiB = 9144 B: measured 9136 B plus
// 8 B, from 9103 B. The growth is the shared copy refusing a list whose length is not an integer in range. Code only.
// Root budget 25.59 KiB = 26204 B: measured 26170 B brotli plus 34 B of headroom, from 26101 B. `./http` budget
// 5.17 KiB = 5294 B: measured 5260 B plus 34 B, from 5161 B. `./openapi` budget 9.08 KiB = 9298 B: measured 9258 B
// plus 40 B, from 9144 B. The growth is the one strict copy the OpenAPI security options are checked and built from,
// the plain-object requirement in it, and the shared work budget of a copy. Code only.
// Root budget 25.78 KiB = 26398 B: measured 26365 B brotli plus 33 B of headroom, from 26204 B. `./http` budget
// 5.29 KiB = 5417 B: measured 5384 B plus 33 B, from 5294 B. `./openapi` is unchanged at 9.08 KiB (9291 B measured).
// The growth is the servers taken through the same strict copy, a refusal of what a proxy lists without holding,
// the functions a strict copy refuses, the one work limit shared by a call, and the option a strict refusal names.
// Code only.
// Root budget 25.85 KiB = 26470 B: measured 26438 B brotli plus 32 B of headroom, from 26398 B. `./http` budget
// 5.41 KiB = 5540 B: measured 5501 B plus 39 B, from 5417 B. `./openapi` budget 9.22 KiB = 9441 B: measured 9405 B plus
// 36 B, from 9298 B. The growth is the one snapshot a shared object gets for both kinds of copy, so the host is
// read once whatever order the object is reached in. Code only.
// Root budget 25.91 KiB = 26531 B: measured 26497 B brotli plus 34 B of headroom, from 26470 B. `./openapi` budget
// 9.32 KiB = 9543 B: measured 9507 B plus 36 B, from 9441 B. `./http` is unchanged (5529 B measured). The growth is the
// prototype read through a proxy, the refusal of a hole, the option a refusal names, the function a directive holds
// and the plain operations a contributor gives. Code only.
// Root budget 25.95 KiB = 26573 B: measured 26537 B brotli plus 36 B of headroom, from 26531 B. `./http` budget
// 5.50 KiB = 5632 B: measured 5600 B plus 32 B, from 5540 B. `./openapi` budget 9.40 KiB = 9626 B: measured 9588 B plus
// 38 B, from 9543 B. The growth is the memory of the copies made of a proxy whose prototype is not plain, which a
// contributor's operations are refused for, and the read of a security option inside the try that names it. Code only.
// Root budget 25.98 KiB = 26605 B: measured 26574 B brotli plus 31 B of headroom, from 26573 B. `./http` budget
// 5.54 KiB = 5673 B: measured 5639 B plus 34 B, from 5632 B. `./openapi` is unchanged (9482 B measured). The growth
// is the read of an option only where something below the realm root holds it, and the copies made with no
// prototype, so a name planted on `Object.prototype` cannot fill an omitted option. Code only.
// `./http` budget 5.72 KiB = 5857 B: measured 5829 B brotli plus 28 B of headroom, from 5673 B. Root (26588 B)
// and `./openapi` (9606 B, under its 9.40 KiB) are unchanged. The growth is the
// options `helmet` is handed with no prototype, and the settings object each of its options that is on holds,
// so a name planted on `Object.prototype` is not one `helmet` reads. Code only.
// `./openapi` budget 9.52 KiB = 9748 B: measured 9717 B brotli plus 31 B of headroom, from 9626 B. Root
// (26588 B) and `./http` (5829 B) are unchanged. The growth is the boot refusal of a name planted on
// `Object.prototype` that the peer reads from its own instances, and the two helpers that hand the peer
// options with no prototype. Code only.
// `./openapi` budget 9.59 KiB = 9820 B: measured 9794 B brotli plus 26 B of headroom, from 9748 B. Root (26589 B)
// and `./http` (5838 B) are unchanged. The growth is the own-property read of every member of the served document
// the merge tests (`security`, `securitySchemes`, `content`, `$ref`, `description`, `paths`, `components`), and
// four more names of the peer's own objects in the boot refusal. Code only.
// Budgets for the refusal of a changed `Object.prototype`, measured + about 30 B: root 26.50 KiB = 27136 B (measured
// 27126 B), `./http` 6.30 KiB = 6451 B (6414 B), `./openapi` 10.01 KiB = 10250 B (10235 B), from 26603 B, 5857 B and
// 9820 B. The growth is that one module, which each bundle carries: a fresh realm's `Object.prototype` to compare
// with, the snapshot taken at load, and the comparison of every name and function, each field of a descriptor
// read as its own property. Code only.
// Root budget 26.70 KiB = 27341 B: measured 27314 B brotli plus 27 B of headroom, from 27136 B. `./http` (6419 B)
// and `./openapi` (10245 B) are unchanged under their budgets. The growth is the second run of the guard after the
// last `await`, the scrape's refusal and containment of a failing collection, and the containment of the writes of
// every write of the default metrics. Code only.
// Root budget 26.78 KiB = 27423 B: measured 27387 B brotli plus 36 B of headroom, from 27341 B. The growth is the
// second run of the guard after the scan and the dropped write of the health gauge. `./openapi` (10243 B) is
// unchanged under its budget. Code only.
// 2026-11-23, PR 246: root 27.64 KiB, `./openapi` 10.70 KiB and `./http` 8.03 KiB, each about 20 B over the measured brotli
// size, measured on a clean build: root 27.61, `./openapi` 10.66, `./http` 8.01 KiB. The growth over the previous budgets is code, with no module added to a bundle: the request deadline (middleware,
// options and signal key, in `./http`), the single decision on the tag of a host's object, the guard (its
// vm-failure refusal and the table of built-ins the CORS and deadline decisions watch, inlined in each bundle), the
// own-property reads of the document, the template body of the 504 answer, the bounded exclusion match (a path of
// 16000 slashes held the loop for 622 ms), the abort of the deadline signal on a client close and the clock the 504 body
// captures at load.
// 2026-11-23, PR 246 (second entry): `./http` 8.09 KiB, measured 8.08 KiB on a clean build. The growth is code, with no
// module added: the loop that removes the headers describing the body a handler began, and their names, before the 504
// envelope. Trimming the list from eight names to five measured 8.07 KiB, so the loop is the cost.
// 2026-11-23, no verdict reads a `Promise` static: root 27.80 KiB (measured 27.77) and `./http` 8.11 KiB (measured 8.10).
// The growth is code, with no module added to a bundle: the helper that settles a check or a collection against its
// timer from the constructor captured at load, the check split into its own function, the shared run, and the
// `Promise.prototype.constructor` entry of the table of built-ins the guard watches (inlined in `./http`).
// 2026-11-24, the guard's watched table and refusal paths: root 28.20 KiB (measured 28.16), `./openapi` 10.76 KiB (measured 10.75)
// and `./http` 8.19 KiB (measured 8.18). The growth is code, with no module added to a bundle: the intrinsic constructor
// capture, the absent-`then` entries of the table the guard watches, the check before each verdict is awaited and before
// it is cached, the objects that inherit nothing, the `runtime` refusal with its log line, and the handled-before-awaited
// mark on every started check.
// 2026-11-24, accessor slots in the watched table: root 28.28 KiB (measured 28.27), `./openapi` 10.82 KiB (measured 10.81)
// and `./http` 8.25 KiB (measured 8.24). The growth is code, with no module added to a bundle: the getter and setter held
// beside the value of every watched name, so an accessor `then` is as visible as a data property, and the try/catch that
// marks a refused check handled before the refusal is thrown.
// 2026-11-24, own constructor on awaited promises and the second check: root 28.65 KiB (measured 28.63, 29317 B). The growth is code, with no
// module added to a bundle: the own intrinsic `constructor` given to a promise before it is awaited, the guard-refusal
// test, the second check after a scrape or a probe starts, and the scrape's `runtime` refusal with its log line.
// 2026-11-24, the awaits of this package's own promises: root 28.76 KiB (measured 28.73, 29421 B). The growth is code,
// with no module added to a bundle: `ownIntrinsicConstructor` returning its argument and ignoring what is not a native
// promise, its use inside the readiness controller's and the collection's `await`, and the refusal translated to `503`
// when it is raised after a collection started.
// 2026-11-24, the load-time check of the intrinsic constructor: root 28.82 KiB (measured 28.79, 29482 B), `./openapi` 10.87 KiB
// (measured 10.85, 11111 B) and `./http` 8.30 KiB (measured 8.28, 8474 B). The growth is code, with no module added to a
// bundle: the comparison of the constructor's `prototype` with the prototype of an async function's promise, and the throw
// that refuses the import, inlined in every subpath.
// 2026-11-24, the refusal of a native promise with an own `constructor` or `then`: root 28.99 KiB (measured 28.97, 29661 B). The
// growth is code, with no module added to a bundle: the check of the own slots after the pin, and the hearing of the
// rejection through the `then` captured at load.
// 2026-11-24, a refused own-slot promise keeps its run in flight and aborts its indicator signal: root 29.12 KiB (measured
// 29791 B). The growth is code, with no module added to a bundle: `afterSettled`, the pin of the promise it returns, `listen`
// and the own-data reads of a constructor descriptor.
// 2026-11-24, PM grant (core 16b.17(g)): root 29.37 KiB (measured 30041 B), `./openapi` 11.02 KiB (measured 11253 B) and
// `./http` 8.54 KiB (measured 8718 B). The growth is code, with no module added to a bundle: the `Promise[Symbol.species]`
// entry and its load-time check, and the option copy and the readiness collection rewritten as index loops, which every
// subpath that copies options inlines.
// 2026-11-24, loops without a `<=` bound: root 29.46 KiB (measured 30126 B, was 30054 B) and `./http` 8.60 KiB (measured
// 8774 B, was 8719 B). The growth is code, with no module added to a bundle: the length read once into a local, and the
// `!==` comparison it ends the loop on, in the cycle check, the list copy, the option reads and the readiness collection.
// `./openapi` measured 11276 B against its unchanged 11.02 KiB.
// 2026-11-25, the writers of the response left out by the request deadline: root 29.49 KiB (measured 30161 B) and `./http`
// 8.74 KiB (measured 8915 B). The growth is code, with no module added to a bundle: the guard of the head writers, the
// wider list of writers and the late `writeHead` that passes only the status.
// 2026-11-25, `./idempotency` 5.47 KiB (measured 5566 B), up from the 1 KiB of the port and the in-memory store alone. The
// growth is the decorator, the interceptor, the key and fingerprint, the capture and replay of an answer, and the options;
// the shared host-error, log and option-check modules every subpath inlines come with them. No module that is not already
// in another bundle entered it, and the rationale of each file sits in its header and in types-only files. The last 48 B are the
// pattern that reads only a built-in parameter key, which keeps a custom parameter decorator from being refused at boot.
// 2026-11-25, `./idempotency` 5.62 KiB (measured 5747 B): the status the handler set is captured and replayed, the stored body is
// `JSON.stringify` with the binary, stream and non-object-JSON answers refused, a serialisation failure is logged, and the interceptor
// awaits instead of chaining `.then`, which the Promise-statics scan refuses. All code; the comment of each was cut to one line and
// the rationale sits in the README and the types-only files.
// 2026-11-24, `./idempotency` 5.66 KiB (measured 5780 B): a status of 500 or more set through the response releases the claim like a
// thrown error, and a body is refused when its serialisation differs between two calls. Two statements, with no module added.
// 2026-11-25, `./idempotency` 6.14 KiB (measured 6.13 KiB), up from 5.66 KiB: the stored answer is the one taken at the wire, so the
// tap on the raw response (hold, size bound, substitute on replay) replaces the stringify path that read the handler's value. All code,
// with no module added to the bundle; the tap is split into three functions to stay under the 50-line limit, which costs the extra parameters. The rationale of the tap sits in the README and in the doc comment of each function.
// 2026-11-25, `./idempotency` 6.17 KiB (measured 6.16 KiB), from 6.14: the serialised-header bound the store port states is checked before a
// stored answer is kept. One constant and one statement; no module added to the bundle.
// 2026-11-25, `./idempotency` 6.62 KiB (measured 6.61 KiB), from 6.17: the tap and the replacement now read every signature of the three
// writers of `node:http` (reason phrase, flat or paired header lists, write and end callbacks), set the length of a held body that has none,
// leave a 204 replay without one, and refuse `@Render` at boot. All code, no module added to the bundle; stripped of comments the bundle is
// 6.02 KiB, so the prose that remains is the doc comments of the functions, which state the constraints of the signatures they parse.
// 2026-11-25, `./idempotency` 6796 B (measured 6766 B, plus 30 B of headroom), from 6.62 KiB: a held body sent without a head of its own
// is given the status the route set, so its length is stated like that of a body with one. One statement; no module added to the bundle.
// 2026-11-25, `./idempotency` 7190 B (measured 7160 B, plus 30 B of headroom), from 6796 B: a second registration of the
// interceptor passes through, and a urlencoded body parsed on Fastify is fingerprinted. One module added, `idempotency.nesting`,
// over `node:async_hooks`, and two predicates for the parser's prototype and its accessors. The growth is code: stripped of
// comments the bundle went from 6124 B to 6533 B.
// 2026-11-26, `./idempotency` 7304 B (measured 7281 B, plus 23 B of headroom), from 7190 B: an answer over `maxBodyBytes` is
// marked on the wire and logged, and the interceptor's log calls name their event as a literal the README catalog test reads.
// Code and two comment lines; no module added to the bundle; stripped of comments the bundle went from 6533 B to 6614 B.
const BUDGETS = [
  { name: '. (root)', path: 'dist/index.mjs', brotli: 29.49 * 1024 },
  { name: './pagination', path: 'dist/pagination/index.mjs', brotli: 1.5 * 1024 },
  { name: './health', path: 'dist/health/index.mjs', brotli: 0.5 * 1024 },
  { name: './openapi', path: 'dist/openapi/index.mjs', brotli: 11.02 * 1024 },
  { name: './metrics', path: 'dist/metrics/index.mjs', brotli: 0.5 * 1024 },
  { name: './http', path: 'dist/http/index.mjs', brotli: 8.74 * 1024 },
  { name: './idempotency', path: 'dist/idempotency/index.mjs', brotli: 7304 }
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
