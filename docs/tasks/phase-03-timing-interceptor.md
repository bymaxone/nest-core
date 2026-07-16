# Phase 3: timing-interceptor

> **Status**: ✅ Done · **Progress**: 4 / 4 tasks · **Last updated**: 2026-07-16
> **Source roadmap**: [`../development_plan.md`](../development_plan.md) (P3)
> **Source spec**: [`../technical_specification.md`](../technical_specification.md) §6

---

## Context

This phase delivers the request timing interceptor: one `RequestTimingSample` per completed request (success or error), measured with a monotonic clock, flagged as slow against `slowRequestThresholdMs`, and handed to the pluggable `ITimingSink`. The sink is fire-and-forget: a throwing sink is silenced and can never affect a response. The contracts (`ITimingSink`, `RequestTimingSample`) already exist from phase 1; this phase implements the interceptor and its registration.

Expected starting state: phase 1 merged. Code-parallel with phases 2, 4, and 5; touches only `src/timing/` plus the registration seam. Phase 6 (metrics) consumes this phase's sink seam.

---

## Rules-of-phase

1. **One PR** on `feat/phase-03-timing-interceptor`, closed with CI green and a GitHub Copilot review addressed.
2. **Monotonic clock only** (`performance.now()`); wall-clock date functions are banned for duration math.
3. **Route template, not raw URL**: samples carry the route pattern to keep downstream label cardinality bounded. This is a contract, not an optimization.
4. **Timing can never break a request**: sink exceptions are swallowed; the interceptor adds no observable behavior beyond the measurement.
5. TDD, 100% coverage at every commit; timeless English comments; no em dashes; no `.gitkeep`.

---

## Reference docs

- [`../development_plan.md`](../development_plan.md): P3 block.
- [`../technical_specification.md`](../technical_specification.md): §6.1 (sample and sink contracts, design decisions), §2.3 (pipeline placement).

---

## Task index

| ID  | Task                                                         | Status  | Priority | Size | Depends on    |
| --- | ------------------------------------------------------------ | ------- | -------- | ---- | ------------- |
| 3.1 | Branch, monotonic clock seam, route-template accessor        | ✅ Done | P0       | S    | none          |
| 3.2 | Interceptor: success and error paths, slow flag, sink safety | ✅ Done | P0       | M    | 3.1           |
| 3.3 | Registration wiring and disabled-path tests                  | ✅ Done | P0       | S    | 3.2           |
| 3.4 | Phase close: verification, PR, Copilot review, merge         | ✅ Done | P0       | S    | 3.1, 3.2, 3.3 |

---

## Tasks

### Task 3.1: Branch, monotonic clock seam, route-template accessor

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: S
- **Depends on**: none

#### Description

The injectable monotonic clock seam and the neutral accessor that extracts method, route template, and final status from the HTTP execution context.

#### Acceptance criteria

- [x] Branch `feat/phase-03-timing-interceptor` created with `git switch -c`.
- [x] A `MonotonicClock` seam (default `performance.now`) is injectable for tests; no `Date.now()` in duration math anywhere in `src/timing/`.
- [x] The accessor returns the route template (Express `req.route?.path` composition, Fastify `routeOptions.url`), falling back to the URL path only when no template exists, with the fallback documented.
- [x] 100% coverage holds.

#### Files to create / modify

- `src/timing/timing.clock.ts`, `src/timing/request-info.accessor.ts`, `src/timing/request-info.accessor.spec.ts`

#### Agent prompt

```
You are a senior NestJS library engineer working on @bymax-one/nest-core.

PROJECT: @bymax-one/nest-core, application foundation kit for NestJS 11. This phase implements
request timing: monotonic measurement, route-template samples, pluggable fire-and-forget sink.

CURRENT PHASE: 3 (timing-interceptor), Task 3.1 of 4 (FIRST)

PRECONDITIONS
- Phase 1 merged: ITimingSink and RequestTimingSample contracts exist in src/timing/, the no-op
  sink is bound to BYMAX_TIMING_SINK.

REQUIRED READING (only these)
- docs/technical_specification.md §6.1 (contracts and design decisions).

TASK
Create the phase branch, the clock seam, and the neutral request-info accessor, test-first.

DELIVERABLES
1. `git switch -c feat/phase-03-timing-interceptor` (NEVER git checkout -b).
2. src/timing/timing.clock.ts: a minimal MonotonicClock type ({ now(): number }) and the default
   implementation delegating to performance.now(); exported for injection in tests.
3. src/timing/request-info.accessor.ts: extractRequestInfo(context: ExecutionContext) returning
   { method, route } reading the route template neutrally: Express (req.route?.path combined
   with baseUrl when present) and Fastify (req.routeOptions?.url), falling back to the URL path
   without query string when no template exists; document in JSDoc why the template is the
   contract (bounded cardinality for metric labels).
4. src/timing/request-info.accessor.spec.ts, written first: Express-shaped request with route,
   Fastify-shaped request, and the no-template fallback.

Constraints:
- TypeScript strict, zero any; functions <= 50 lines; @fileoverview + @layer Utility header.
- Timeless, English-only comments; no em dashes; every it() carries a scenario comment.
- Never add Co-Authored-By, "Generated with", or any AI-attribution line to commits, PR titles,
  PR bodies, or comments.

Verification:
- `pnpm test:cov`: green, 100%. `pnpm lint && pnpm typecheck`: green.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in the per-task block and the Task index row.
2. Tick the satisfied acceptance-criteria checkboxes.
3. Bump the phase Progress counter (X / 4).
4. Append a Completion log entry: `- 3.1 ✅ <YYYY-MM-DD>: <one-line summary>`.
5. Update the P3 row in ../development_plan.md (canonical) and mirror docs/tasks/README.md.
6. Recompute the overall counter line in ../development_plan.md.
7. Commit: `feat(timing): add monotonic clock seam and route accessor (3.1)`.
```

