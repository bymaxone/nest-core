# Phase 6: metrics

> **Status**: 🔄 In Progress · **Progress**: 3 / 5 tasks · **Last updated**: 2026-07-16
> **Source roadmap**: [`../development_plan.md`](../development_plan.md) (P6)
> **Source spec**: [`../technical_specification.md`](../technical_specification.md) §9, §12.1

---

## Context

This phase delivers the optional Prometheus metrics feature: a lazy `prom-client` registry (optional peer, loaded only when `metrics.enabled` is true), a fail-fast boot error when the peer is missing, the metrics controller on the configurable path, `defaultLabels` and `collectDefaultMetrics` options, and the internal timing-sink bridge feeding `http_requests_total` and `http_request_duration_seconds` with bounded labels.

The governing invariant: **consumers who leave metrics disabled never load `prom-client`** and pay zero cost. All `prom-client` access stays behind the lazy factory boundary; no top-level import anywhere in `src/`.

Expected starting state: phases 1 and 3 merged (the bridge is an `ITimingSink`).

---

## Rules-of-phase

1. **One PR** on `feat/phase-06-metrics`, closed with CI green and a GitHub Copilot review addressed.
2. **No top-level `prom-client` import anywhere in `src/`** (enforced by a lint check or grep in CI and by test).
3. **Bounded label sets**: `method`, `route`, `status_code` only on the HTTP metrics; the route label carries the route template from the timing sample.
4. **Fail fast, descriptively**: enabling metrics without the peer installed produces a boot error naming the package and the install command.
5. TDD, 100% coverage at every commit; timeless English comments; no em dashes; no `.gitkeep`.

---

## Reference docs

- [`../development_plan.md`](../development_plan.md): P6 block.
- [`../technical_specification.md`](../technical_specification.md): §9.1 to §9.3 (behavior, lazy loading, default HTTP metrics), §12.1 (optional peer declaration).

---

## Task index

| ID | Task | Status | Priority | Size | Depends on |
|---|---|---|---|---|---|
| 6.1 | Branch, lazy registry factory with fail-fast peer check | ✅ Done | P0 | M | none |
| 6.2 | Metrics controller (path, text format, defaultLabels, default metrics) | ✅ Done | P0 | M | 6.1 |
| 6.3 | Timing-sink bridge (counter and histogram) | ✅ Done | P0 | M | 6.1 |
| 6.4 | Registration wiring, never-loaded proof, scrape test | 📋 ToDo | P0 | S | 6.2, 6.3 |
| 6.5 | Phase close: verification, PR, Copilot review, merge | 📋 ToDo | P0 | S | 6.1, 6.2, 6.3, 6.4 |

---

## Tasks

### Task 6.1: Branch, lazy registry factory with fail-fast peer check

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: M
- **Depends on**: none

#### Description

The lazy registry factory: dynamic import of `prom-client` inside the factory, fail-fast when missing, `defaultLabels` and `collectDefaultMetrics` applied at creation.

#### Acceptance criteria

- [x] Branch `feat/phase-06-metrics` created with `git switch -c`.
- [x] `prom-client` loads via dynamic import inside the factory only; a grep over `src/` finds no top-level import of it.
- [x] With the peer absent (simulated), enabling metrics throws a boot error naming `prom-client` and `pnpm add prom-client`.
- [x] `defaultLabels` applied to the registry; `collectDefaultMetrics` honored (default true when enabled).
- [x] 100% coverage holds.

#### Files to create / modify

- `src/metrics/metrics.registry.ts`, `src/metrics/metrics.registry.spec.ts`, `package.json` (devDependency `prom-client` for tests)

#### Agent prompt

````
You are a senior NestJS library engineer working on @bymax-one/nest-core.

PROJECT: @bymax-one/nest-core, application foundation kit for NestJS 11. prom-client is an
OPTIONAL peer: consumers who never enable metrics never install it and never load it. All access
stays behind a lazy factory boundary.

CURRENT PHASE: 6 (metrics), Task 6.1 of 5 (FIRST)

