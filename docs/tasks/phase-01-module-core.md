# Phase 1: module-core

> **Status**: 🔄 In Progress · **Progress**: 1 / 6 tasks · **Last updated**: 2026-07-16
> **Source roadmap**: [`../development_plan.md`](../development_plan.md) (P1)
> **Source spec**: [`../technical_specification.md`](../technical_specification.md) §2, §4, §10

---

## Context

This phase builds the dynamic-module skeleton every feature plugs into: the options surface with defaults, the Symbol token set, the shared `BYMAX_*` error-code catalog, the no-op default bindings, and the conditional registration machinery for both the sync (`forRoot`) and async (`forRootAsync`) paths. No feature behavior lands here; phases 2 through 6 attach the real filter, interceptor, controllers, and helpers to the slots created now.

The error-code catalog lives in this phase (not in the envelope phase) because both the exception filter (phase 2) and the cursor codec (phase 4) consume it; placing it in the shared foundation keeps the feature phases free of cross-dependencies.

Expected starting state: phase 0 merged; the repository builds, lints, and tests green with placeholder barrels.

---

## Rules-of-phase

1. **One PR for the whole phase** on `feat/phase-01-module-core`, closed with CI green and a GitHub Copilot review addressed.
2. **No feature behavior.** Pass-through implementations must be observably indistinguishable from absence and add no measurable per-request work.
3. **TDD.** Write the failing spec before each unit; 100% coverage holds at every commit.
4. **All DI tokens are `Symbol`s**; every constructor parameter and factory `inject` entry uses explicit `@Inject(token)`.
5. **`ConfigurableModuleBuilder`** is the module mechanism; `isGlobal` maps through `setExtras` (default `true`); no manual `@Global()`.
6. Timeless, English-only comments; no em dashes; no `.gitkeep`.

---

## Reference docs

- [`../development_plan.md`](../development_plan.md): P1 block and Global Conventions.
- [`../technical_specification.md`](../technical_specification.md): §2.2 (conditional registration), §4.1 (options), §4.2 (registration), §4.3 (tokens), §10 (error-code catalog).
- Sibling prior art for the builder + conditional registration pattern: `@bymax-one/nest-logger` (module file).

---

## Task index

| ID  | Task                                                      | Status  | Priority | Size | Depends on              |
| --- | --------------------------------------------------------- | ------- | -------- | ---- | ----------------------- |
| 1.1 | Branch, Symbol tokens, `BYMAX_*` error-code catalog       | ✅ Done | P0       | S    | none                    |
| 1.2 | Options types, defaults, normalization (deep freeze)      | 📋 ToDo | P0       | M    | 1.1                     |
| 1.3 | `BymaxCoreModule.forRoot` (sync conditional registration) | 📋 ToDo | P0       | M    | 1.2                     |
| 1.4 | `forRootAsync` with gated pass-through slots              | 📋 ToDo | P0       | M    | 1.3                     |
| 1.5 | Default bindings, barrel exports, override tests          | 📋 ToDo | P0       | M    | 1.4                     |
| 1.6 | Phase close: verification, PR, Copilot review, merge      | 📋 ToDo | P0       | S    | 1.1, 1.2, 1.3, 1.4, 1.5 |

---

## Tasks

### Task 1.1: Branch, Symbol tokens, `BYMAX_*` error-code catalog

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: S
- **Depends on**: none

#### Description

Create the phase branch, the token module, and the status-to-code catalog with its derivation helper, fully tested.

#### Acceptance criteria

- [x] Branch `feat/phase-01-module-core` created with `git switch -c`.
- [x] `src/core.tokens.ts` exports the five Symbol tokens from spec §4.3, each with imperative JSDoc.
- [x] `src/envelope/error-codes.ts` exports the `BYMAX_*` code constants and `codeForStatus(status: number): string` implementing the full table of spec §10 including the `BYMAX_CLIENT_ERROR` and `BYMAX_INTERNAL_ERROR` fallbacks.
- [x] Tests cover every mapped status plus the two fallbacks; 100% coverage holds.

#### Files to create / modify

- `src/core.tokens.ts`, `src/envelope/error-codes.ts`, `src/envelope/error-codes.spec.ts`

#### Agent prompt

