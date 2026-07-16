# Development Plan: @bymax-one/nest-core

> **Version:** 1.0.0
> **Last updated:** 2026-07-06
> **Status:** Draft for execution
> **Source spec:** [`docs/technical_specification.md`](./technical_specification.md)
> **Scope:** Phased execution plan from empty repository to the first public release (v0.1.0)

---

## Status Legend

| Emoji | Meaning     |
| ----- | ----------- |
| 📋    | ToDo        |
| 🔄    | In Progress |
| 👀    | Review      |
| ✅    | Done        |
| ⛔    | Blocked     |
| 🟡    | Partial     |

---

## Progress Dashboard

> **Overall: 3 / 9 phases done (33%)** · Active phase: P3 · Blocked: none

| ID  | Phase                | Status | Progress | Size | Last Updated |
| --- | -------------------- | ------ | -------- | ---- | ------------ |
| P0  | repository-scaffold  | ✅     | 100%     | M    | 2026-07-16   |
| P1  | module-core          | ✅     | 100%     | M    | 2026-07-16   |
| P2  | error-envelope       | ✅     | 100%     | M    | 2026-07-16   |
| P3  | timing-interceptor   | 🔄     | 75%      | S    | 2026-07-16   |
| P4  | pagination           | 📋     | 0%       | M    | 2026-07-06   |
| P5  | health               | 📋     | 0%       | M    | 2026-07-06   |
| P6  | metrics              | 📋     | 0%       | M    | 2026-07-06   |
| P7  | integration-and-docs | 📋     | 0%       | M    | 2026-07-06   |
| P8  | release-hardening    | 📋     | 0%       | L    | 2026-07-06   |

---

## Dependency Graph

```
P0 ── P1 ──┬── P2 ───────────┐
           ├── P3 ──── P6 ───┤
           ├── P4 ───────────┼── P7 ── P8
           └── P5 ───────────┘
```

- **Critical path:** P0 → P1 → P3 → P6 → P7 → P8
- P6 (metrics) requires P3 (timing) because the default HTTP metrics are fed by the timing sink bridge.
- P7 starts only when every feature phase (P2, P3, P4, P5, P6) is done.

## Parallelization Notes

- **P2, P3, P4, P5 are mutually independent** once P1 lands: they touch disjoint directories (`envelope/`, `timing/`, `pagination/`, `health/`) and share only the tokens, options, and error-code catalog created in P1. Any subset can run in parallel.
- **P6 joins the parallel set** as soon as P3 is done; it does not wait for P2, P4, or P5.
- **P0, P1, P7, P8 are strictly sequential** with respect to everything else: P0 and P1 are the foundation every phase builds on; P7 and P8 need the full feature surface.
- Parallel execution applies to code work, not to test runs: test suites are executed sequentially, one runner at a time, with the bounded worker pool set in the Jest configs.

---

## Global Conventions

These apply to every phase. Phase sections list only rules specific to that phase.

1. **TypeScript strict, zero `any`.** `strict: true`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`. No suppression comments (`@ts-ignore`, `eslint-disable`).
2. **Clean Code sizing.** Functions at most 50 lines; files at most 800 lines (200 to 400 typical). Split by responsibility when a limit approaches.
3. **Explicit DI everywhere.** Every provider constructor parameter and every factory `inject` entry uses `@Inject(token)` with a `Symbol` token. The published bundle is built without `emitDecoratorMetadata`; implicit class-type injection is never relied upon.
4. **Packaging discipline.** `dependencies` stays empty. Required peers: `@nestjs/common` ^11, `@nestjs/core` ^11, `reflect-metadata` ^0.2, `rxjs` ^7. Optional peer: `prom-client` ^15 (declared in `peerDependenciesMeta`, loaded lazily, only when metrics are enabled). Same versions mirrored in `devDependencies`.
5. **Subpath builds.** tsup produces ESM + CJS + `.d.ts` for the three subpaths (`.`, `./pagination`, `./health`). No deep imports into `dist`; the `exports` map is the only public surface.
6. **Test gates.** Jest with 100% line/branch/function/statement coverage enforced in both Jest configs from the first phase onward. Every `it()` carries a block comment stating the scenario and the rule it protects. TDD is the working mode: tests are written with (or before) the code in every phase.
7. **Mutation testing is a pre-release gate**, not a per-phase gate. Stryker runs in P8 with thresholds `high: 99, low: 95, break: 95`.
8. **Comments are timeless and English-only.** They explain what the code does and why it is shaped that way. No references to plan stages, phase numbers, or task identifiers anywhere in committed source.
9. **Conventional Commits**, enforced locally by commitlint through husky and again in CI.
10. **ESLint flat config with restricted imports.** Bare `crypto`, `bcrypt`, `argon2`, `uuid`, `nanoid`, and `crypto-js` are banned; `node:` builtins are the only source of cryptography and identifiers.

---

## Phase Details

### P0: repository-scaffold

- **Goal:** A buildable, lintable, testable empty package with the full repository standard in place, so every later phase only adds source and tests.
- **Scope (in):** `package.json` (name, version 0.1.0-alpha.0, exports map for the three subpaths, scripts, peers per convention 4, engines `node >= 24`, `publishConfig` public); tsup config with three entries; the tsconfig set (base, build, jest, e2e variants); ESLint flat config; both Jest configs with the 100% threshold; Stryker config; husky, commitlint, lint-staged; `README.md` skeleton with badges, `LICENSE` (MIT), `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1 by reference), `CHANGELOG.md`; `.github/workflows/` (`ci`, `codeql`, `scorecard`, `release`), `dependabot.yml`, issue templates; `scripts/check-size.mjs` with provisional budgets and `scripts/dogfood-smoke-test.mjs` with the three subpaths.
- **Scope (out):** Any feature source; README feature documentation (P7); budget calibration (P8).
- **Definition of Done:**
  - [x] `pnpm install`, `pnpm typecheck`, `pnpm lint`, `pnpm build` all pass from a clean clone.
  - [x] `dist/` contains `.mjs`, `.cjs`, and `.d.ts` for `.`, `./pagination`, and `./health` (placeholder barrels).
  - [x] `pnpm test:cov` passes with the 100% threshold active (trivial sources only).
  - [x] Husky blocks a non-conventional commit message locally.
  - [x] CI workflow runs lint, typecheck, build, and tests sequentially on push.