PRECONDITIONS
- Phases 1 and 3 merged: BYMAX_METRICS_REGISTRY token exists; ITimingSink seam available.
- prom-client is in devDependencies (tests need it) but NOT in dependencies; it is an optional
  peer per package.json peerDependenciesMeta.

REQUIRED READING (only these)
- docs/technical_specification.md §9.2 (lazy loading, fail-fast) and §9.1.
- Official prom-client Registry API: verify via context7 (resolve-library-id "prom-client" then
  query-docs for Registry, collectDefaultMetrics, setDefaultLabels) before coding; do not code
  the API from memory.

TASK
Create the phase branch and the lazy registry factory, test-first.

DELIVERABLES
1. `git switch -c feat/phase-06-metrics` (NEVER git checkout -b).
2. src/metrics/metrics.registry.ts: createMetricsRegistry(options): Promise<Registry-typed
   value> that dynamically imports prom-client inside the function (await import('prom-client')
   wrapped so a module-not-found rejection becomes a descriptive Error: "metrics.enabled is true
   but the optional peer prom-client is not installed. Run: pnpm add prom-client"); creates a
   dedicated Registry; applies options.metrics.defaultLabels via setDefaultLabels; runs
   collectDefaultMetrics({ register }) when options.metrics.collectDefaultMetrics is true. Type
   prom-client values through import('prom-client') type-only imports (type-only imports do not
   load the module at runtime; document this in a comment).
3. src/metrics/metrics.registry.spec.ts, written first: registry created with labels applied;
   collectDefaultMetrics on/off; missing-peer path (jest.isolateModules with a mocked failing
   dynamic import) throws the exact descriptive message.

Constraints:
- No top-level runtime import of prom-client anywhere in src/ (type-only imports allowed).
- Explicit @Inject(Symbol) where DI applies; TypeScript strict, zero any; functions <= 50 lines.
- Timeless, English-only comments; no em dashes; every it() carries a scenario comment.
- Never add Co-Authored-By, "Generated with", or any AI-attribution line to commits, PR titles,
  PR bodies, or comments.

Verification:
- `pnpm test:cov`: green, 100%.
- `grep -rn "^import .*prom-client" src/ | grep -v "import type"`: no matches.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in the per-task block and the Task index row.
2. Tick the satisfied acceptance-criteria checkboxes.
3. Bump the phase Progress counter (X / 5).
4. Append a Completion log entry: `- 6.1 ✅ <YYYY-MM-DD>: <one-line summary>`.
5. Update the P6 row in ../development_plan.md (canonical) and mirror docs/tasks/README.md.
6. Recompute the overall counter line in ../development_plan.md.
7. Commit: `feat(metrics): add lazy prom-client registry with fail-fast peer check (6.1)`.
````

---

### Task 6.2: Metrics controller

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: M
- **Depends on**: 6.1

#### Description

The controller serving the Prometheus text format on the configurable path from the injected registry.

#### Acceptance criteria

- [x] `GET <metrics.path>` (default `metrics`) returns `registry.metrics()` with the Prometheus text content type (`registry.contentType`).
- [x] The controller injects the registry via `BYMAX_METRICS_REGISTRY` with explicit `@Inject`.
- [x] 100% coverage holds.

#### Files to create / modify

- `src/metrics/metrics.controller.ts`, `src/metrics/metrics.controller.spec.ts`

#### Agent prompt

````
You are a senior NestJS library engineer working on @bymax-one/nest-core.

PROJECT: @bymax-one/nest-core, application foundation kit for NestJS 11. The metrics endpoint
exposes the in-process registry in Prometheus text format; scraping and aggregation are the
scraper's job.

CURRENT PHASE: 6 (metrics), Task 6.2 of 5

PRECONDITIONS
- Task 6.1 done: lazy registry factory exists on the phase branch.

REQUIRED READING (only these)
- docs/technical_specification.md §9.1 and §4.1 (metrics options block).

TASK
Implement the metrics controller, test-first.

DELIVERABLES
1. src/metrics/metrics.controller.ts: MetricsController with one GET handler; constructor
   @Inject(BYMAX_METRICS_REGISTRY) registry (typed via a type-only prom-client import); handler
   returns await registry.metrics() and sets the content-type header from registry.contentType;
   path applied at registration time consistent with the health controller's mechanism (default
   'metrics').