```
You are a senior NestJS library engineer working on @bymax-one/nest-core.

PROJECT: @bymax-one/nest-core, application foundation kit for NestJS 11: error envelope, request
timing, pagination, health, optional Prometheus metrics. Public npm, zero direct deps, three
subpaths. Explicit @Inject(Symbol) DI everywhere.

CURRENT PHASE: 1 (module-core), Task 1.1 of 6 (FIRST)

PRECONDITIONS
- Phase 0 merged: build, lint, and test:cov green on main with placeholder barrels.

REQUIRED READING (only these)
- docs/technical_specification.md §4.3 (DI tokens) and §10 (error code catalog).

TASK
Create the phase branch, the Symbol token set, and the error-code catalog with tests (TDD).

DELIVERABLES
1. `git switch -c feat/phase-01-module-core` (NEVER git checkout -b).
2. src/core.tokens.ts: export const BYMAX_CORE_OPTIONS, BYMAX_CORRELATION_PROVIDER,
   BYMAX_TIMING_SINK, BYMAX_HEALTH_INDICATORS, BYMAX_METRICS_REGISTRY, each `= Symbol('<name>')`,
   each with a one-line imperative JSDoc. @fileoverview + @layer Constants header.
3. src/envelope/error-codes.ts: the BYMAX_* string constants and codeForStatus(status) mapping
   exactly the spec §10 table (400, 401, 403, 404, 409, 413, 415, 422, 429, 500, 501, 502, 503,
   504, other 4xx to BYMAX_CLIENT_ERROR, everything else to BYMAX_INTERNAL_ERROR). Validation is
   a shape decision made by the filter, not by this map; do not special-case it here.
4. src/envelope/error-codes.spec.ts: table-driven test covering every row plus both fallbacks;
   every it() carries a block comment (scenario + rule protected). Write the spec first.

Constraints:
- TypeScript strict, zero any, no suppression comments; functions <= 50 lines.
- @fileoverview + @layer header per file; imperative JSDoc on exports.
- Timeless, English-only comments; no em dashes; no .gitkeep.
- Never add Co-Authored-By, "Generated with", or any AI-attribution line to commits, PR titles,
  PR bodies, or comments.

Verification:
- `pnpm test:cov`: green, 100% on the new files.
- `pnpm lint && pnpm typecheck`: green.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in the per-task block and the Task index row.
2. Tick the satisfied acceptance-criteria checkboxes.
3. Bump the phase Progress counter (X / 6) in the header blockquote.
4. Append a Completion log entry: `- 1.1 ✅ <YYYY-MM-DD>: <one-line summary>`.
5. Update the P1 row in ../development_plan.md (canonical) and mirror docs/tasks/README.md.
6. Recompute the overall counter line in ../development_plan.md.
7. Commit on the phase branch: `feat(core): add DI tokens and error-code catalog (1.1)`.
```

---

### Task 1.2: Options types, defaults, normalization

- **Status**: 📋 ToDo
- **Priority**: P0
- **Size**: M
- **Depends on**: 1.1

#### Description

The `BymaxCoreModuleOptions` surface, the documented defaults, and the normalization function that merges defaults and deep-freezes the result.

#### Acceptance criteria

- [ ] `src/core.options.ts` matches spec §4.1 exactly (envelope, timing, health, metrics blocks, all optional with documented defaults).
- [ ] `normalizeCoreOptions(raw?)` returns a fully-populated, deep-frozen options object; defaults: envelope enabled, timing enabled, health enabled (`path: 'health'`, `indicatorTimeoutMs: 5000`), metrics disabled (`path: 'metrics'`, `collectDefaultMetrics: true`).
- [ ] Mutating any nested field of the normalized object throws in strict mode (frozen), covered by test.
- [ ] 100% coverage holds.

#### Files to create / modify

- `src/core.options.ts`, `src/core.options.spec.ts`

#### Agent prompt