---

### Task 3.2: Interceptor: success and error paths, slow flag, sink safety

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: M
- **Depends on**: 3.1

#### Description

The `TimingInterceptor`: measures the full handler execution on success and on error, computes the slow flag, and delivers exactly one sample per request through a sink that cannot break the response.

#### Acceptance criteria

- [x] Exactly one sample per request on the success path and on the error path (error samples carry the final error status).
- [x] `slow` is true exactly when duration exceeds `slowRequestThresholdMs`; with no threshold configured it is always false.
- [x] A sink that throws is caught and silenced; the response (or the propagated error) is unaffected, asserted by test.
- [x] `durationMs` comes from the monotonic clock seam; 100% coverage holds.

#### Files to create / modify

- `src/timing/timing.interceptor.ts`, `src/timing/timing.interceptor.spec.ts`

#### Agent prompt

```
You are a senior NestJS library engineer working on @bymax-one/nest-core.

PROJECT: @bymax-one/nest-core, application foundation kit for NestJS 11. The timing interceptor
wraps the full handler chain; the sink is fire-and-forget and can never affect a request.

CURRENT PHASE: 3 (timing-interceptor), Task 3.2 of 4

PRECONDITIONS
- Task 3.1 done: clock seam and request-info accessor exist on the phase branch.

REQUIRED READING (only these)
- docs/technical_specification.md §6.1 (sample fields, sink rules) and §2.3 (placement).

TASK
Implement the interceptor, test-first, using rxjs tap/catchError composition.

DELIVERABLES
1. src/timing/timing.interceptor.ts: @Injectable() TimingInterceptor implements NestInterceptor;
   constructor: @Inject(BYMAX_CORE_OPTIONS) options, @Inject(BYMAX_TIMING_SINK) sink, plus the
   clock seam (provide a default parameter or an internal token bound to the default clock,
   whichever keeps the injection explicit); intercept(): record start via clock.now(); on
   completion or error, build RequestTimingSample { method, route, statusCode, durationMs, slow }
   (error status from HttpException.getStatus() or 500) and call sink.record inside a try/catch
   that swallows sink failures; non-HTTP contexts pass through without sampling.
2. src/timing/timing.interceptor.spec.ts, written first, with mocked ExecutionContext and
   CallHandler (family convention, no supertest here): success sample; error sample with correct
   status; slow true/false boundary at the threshold (use a stub clock advancing controlled
   amounts); no threshold means slow false; throwing sink silenced on both paths; exactly one
   record call per request.

Constraints:
- Explicit @Inject(Symbol); TypeScript strict, zero any; functions <= 50 lines; @fileoverview +
  @layer Interceptor header.
- Monotonic clock only; no Date.now() in duration math.
- Timeless, English-only comments; no em dashes; every it() carries a scenario comment.
- Never add Co-Authored-By, "Generated with", or any AI-attribution line to commits, PR titles,
  PR bodies, or comments.

Verification:
- `pnpm test:cov`: green, 100%. `pnpm lint && pnpm typecheck`: green.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in the per-task block and the Task index row.
2. Tick the satisfied acceptance-criteria checkboxes.
3. Bump the phase Progress counter (X / 4).
4. Append a Completion log entry: `- 3.2 ✅ <YYYY-MM-DD>: <one-line summary>`.
5. Update the P3 row in ../development_plan.md (canonical) and mirror docs/tasks/README.md.
6. Recompute the overall counter line in ../development_plan.md.
7. Commit: `feat(timing): add timing interceptor with sink safety (3.2)`.
```

---

### Task 3.3: Registration wiring and disabled-path tests

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: S
- **Depends on**: 3.2

#### Description

Wire the real interceptor into both registration paths, replacing the phase 1 seam, and prove the disabled configurations.

#### Acceptance criteria

- [x] Sync path registers `APP_INTERCEPTOR` only when `timing.enabled`; async path swaps pass-through for `TimingInterceptor` per resolved options.
- [x] Disabled timing on the sync path registers nothing; on the async path the pass-through leaves requests observably unchanged (both asserted).
- [x] Interceptor and contracts exported from the `.` barrel; dogfood green; 100% coverage holds.

#### Files to create / modify

- `src/core.module.ts`, `src/index.ts`, `src/timing/timing.registration.spec.ts`

#### Agent prompt