2. src/metrics/metrics.controller.spec.ts, written first: returns the registry text; sets the
   content type; delegates only (no metric mutation in the controller).

Constraints:
- Thin controller; explicit @Inject(Symbol); TypeScript strict, zero any; @fileoverview +
  @layer Controller header.
- No top-level runtime prom-client import.
- Timeless, English-only comments; no em dashes; every it() carries a scenario comment.
- Never add Co-Authored-By, "Generated with", or any AI-attribution line to commits, PR titles,
  PR bodies, or comments.

Verification:
- `pnpm test:cov`: green, 100%. `pnpm lint && pnpm typecheck`: green.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in the per-task block and the Task index row.
2. Tick the satisfied acceptance-criteria checkboxes.
3. Bump the phase Progress counter (X / 5).
4. Append a Completion log entry: `- 6.2 ✅ <YYYY-MM-DD>: <one-line summary>`.
5. Update the P6 row in ../development_plan.md (canonical) and mirror docs/tasks/README.md.
6. Recompute the overall counter line in ../development_plan.md.
7. Commit: `feat(metrics): add Prometheus text endpoint controller (6.2)`.
````

---

### Task 6.3: Timing-sink bridge

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: M
- **Depends on**: 6.1

#### Description

The internal `ITimingSink` implementation feeding `http_requests_total` (counter) and `http_request_duration_seconds` (histogram) with bounded labels.

#### Acceptance criteria

- [x] One counter increment and one histogram observation (`durationMs / 1000`) per sample, labels exactly `method`, `route`, `status_code`.
- [x] Metrics registered once against the injected registry (idempotent construction).
- [x] The bridge never throws outward (it is a sink; the interceptor also guards, this is defense in depth).
- [x] 100% coverage holds.

#### Files to create / modify

- `src/metrics/timing-metrics.sink.ts`, `src/metrics/timing-metrics.sink.spec.ts`

#### Agent prompt

````
You are a senior NestJS library engineer working on @bymax-one/nest-core.

PROJECT: @bymax-one/nest-core, application foundation kit for NestJS 11. When timing and metrics
are both enabled, an internal ITimingSink bridge feeds the two default HTTP metrics with bounded
label sets (route label = route template from the sample, never the raw URL).

CURRENT PHASE: 6 (metrics), Task 6.3 of 5

PRECONDITIONS
- Task 6.1 done. Phase 3 merged (RequestTimingSample, ITimingSink).

REQUIRED READING (only these)
- docs/technical_specification.md §9.3 (metric names, types, labels, source).
- prom-client Counter/Histogram API via context7 before coding (labelNames, inc, observe,
  registers option).

TASK
Implement the timing-to-metrics bridge, test-first.

DELIVERABLES
1. src/metrics/timing-metrics.sink.ts: TimingMetricsSink implements ITimingSink; constructed
   with the registry and the lazily imported prom-client module (passed in by the factory seam,
   keeping the no-top-level-import rule); creates http_requests_total (Counter, labelNames
   ['method','route','status_code']) and http_request_duration_seconds (Histogram, same labels,
   prom-client default buckets) registered against the injected registry only; record(sample)
   increments and observes sample.durationMs / 1000 inside a try/catch that swallows failures.
2. src/metrics/timing-metrics.sink.spec.ts, written first: one increment + one observation per
   sample with exact label values; status_code label is the string of the numeric status;
   swallow-on-failure (a stubbed counter that throws does not propagate); construction is
   idempotent against the same registry (no duplicate-registration error on re-instantiation,
   or a documented guard).

Constraints:
- No top-level runtime prom-client import; explicit DI; TypeScript strict, zero any.
- Timeless, English-only comments; no em dashes; every it() carries a scenario comment.
- Never add Co-Authored-By, "Generated with", or any AI-attribution line to commits, PR titles,
  PR bodies, or comments.