```
You are a senior NestJS library engineer working on @bymax-one/nest-core.

PROJECT: @bymax-one/nest-core, application foundation kit for NestJS 11. Configuration over
convention: everything enters through forRoot/forRootAsync options with documented defaults.

CURRENT PHASE: 1 (module-core), Task 1.2 of 6

PRECONDITIONS
- Task 1.1 done: tokens and error-code catalog exist on feat/phase-01-module-core.

REQUIRED READING (only these)
- docs/technical_specification.md §4.1 (the exact options interface) and §2.2 (defaults table).

TASK
Author the options types, defaults, and the normalize + deep-freeze function, test-first.

DELIVERABLES
1. src/core.options.ts: BymaxCoreModuleOptions exactly per spec §4.1 (JSDoc on every field,
   defaults stated in the JSDoc); a ResolvedCoreOptions type with every field required; the
   DEFAULT_CORE_OPTIONS constant; normalizeCoreOptions(raw?: BymaxCoreModuleOptions):
   ResolvedCoreOptions performing a per-feature shallow merge over the defaults and returning a
   deep-frozen object (Object.freeze applied recursively; a small local deepFreeze helper).
2. src/core.options.spec.ts, written first: empty input yields the documented defaults; partial
   input merges per feature without dropping sibling defaults; the result and every nested block
   are frozen (mutation throws); exhaustive branch coverage of the merge.

Constraints:
- TypeScript strict, zero any; exactOptionalPropertyTypes discipline (do not assign undefined).
- Functions <= 50 lines; @fileoverview + @layer Config header; imperative JSDoc.
- Timeless, English-only comments; no em dashes.
- Never add Co-Authored-By, "Generated with", or any AI-attribution line to commits, PR titles,
  PR bodies, or comments.

Verification:
- `pnpm test:cov`: green, 100%.
- `pnpm lint && pnpm typecheck`: green.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in the per-task block and the Task index row.
2. Tick the satisfied acceptance-criteria checkboxes.
3. Bump the phase Progress counter (X / 6).
4. Append a Completion log entry: `- 1.2 ✅ <YYYY-MM-DD>: <one-line summary>`.
5. Update the P1 row in ../development_plan.md (canonical) and mirror docs/tasks/README.md.
6. Recompute the overall counter line in ../development_plan.md.
7. Commit: `feat(core): add module options and normalization (1.2)`.
```

---

### Task 1.3: `BymaxCoreModule.forRoot` (sync conditional registration)

- **Status**: 📋 ToDo
- **Priority**: P0
- **Size**: M
- **Depends on**: 1.2

#### Description

The dynamic module on `ConfigurableModuleBuilder` with the sync path: disabled features are omitted from providers and controllers at module-definition time.

#### Acceptance criteria

- [ ] `BymaxCoreModule.forRoot(options)` built on `ConfigurableModuleBuilder`, `isGlobal` extra mapped via `setExtras` (default `true`).
- [ ] With every feature disabled, the returned `DynamicModule` registers zero feature providers and zero controllers (asserted structurally in tests).
- [ ] `BYMAX_CORE_OPTIONS` resolves to the normalized frozen options in a testing module.
- [ ] `isGlobal: false` yields a non-global module; default is global.
- [ ] 100% coverage holds.

#### Files to create / modify

- `src/core.module.ts`, `src/core.module.spec.ts`

#### Agent prompt