```
You are a senior NestJS library engineer working on @bymax-one/nest-core.

PROJECT: @bymax-one/nest-core, application foundation kit for NestJS 11. Conditional
registration: sync path omits at definition time; async path gates inside the factory.

CURRENT PHASE: 3 (timing-interceptor), Task 3.3 of 4

PRECONDITIONS
- Task 3.2 done: TimingInterceptor implemented and tested.

REQUIRED READING (only these)
- docs/technical_specification.md §2.2 (registration rules).

TASK
Wire registration for the timing feature and prove the disabled paths, test-first.

DELIVERABLES
1. src/core.module.ts: sync path appends the APP_INTERCEPTOR provider only when resolved
   timing.enabled; async path factory returns TimingInterceptor when enabled, the pass-through
   otherwise. Remove any temporary timing seam stubs left from phase 1.
2. src/index.ts: export TimingInterceptor, ITimingSink, RequestTimingSample.
3. src/timing/timing.registration.spec.ts, written first: sync disabled registers no
   APP_INTERCEPTOR for timing; sync enabled registers it; async disabled resolves the
   pass-through (assert the factory product type); async enabled resolves TimingInterceptor.

Constraints:
- Explicit @Inject(Symbol); TypeScript strict, zero any; timeless English comments; no em
  dashes; every it() carries a scenario comment.
- Never add Co-Authored-By, "Generated with", or any AI-attribution line to commits, PR titles,
  PR bodies, or comments.

Verification:
- `pnpm test:cov`: green, 100%.
- `pnpm build && node scripts/dogfood-smoke-test.mjs`: green.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in the per-task block and the Task index row.
2. Tick the satisfied acceptance-criteria checkboxes.
3. Bump the phase Progress counter (X / 4).
4. Append a Completion log entry: `- 3.3 ✅ <YYYY-MM-DD>: <one-line summary>`.
5. Update the P3 row in ../development_plan.md (canonical) and mirror docs/tasks/README.md.
6. Recompute the overall counter line in ../development_plan.md.
7. Commit: `feat(timing): wire conditional registration for timing (3.3)`.
```

---

### Task 3.4: Phase close: verification, PR, Copilot review, merge

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: S
- **Depends on**: 3.1, 3.2, 3.3

#### Description

Audit the phase Definition of Done, update dashboards, open the phase PR, obtain and address the GitHub Copilot review, merge on green.

#### Acceptance criteria

- [x] Every P3 Definition of Done checkbox in `../development_plan.md` verified and ticked.
- [x] Phase file, plan dashboard, and README index consistent.
- [x] PR opened from `feat/phase-03-timing-interceptor` with the Copilot review requested. CI verification, review resolution, merge, and branch cleanup are owned by the orchestrator on green.

#### Files to create / modify

- This file (statuses), `../development_plan.md`, `README.md` (folder index)

#### Agent prompt

```
You are a senior release engineer closing a development phase of @bymax-one/nest-core.

PROJECT: @bymax-one/nest-core. One PR per phase; GitHub Copilot code review is a mandatory gate.

CURRENT PHASE: 3 (timing-interceptor), Task 3.4 of 4 (LAST)

PRECONDITIONS
- Tasks 3.1 through 3.3 done and committed on feat/phase-03-timing-interceptor; local gates green.

REQUIRED READING (only these)
- ../development_plan.md: P3 block (Definition of Done) and Progress Dashboard.
- docs/tasks/phase-03-timing-interceptor.md: task index and completion log.

TASK
Close phase 3 through its pull request with a GitHub Copilot review.

DELIVERABLES
1. Verify each P3 DoD item (route template on both outcomes, slow boundary, throwing-sink
   silence, disabled paths); tick the checkboxes in ../development_plan.md.
2. Update dashboards: this phase file, the P3 row and overall counter in ../development_plan.md,
   the folder index in docs/tasks/README.md.
3. `gh pr create --title "feat(core): phase 3, request timing interceptor" --body <professional
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
1. Set this task's Status to ✅; phase header Status ✅, Progress 4 / 4.
2. Tick the satisfied acceptance-criteria checkboxes.
3. Append: `- 3.4 ✅ <YYYY-MM-DD>: phase PR merged with Copilot review`.
4. Update the P3 row (✅, 100%) and overall counter in ../development_plan.md; mirror README.md.
5. Commit dashboard updates post-merge as `docs(core): close phase 3 dashboards (3.4)`.
```

---

## Completion log

<!-- Append one line per completed task: - <id> ✅ <YYYY-MM-DD>: <summary> -->

- 3.1 ✅ 2026-07-16: monotonic clock seam and neutral Express/Fastify route-template accessor, 100% coverage.
- 3.2 ✅ 2026-07-16: TimingInterceptor with success/error sampling, slow-flag threshold logic, and sink-exception swallowing, 100% coverage.
- 3.3 ✅ 2026-07-16: conditional APP_INTERCEPTOR registration on both paths, barrel export, dogfood green, 100% coverage.
- 3.4 ✅ 2026-07-16: phase PR opened with Copilot review requested; DoD audited, dashboards reconciled, all gates green.