- **Context / preconditions:** Empty repository. The layout, configs, and scripts mirror the structure proven by the sibling `@bymax-one` libraries; adapt names, subpaths, and peers to this package.
- **Rules-of-phase:** No `.gitkeep` files; directories exist only when a real file lands in them. CodeQL and OpenSSF Scorecard workflows ship enabled but only produce results once the repository is public; do not gut them.
- **References:** Spec §3 (package structure), §12 (dependencies), §13 (quality gates and repository standard).
- **Size:** M

### P1: module-core

- **Goal:** The dynamic module skeleton that every feature plugs into: options, defaults, tokens, error-code catalog, and the conditional registration machinery.
- **Scope (in):** `BymaxCoreModuleOptions` with per-feature blocks and documented defaults; options normalization (defaults merge, deep freeze); `BymaxCoreModule` on `ConfigurableModuleBuilder` with `forRoot` and `forRootAsync`, `isGlobal` extra mapped through `setExtras` (default true); the Symbol token set (`BYMAX_CORE_OPTIONS`, `BYMAX_CORRELATION_PROVIDER`, `BYMAX_TIMING_SINK`, `BYMAX_HEALTH_INDICATORS`, `BYMAX_METRICS_REGISTRY`); no-op default bindings for the correlation provider and the timing sink; the `BYMAX_*` error-code catalog and status-derivation table; conditional registration rules (sync path omits disabled providers at definition time; async path registers `APP_FILTER` and `APP_INTERCEPTOR` slots that gate inside a factory with a transparent pass-through).
- **Scope (out):** The real filter, interceptor, controllers, and helpers (P2 to P6). The catalog file lands here so P2 and P4 can share it; the filter that emits the codes is P2.
- **Definition of Done:**
  - [x] `forRoot` with every feature disabled registers zero feature providers and zero controllers.
  - [x] `forRootAsync` resolves options from an injected factory and the pass-through slots are observably transparent (a request flows unchanged).
  - [x] `isGlobal: false` produces a non-global module; default is global.
  - [x] All tokens are `Symbol`s; every token bound in this phase (options, correlation provider, timing sink, health indicators) resolves in a testing module and overriding a default binding works via a consumer provider. The metrics registry token is defined here but bound only when the metrics feature is enabled.
  - [x] 100% coverage holds.
- **Context / preconditions:** P0 done. The registration pattern follows the convention established across the `@bymax-one` module family.
- **Rules-of-phase:** No feature behavior in this phase; the pass-through implementations must be indistinguishable from absence in observable behavior and add no measurable per-request work.
- **References:** Spec §2 (architecture), §4 (configuration API), §10 (error code catalog).
- **Size:** M

### P2: error-envelope