```
You are a senior NestJS library engineer working on @bymax-one/nest-core.

PROJECT: @bymax-one/nest-core, application foundation kit for NestJS 11. Dynamic module on
ConfigurableModuleBuilder; opt-in features; a disabled feature adds zero providers.

CURRENT PHASE: 1 (module-core), Task 1.3 of 6

PRECONDITIONS
- Tasks 1.1 and 1.2 done: tokens, catalog, options + normalization exist.

REQUIRED READING (only these)
- docs/technical_specification.md §2.2 (conditional registration, sync path) and §4.2.
- Prior art for builder + augmentation: the module file of the sibling ../nest-logger/src (read
  only the module file).
- Official NestJS 11 ConfigurableModuleBuilder docs: verify current API via context7
  (resolve-library-id "nestjs" then query-docs for ConfigurableModuleBuilder, setExtras) before
  coding; do not code the builder API from memory.

TASK
Implement the sync registration path, test-first.

DELIVERABLES
1. src/core.module.ts: ConfigurableModuleBuilder<BymaxCoreModuleOptions> with setExtras for
   isGlobal (default true) mapping to DynamicModule.global; forRoot(options) normalizes via
   normalizeCoreOptions, provides BYMAX_CORE_OPTIONS with the frozen result, and conditionally
   appends feature providers/controllers arrays (empty placeholders for now; phases 2 to 6 add
   the real classes through the registration helpers you define here: a small internal
   buildSyncProviders(resolved) / buildControllers(resolved) pair that currently returns []).
2. src/core.module.spec.ts, written first: all-disabled forRoot registers no feature providers
   and no controllers; BYMAX_CORE_OPTIONS resolves frozen and normalized; isGlobal default true,
   false yields non-global (assert on the returned DynamicModule shape).

Constraints:
- Explicit @Inject(token) on any factory inject; Symbol tokens only.
- TypeScript strict, zero any; functions <= 50 lines; @fileoverview + @layer Module header.
- Timeless, English-only comments; no em dashes.
- Never add Co-Authored-By, "Generated with", or any AI-attribution line to commits, PR titles,
  PR bodies, or comments.

Verification:
- `pnpm test:cov`: green, 100%.
- `pnpm lint && pnpm typecheck && pnpm build`: green.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in the per-task block and the Task index row.
2. Tick the satisfied acceptance-criteria checkboxes.
3. Bump the phase Progress counter (X / 6).
4. Append a Completion log entry: `- 1.3 ✅ <YYYY-MM-DD>: <one-line summary>`.
5. Update the P1 row in ../development_plan.md (canonical) and mirror docs/tasks/README.md.
6. Recompute the overall counter line in ../development_plan.md.
7. Commit: `feat(core): add BymaxCoreModule.forRoot with conditional registration (1.3)`.
```

---

### Task 1.4: `forRootAsync` with gated pass-through slots

- **Status**: 📋 ToDo
- **Priority**: P0
- **Size**: M
- **Depends on**: 1.3

#### Description

The async path: options resolve from an injected factory; `APP_FILTER` and `APP_INTERCEPTOR` slots register unconditionally and gate inside factories with transparent pass-throughs.

#### Acceptance criteria

- [ ] `forRootAsync({ inject, useFactory })` resolves and normalizes options from the factory.
- [ ] `APP_FILTER` and `APP_INTERCEPTOR` slots are always registered on the async path; with the feature disabled, the bound implementation is a transparent pass-through (request and response flow unchanged, asserted by test).
- [ ] Controllers that cannot register conditionally on the async path fail fast with a descriptive configuration error if reached while disabled (per spec §2.2), covered by test.
- [ ] 100% coverage holds.

#### Files to create / modify

- `src/core.module.ts`, `src/passthrough.providers.ts`, `src/core.module-async.spec.ts`

#### Agent prompt

```
You are a senior NestJS library engineer working on @bymax-one/nest-core.

PROJECT: @bymax-one/nest-core, application foundation kit for NestJS 11. Async registration
cannot know options at definition time, so pipeline slots gate inside factories with transparent
pass-throughs (the established pattern of the @bymax-one module family).

CURRENT PHASE: 1 (module-core), Task 1.4 of 6

PRECONDITIONS
- Task 1.3 done: forRoot sync path works and is tested.

REQUIRED READING (only these)
- docs/technical_specification.md §2.2 (async path rules) and §4.2 (forRootAsync example).

TASK
Implement forRootAsync with gated pass-through slots, test-first.

DELIVERABLES
1. src/passthrough.providers.ts: a pass-through ExceptionFilter (rethrows untouched via the host)
   and a pass-through NestInterceptor (returns next.handle() directly), each documented as
   intentionally indistinguishable from absence. @fileoverview + @layer Provider.
2. src/core.module.ts: forRootAsync({ imports?, inject, useFactory }) providing
   BYMAX_CORE_OPTIONS through an async factory that normalizes the resolved options; APP_FILTER
   and APP_INTERCEPTOR registered always, each via a factory injecting BYMAX_CORE_OPTIONS and
   returning the real implementation when the feature is enabled (wired in later phases through
   the same seam) or the pass-through otherwise; a documented descriptive error for async +
   controller-bearing features when the resolved options disable them after registration
   decisions were needed (health/metrics handling lands in phases 5 and 6 through this seam).
3. src/core.module-async.spec.ts, written first: factory injection resolves and normalizes;
   pass-through slots leave a request observably unchanged (use a minimal Nest testing module
   with a dummy controller and supertest, or mocked ExecutionContext per the family convention);
   explicit @Inject in every factory.

Constraints:
- Explicit @Inject(Symbol) everywhere; TypeScript strict, zero any; functions <= 50 lines.
- Timeless, English-only comments; no em dashes.
- Run the suite bounded: never two Jest runners in parallel.
- Never add Co-Authored-By, "Generated with", or any AI-attribution line to commits, PR titles,
  PR bodies, or comments.

Verification:
- `pnpm test:cov`: green, 100%.
- `pnpm lint && pnpm typecheck && pnpm build`: green.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in the per-task block and the Task index row.
2. Tick the satisfied acceptance-criteria checkboxes.
3. Bump the phase Progress counter (X / 6).
4. Append a Completion log entry: `- 1.4 ✅ <YYYY-MM-DD>: <one-line summary>`.
5. Update the P1 row in ../development_plan.md (canonical) and mirror docs/tasks/README.md.
6. Recompute the overall counter line in ../development_plan.md.
7. Commit: `feat(core): add forRootAsync with gated pass-through slots (1.4)`.
```