Verification:
- `pnpm test:cov`: green, 100%. `pnpm lint && pnpm typecheck`: green.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in the per-task block and the Task index row.
2. Tick the satisfied acceptance-criteria checkboxes.
3. Bump the phase Progress counter (X / 5).
4. Append a Completion log entry: `- 6.3 ✅ <YYYY-MM-DD>: <one-line summary>`.
5. Update the P6 row in ../development_plan.md (canonical) and mirror docs/tasks/README.md.
6. Recompute the overall counter line in ../development_plan.md.
7. Commit: `feat(metrics): add timing-sink bridge for default HTTP metrics (6.3)`.
````

---

### Task 6.4: Registration wiring, never-loaded proof, scrape test

- **Status**: 📋 ToDo
- **Priority**: P0
- **Size**: S
- **Depends on**: 6.2, 6.3

#### Description

Conditional registration of the metrics feature, the bridge auto-wiring when timing and metrics are both enabled, and the proof that disabled metrics never touch `prom-client`.

#### Acceptance criteria

- [ ] Metrics disabled: no controller, no registry provider resolution, `prom-client` never imported (verified with a module-load spy or `require.cache` inspection).
- [ ] Metrics + timing enabled: the bridge is bound as the effective timing sink (composing with, not replacing, a consumer-provided sink per the documented behavior you define; document the chosen composition in JSDoc).
- [ ] A scrape after simulated samples shows both HTTP metrics in the endpoint output.
- [ ] 100% coverage holds; dogfood green.

#### Files to create / modify

- `src/core.module.ts`, `src/metrics/metrics.registration.spec.ts`

#### Agent prompt

````
You are a senior NestJS library engineer working on @bymax-one/nest-core.

PROJECT: @bymax-one/nest-core, application foundation kit for NestJS 11. Zero cost when metrics
are disabled is the governing invariant of this feature.

CURRENT PHASE: 6 (metrics), Task 6.4 of 5

PRECONDITIONS
- Tasks 6.2 and 6.3 done: controller and bridge implemented and tested.

REQUIRED READING (only these)
- docs/technical_specification.md §2.2 (registration), §9.2, §9.3.

TASK
Wire conditional registration and prove the invariants, test-first.

DELIVERABLES
1. src/core.module.ts: metrics feature registered only when resolved metrics.enabled (async
   factory for BYMAX_METRICS_REGISTRY awaiting createMetricsRegistry; controller registration
   consistent with the health mechanism); when timing and metrics are both enabled, bind the
   TimingMetricsSink so HTTP samples flow to the registry (compose with any consumer-provided
   BYMAX_TIMING_SINK: call both, document the order); remove temporary metrics seam stubs.
2. src/metrics/metrics.registration.spec.ts, written first: disabled metrics registers no
   controller and never loads prom-client (assert via jest module mock call count or
   require.cache absence after boot); enabled path resolves the registry and serves a scrape
   containing http_requests_total and http_request_duration_seconds after feeding samples
   through the sink.

Constraints:
- Explicit @Inject(Symbol); TypeScript strict, zero any; timeless English comments; no em
  dashes; every it() carries a scenario comment.
- Never add Co-Authored-By, "Generated with", or any AI-attribution line to commits, PR titles,
  PR bodies, or comments.

Verification:
- `pnpm test:cov`: green, 100%.
- `pnpm build && node scripts/dogfood-smoke-test.mjs`: green (dogfood must pass WITHOUT
  prom-client available to the packed consumer when metrics stay disabled; verify the tarball
  has no hard prom-client requirement).

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in the per-task block and the Task index row.
2. Tick the satisfied acceptance-criteria checkboxes.
3. Bump the phase Progress counter (X / 5).
4. Append a Completion log entry: `- 6.4 ✅ <YYYY-MM-DD>: <one-line summary>`.
5. Update the P6 row in ../development_plan.md (canonical) and mirror docs/tasks/README.md.
6. Recompute the overall counter line in ../development_plan.md.
7. Commit: `feat(metrics): wire conditional registration and zero-cost proof (6.4)`.
````