- **Goal:** Every error leaving an application follows the stable envelope contract, production-safe by default.
- **Scope (in):** Envelope type and builder (statusCode, code, message, optional details, optional correlationId, timestamp, path); `BymaxExceptionFilter` registered as `APP_FILTER` when enabled; the three mapping rules (HttpException pass-through with code derivation, validation shape to `BYMAX_VALIDATION_FAILED` with structured details, unknown collapse to `BYMAX_INTERNAL_ERROR` with fixed message); `exposeInternals` development switch; `ICorrelationIdProvider` contract consumption with the no-op default; Express and Fastify accessor neutrality for path, method, and status.
- **Scope (out):** GraphQL and RPC context mapping (documented limitation); logging of the original error beyond handing it to the bound provider chain.
- **Definition of Done:**
  - [x] Contract tests pin the exact envelope shape for a mapped HttpException, a validation error, and an unknown error.
  - [x] With `exposeInternals` false, no stack trace or internal message appears in any 500 response; with it true, details carry the original message and stack.
  - [x] A bound correlation provider stamps `correlationId`; the no-op default omits the field.
  - [x] Codes match the catalog for every mapped status, including the 4xx and 5xx fallbacks.
  - [x] 100% coverage holds.
- **Context / preconditions:** P1 done (tokens, catalog, filter slot).
- **Rules-of-phase:** The envelope is a versioned public contract: field additions are minor, changes are major. Tests must assert the serialized JSON shape, not only the TypeScript type.
- **References:** Spec §5 (error envelope), §10 (catalog), §14.1, §14.2 (limitations).
- **Size:** M

### P3: timing-interceptor

- **Goal:** One timing sample per completed request, delivered to a pluggable sink that can never break a request.
- **Scope (in):** `RequestTimingSample` (method, route template, statusCode, durationMs from a monotonic clock, slow flag from `slowRequestThresholdMs`); `ITimingSink` contract; the interceptor covering success and error outcomes; sink exception swallowing.
- **Scope (out):** Any concrete sink beyond the no-op default (the metrics bridge is P6; logger forwarding is documentation).
- **Definition of Done:**
  - [ ] Samples carry the route template, not the raw URL, on both success and error responses.
  - [ ] `slow` is true exactly when duration exceeds the configured threshold; absent threshold means always false.
  - [ ] A sink that throws is silenced and the response is unaffected.
  - [ ] Disabled timing registers nothing on the sync path and is pass-through on the async path.
  - [ ] 100% coverage holds.
- **Context / preconditions:** P1 done.
- **Rules-of-phase:** Monotonic clock only; wall-clock date functions are banned for duration math. Label cardinality discipline (route template) is a contract, not an optimization.
- **References:** Spec §6 (request timing).
- **Size:** S

### P4: pagination

- **Goal:** Framework-neutral offset and cursor pagination primitives on the `./pagination` subpath.
- **Scope (in):** `normalizePageQuery` with clamping and per-call `defaultLimit`/`maxLimit`; `PageResult` builder with computed meta; opaque `base64url` cursor codec (encode, decode with malformed-input rejection mapped to the validation code from the shared catalog); `normalizeCursorQuery`; `buildCursorResult` implementing the fetch-one-extra convention.
- **Scope (out):** Validation-library decorators (consumers layer their own); SQL or ORM awareness of any kind.
- **Definition of Done:**
  - [ ] Property-style tests cover clamping boundaries (page floor, limit floor and cap, defaults).
  - [ ] `decodeCursor(encodeCursor(x))` round-trips; tampered and malformed cursors reject with the documented error code.
  - [ ] `buildCursorResult` trims the extra row and yields `nextCursor: null` on the last page.
  - [ ] The subpath imports cleanly with zero NestJS providers involved.
  - [ ] 100% coverage holds.
- **Context / preconditions:** P1 done (shared error-code catalog).
- **Rules-of-phase:** Pure functions only; no module state, no providers. Cursors encode ordering keys only, never sensitive data (documented invariant with a test guarding payload typing).
- **References:** Spec §7 (pagination), §14.4 (cursor discipline).
- **Size:** M

### P5: health

- **Goal:** Liveness and readiness endpoints with a pluggable indicator contract and a stable response shape.
- **Scope (in):** `IHealthIndicator` and `HealthIndicatorResult` contracts on the `./health` subpath; the aggregation service (concurrent execution, per-indicator `indicatorTimeoutMs`, rejection and timeout conversion to `down` entries with diagnostic detail); the controller (`live` always 200 with empty checks; `ready` 200 when all up, 503 otherwise); configurable route prefix; conditional registration.
- **Scope (out):** Built-in indicators for specific technologies (consumers implement against their own clients); dependency ordering between checks (documented limitation).
- **Definition of Done:**
  - [ ] Readiness returns 503 with the failing check named when any indicator is down, times out, or rejects; other checks still report.
  - [ ] Liveness runs zero indicators and always returns the documented shape.
  - [ ] The response JSON matches the versioned contract exactly (contract test).
  - [ ] Disabled health registers no controller and no route.
  - [ ] 100% coverage holds.
- **Context / preconditions:** P1 done.
- **Rules-of-phase:** No dependency on `@nestjs/terminus` (a documented spec decision). One failing indicator must never hide the results of the others.
- **References:** Spec §8 (health), §14.5 (limitation).
- **Size:** M