---

### Task 1.5: Default bindings, barrel exports, override tests

- **Status**: 📋 ToDo
- **Priority**: P0
- **Size**: M
- **Depends on**: 1.4

#### Description

No-op default bindings for the pluggable contracts, the public barrel for the `.` subpath, and proof that consumers can override every default through standard providers.

#### Acceptance criteria

- [ ] `ICorrelationIdProvider` and `ITimingSink` contracts defined (spec §5.3, §6.1) with no-op defaults bound to their tokens; `BYMAX_HEALTH_INDICATORS` defaults to an empty array.
- [ ] Consumer override via a standard provider (`useValue`/`useExisting`/`useClass`) replaces each default, asserted in tests.
- [ ] `src/index.ts` exports the module, options types, tokens, contracts, and error codes; no internal file leaks.
- [ ] Dogfood smoke test passes; 100% coverage holds.

#### Files to create / modify

- `src/envelope/correlation.interfaces.ts`, `src/timing/timing.interfaces.ts`, `src/defaults.providers.ts`, `src/index.ts`, `src/defaults.providers.spec.ts`

#### Agent prompt

```
You are a senior NestJS library engineer working on @bymax-one/nest-core.

PROJECT: @bymax-one/nest-core, application foundation kit for NestJS 11. Integration by contract:
correlation ids, timing sinks, and health indicators are interfaces on Symbol tokens with no-op
defaults; any implementation plugs in, no hard dependency on sibling libraries.

CURRENT PHASE: 1 (module-core), Task 1.5 of 6

PRECONDITIONS
- Task 1.4 done: both registration paths work and are tested.

REQUIRED READING (only these)
- docs/technical_specification.md §5.3 (ICorrelationIdProvider), §6.1 (ITimingSink,
  RequestTimingSample), §4.3 (default bindings table).

TASK
Define the pluggable contracts, bind no-op defaults, expose the public barrel, test-first.

DELIVERABLES
1. src/envelope/correlation.interfaces.ts: ICorrelationIdProvider { getCorrelationId(): string |
   undefined } with imperative JSDoc. src/timing/timing.interfaces.ts: RequestTimingSample and
   ITimingSink { record(sample): void } exactly per spec §6.1.
2. src/defaults.providers.ts: no-op correlation provider (returns undefined), no-op timing sink,
   empty indicators array; default providers wired into both registration paths so the tokens
   always resolve.
3. src/index.ts: export BymaxCoreModule, options types, the five tokens, the contracts, error
   codes and codeForStatus. Nothing else; barrels are selective, no export * over internals.
4. src/defaults.providers.spec.ts, written first: each token resolves its no-op default in a bare
   testing module; a consumer-provided override (useValue for the sink, useExisting for the
   correlation provider, multi-style array for indicators per the spec's registration approach)
   replaces the default and is the instance the module resolves.

Constraints:
- Explicit @Inject(Symbol); TypeScript strict, zero any; selective barrel (no internal leakage).
- Timeless, English-only comments; no em dashes.
- Never add Co-Authored-By, "Generated with", or any AI-attribution line to commits, PR titles,
  PR bodies, or comments.

Verification:
- `pnpm test:cov`: green, 100%.
- `pnpm build && node scripts/dogfood-smoke-test.mjs`: all subpaths resolve; the "." subpath now
  exports the real module surface.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in the per-task block and the Task index row.
2. Tick the satisfied acceptance-criteria checkboxes.
3. Bump the phase Progress counter (X / 6).
4. Append a Completion log entry: `- 1.5 ✅ <YYYY-MM-DD>: <one-line summary>`.
5. Update the P1 row in ../development_plan.md (canonical) and mirror docs/tasks/README.md.
6. Recompute the overall counter line in ../development_plan.md.
7. Commit: `feat(core): add pluggable contracts, no-op defaults, and public barrel (1.5)`.
```