---

### Task 6.5: Phase close: verification, PR, Copilot review, merge

- **Status**: 📋 ToDo
- **Priority**: P0
- **Size**: S
- **Depends on**: 6.1, 6.2, 6.3, 6.4

#### Description

Audit the phase Definition of Done, update dashboards, open the phase PR, obtain and address the GitHub Copilot review, merge on green.

#### Acceptance criteria

- [ ] Every P6 Definition of Done checkbox in `../development_plan.md` verified and ticked.
- [ ] Phase file, plan dashboard, and README index consistent.
- [ ] PR from `feat/phase-06-metrics` with CI green and Copilot review resolved; merged, branch deleted.

#### Files to create / modify

- This file (statuses), `../development_plan.md`, `README.md` (folder index)

#### Agent prompt

````
You are a senior release engineer closing a development phase of @bymax-one/nest-core.

PROJECT: @bymax-one/nest-core. One PR per phase; GitHub Copilot code review is a mandatory gate.

CURRENT PHASE: 6 (metrics), Task 6.5 of 5 (LAST)

PRECONDITIONS
- Tasks 6.1 through 6.4 done and committed on feat/phase-06-metrics; local gates green.

REQUIRED READING (only these)
- ../development_plan.md: P6 block (Definition of Done) and Progress Dashboard.
- docs/tasks/phase-06-metrics.md: task index and completion log.

TASK
Close phase 6 through its pull request with a GitHub Copilot review.

DELIVERABLES
1. Verify each P6 DoD item (never-imported proof, fail-fast message, scrape output with bounded
   labels, defaultLabels, collectDefaultMetrics toggle); tick the checkboxes in
   ../development_plan.md.
2. Update dashboards: this phase file, the P6 row and overall counter in ../development_plan.md,
   the folder index in docs/tasks/README.md.
3. `gh pr create --title "feat(core): phase 6, optional Prometheus metrics" --body <professional
   summary>`.
4. Request a GitHub Copilot code review (Reviewers panel, or `gh pr edit <number> --add-reviewer
   copilot-pull-request-reviewer[bot]` when available); address every finding; re-request after
   fixes.
5. Merge on green: `gh pr merge --squash --delete-branch`; confirm main green after merge.

Constraints:
- Never merge with red or pending CI; never dismiss a Copilot finding silently.
- Never add Co-Authored-By, "Generated with", or any AI-attribution line to commits, PR titles,
  PR bodies, or comments.

Verification:
- `gh pr checks <number>`: all green. `gh pr view <number> --json reviews`: Copilot review
  present and resolved. Post-merge main: `pnpm build && pnpm test:cov` green.

Completion Protocol (after you finish):
1. Set this task's Status to ✅; phase header Status ✅, Progress 5 / 5.
2. Tick the satisfied acceptance-criteria checkboxes.
3. Append: `- 6.5 ✅ <YYYY-MM-DD>: phase PR merged with Copilot review`.
4. Update the P6 row (✅, 100%) and overall counter in ../development_plan.md; mirror README.md.
5. Commit dashboard updates post-merge as `docs(core): close phase 6 dashboards (6.5)`.
````

---

## Completion log

<!-- Append one line per completed task: - <id> ✅ <YYYY-MM-DD>: <summary> -->

- 6.1 ✅ 2026-07-16: lazy `prom-client` registry factory with fail-fast peer check, `defaultLabels`, and `collectDefaultMetrics` toggle; 100% covered.
- 6.2 ✅ 2026-07-16: thin metrics controller factory serving the registry text and content type on the configurable route, with the async consistency guard; 100% covered.
- 6.3 ✅ 2026-07-16: `TimingMetricsSink` bridge feeding `http_requests_total` and `http_request_duration_seconds` with bounded `method`/`route`/`status_code` labels, idempotent construction, and swallow-on-failure; 100% covered.