### P6: metrics

- **Goal:** An optional Prometheus endpoint that costs nothing to consumers who leave it disabled.
- **Scope (in):** Lazy `prom-client` loading inside the registry factory, only when `metrics.enabled` is true; fail-fast boot error naming the missing optional peer and the install command; the metrics controller on the configurable path; `defaultLabels` and `collectDefaultMetrics` options; the internal `ITimingSink` bridge feeding `http_requests_total` and `http_request_duration_seconds` with bounded labels when timing and metrics are both enabled.
- **Scope (out):** Custom application metrics (consumers use the injected registry); cross-replica aggregation.
- **Definition of Done:**
  - [ ] With metrics disabled, `prom-client` is never imported (verified by test) and no controller registers.
  - [ ] Enabling metrics without the peer installed fails at boot with the documented descriptive error.
  - [ ] The endpoint serves Prometheus text format including the two HTTP metrics after requests flow, with `method`, `route`, and `status_code` labels only.
  - [ ] `defaultLabels` appear on scraped output; `collectDefaultMetrics` toggles process metrics.
  - [ ] 100% coverage holds.
- **Context / preconditions:** P1 and P3 done (the bridge is a timing sink).
- **Rules-of-phase:** All `prom-client` access stays behind the lazy factory boundary; no top-level import anywhere in `src/`.
- **References:** Spec §9 (metrics), §12.1 (optional peer).
- **Size:** M

### P7: integration-and-docs

- **Goal:** Prove the whole surface works together the way a real application consumes it, and document it publicly.
- **Scope (in):** An end-to-end fixture application exercising `forRoot` and `forRootAsync` with all features enabled and disabled combinations that matter (envelope + timing + health + metrics together; everything off; async pass-through path); cross-feature assertions (envelope carries the correlation id, timing feeds metrics, readiness reflects a failing indicator); the full `README.md` (feature tour, configuration reference, integration examples including the correlation provider binding and a paginated controller); `CHANGELOG.md` entry for the upcoming release.
- **Scope (out):** Mutation hardening and budget calibration (P8).
- **Definition of Done:**
  - [ ] The e2e suite boots the fixture app and passes against both registration paths.
  - [ ] README documents every option in `BymaxCoreModuleOptions` and every subpath export.
  - [ ] The dogfood smoke test passes: every subpath resolves in ESM and CJS from the packed tarball.
  - [ ] A consumer following only the README reaches a working setup (checked by the fixture mirroring the README example).
- **Context / preconditions:** P2 through P6 done.
- **Rules-of-phase:** E2E tests run with the bounded worker pool, one suite at a time. README examples must compile; they are extracted from or mirrored by fixture code, never pseudocode.
- **References:** Spec §15 (example integration), §13.2 (repository standard).
- **Size:** M

### P8: release-hardening

- **Goal:** First public release with the ecosystem's full quality bar.
- **Scope (in):** Stryker baseline run; survivor hardening to a mutation score of at least 95% (`break: 95`); documenting genuine equivalents in `docs/mutation_testing_results.md`; bundle budget calibration in `scripts/check-size.mjs` against the real artifacts (KiB brotli, tight headroom); `pnpm publish --dry-run` resolution check; version bump to 0.1.0; tag and npm publish with OIDC provenance through the release workflow.
- **Scope (out):** New features of any kind.
- **Definition of Done:**
  - [ ] Mutation score at or above 95% with equivalents documented.
  - [ ] Bundle budgets calibrated to the real artifact sizes with headroom below 2x.
  - [ ] `prepublishOnly` chain (clean, typecheck, lint, full coverage, build) passes.
  - [ ] v0.1.0 is live on the public npm registry with provenance, and the README badges resolve.
- **Context / preconditions:** P7 done. Repository visibility must be public before the provenance release.
- **Rules-of-phase:** Mutation hardening strengthens tests, never weakens code. Budget recalibration is a deliberate, explained change, never an automatic bump.
- **References:** Spec §13.1 (test gates), §12 (packaging).
- **Size:** L

---

## Update Protocol

When a phase changes status:

1. Update the phase's row in the **Progress Dashboard** table (Status, Progress, Last Updated).
2. Update the **overall counter** line above the table (done count and percentage, active phase, blocked list).
3. If the phase is done, verify every Definition of Done checkbox in its section and mark them.
4. Record the completion in the phase's task file completion log once task files exist (they are generated from this plan, one file per phase, under `docs/tasks/`).
5. If a phase becomes ⛔ Blocked, add a one-line reason next to its dashboard row and list it in the overall counter line.
6. Commit the dashboard update together with the work that caused it, using a Conventional Commit scope matching the phase name.
7. This file is the canonical status source; any mirror (task index, README notes) is updated after it, never instead of it.