---

### Task 1.6: Phase close: verification, PR, Copilot review, merge

- **Status**: 📋 ToDo
- **Priority**: P0
- **Size**: S
- **Depends on**: 1.1, 1.2, 1.3, 1.4, 1.5

#### Description

Audit the phase Definition of Done, update dashboards, open the phase PR, obtain and address the GitHub Copilot review, merge on green.

#### Acceptance criteria

- [ ] Every P1 Definition of Done checkbox in `../development_plan.md` verified and ticked.
- [ ] Phase file, plan dashboard, and README index consistent.
- [ ] PR from `feat/phase-01-module-core` with CI green and Copilot review resolved; merged, branch deleted.

#### Files to create / modify

- This file (statuses), `../development_plan.md`, `README.md` (folder index)

#### Agent prompt

```
You are a senior release engineer closing a development phase of @bymax-one/nest-core.

PROJECT: @bymax-one/nest-core. One PR per phase; GitHub Copilot code review is a mandatory gate.

CURRENT PHASE: 1 (module-core), Task 1.6 of 6 (LAST)

PRECONDITIONS
- Tasks 1.1 through 1.5 done and committed on feat/phase-01-module-core; local gates green.

REQUIRED READING (only these)
- ../development_plan.md: P1 block (Definition of Done) and Progress Dashboard.
- docs/tasks/phase-01-module-core.md: task index and completion log.

TASK
Close phase 1 through its pull request with a GitHub Copilot review.

DELIVERABLES
1. Verify each P1 DoD item by running the command or test it implies; tick the checkboxes in
   ../development_plan.md.
2. Update dashboards: this phase file (header, index, log), the P1 row and overall counter in
   ../development_plan.md, the folder index in docs/tasks/README.md.
3. `gh pr create --title "feat(core): phase 1, dynamic module core" --body <professional
   summary: options surface, token set, catalog, both registration paths, coverage proof>`.
4. Request a GitHub Copilot code review (Reviewers panel, or `gh pr edit <number> --add-reviewer
   copilot-pull-request-reviewer[bot]` when available). Address every finding with a fix commit
   or a reasoned reply; re-request after fixes.
5. Merge on green: `gh pr merge --squash --delete-branch`; confirm main is green after merge.

Constraints:
- Never merge with red or pending CI; never dismiss a Copilot finding silently.
- Never add Co-Authored-By, "Generated with", or any AI-attribution line to commits, PR titles,
  PR bodies, or comments.

Verification:
- `gh pr checks <number>`: all green. `gh pr view <number> --json reviews`: Copilot review
  present and resolved. Post-merge main: `pnpm build && pnpm test:cov` green.

Completion Protocol (after you finish):
1. Set this task's Status to ✅; phase header Status ✅, Progress 6 / 6.
2. Tick the satisfied acceptance-criteria checkboxes.
3. Append: `- 1.6 ✅ <YYYY-MM-DD>: phase PR merged with Copilot review`.
4. Update the P1 row (✅, 100%) and overall counter in ../development_plan.md; mirror README.md.
5. Commit dashboard updates post-merge as `docs(core): close phase 1 dashboards (1.6)`.
```

---

## Completion log

<!-- Append one line per completed task: - <id> ✅ <YYYY-MM-DD>: <summary> -->

- 1.1 ✅ 2026-07-16: Symbol DI tokens and the `BYMAX_*` error-code catalog with `codeForStatus`; 100% covered.
