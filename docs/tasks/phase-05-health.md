# Phase 5: health

> **Status**: 🔄 In Progress · **Progress**: 4 / 5 tasks · **Last updated**: 2026-07-16
> **Source roadmap**: [`../development_plan.md`](../development_plan.md) (P5)
> **Source spec**: [`../technical_specification.md`](../technical_specification.md) §8, §14.5

---

## Context

This phase delivers the `./health` subpath and the health feature: the `IHealthIndicator` contract, the aggregation service (concurrent execution, per-indicator timeout, rejection and timeout conversion to `down` entries), and the controller serving `GET /health/live` (always 200, no indicators) and `GET /health/ready` (200 when all up, 503 otherwise) under a configurable prefix. The response shape is a versioned public contract. The implementation is deliberately thin and dependency-free: no `@nestjs/terminus` (spec §8.3).

Expected starting state: phase 1 merged. Code-parallel with phases 2, 3, and 4; touches `src/health/` plus the registration seam.

---

## Rules-of-phase

1. **One PR** on `feat/phase-05-health`, closed with CI green and a GitHub Copilot review addressed.
2. **No `@nestjs/terminus`**: a documented spec decision; the aggregator is a small, fully tested local implementation.
3. **One failing indicator never hides the others**: aggregation reports every check's result, always.
4. **The response JSON is a versioned contract**: tests assert the exact serialized shape.
5. TDD, 100% coverage at every commit; timeless English comments; no em dashes; no `.gitkeep`.

---

## Reference docs

- [`../development_plan.md`](../development_plan.md): P5 block.
- [`../technical_specification.md`](../technical_specification.md): §8.1 (endpoints and contract), §8.2 (indicator contract and aggregation), §8.3 (terminus decision), §14.5 (no dependency ordering).

---

## Task index

| ID | Task | Status | Priority | Size | Depends on |
|---|---|---|---|---|---|
| 5.1 | Branch, health contracts, subpath barrel | ✅ Done | P0 | S | none |
| 5.2 | Aggregation service (concurrency, timeout, down conversion) | ✅ Done | P0 | M | 5.1 |
| 5.3 | Health controller (live, ready, prefix, 200/503) | ✅ Done | P0 | M | 5.2 |
| 5.4 | Registration wiring, contract suite, dogfood | ✅ Done | P0 | S | 5.3 |
| 5.5 | Phase close: verification, PR, Copilot review, merge | 📋 ToDo | P0 | S | 5.1, 5.2, 5.3, 5.4 |

---

## Tasks

### Task 5.1: Branch, health contracts, subpath barrel

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: S
- **Depends on**: none

#### Description

The `IHealthIndicator` and `HealthIndicatorResult` contracts, the health response types, and the `./health` barrel.

#### Acceptance criteria

- [x] Branch `feat/phase-05-health` created with `git switch -c`.
- [x] Contracts match spec §8.2 exactly (`name`, `check(): Promise<HealthIndicatorResult>`, `status: 'up' | 'down'`, optional `details`).
- [x] Health response types (`status: 'ok' | 'error'`, `checks` array with per-check name, status, optional details) match §8.1.
- [x] `src/health/index.ts` exports contracts and response types only; 100% coverage holds (types via consuming tests in later tasks; any runtime constant here is tested now).

#### Files to create / modify

- `src/health/health.interfaces.ts`, `src/health/index.ts`

#### Agent prompt

````
You are a senior NestJS library engineer working on @bymax-one/nest-core.

PROJECT: @bymax-one/nest-core, application foundation kit for NestJS 11. The ./health subpath
carries the pluggable indicator contract; the app registers indicators for its own dependencies
(Redis, database, external services) against the clients it already owns.

CURRENT PHASE: 5 (health), Task 5.1 of 5 (FIRST)

PRECONDITIONS
- Phase 1 merged: BYMAX_HEALTH_INDICATORS token defaults to an empty array.

REQUIRED READING (only these)
- docs/technical_specification.md §8.1 (response contract) and §8.2 (indicator contract).

TASK
Create the phase branch, the contracts, and the subpath barrel.

DELIVERABLES
1. `git switch -c feat/phase-05-health` (NEVER git checkout -b).
2. src/health/health.interfaces.ts: HealthIndicatorResult { status: 'up' | 'down'; details?:
   Record<string, unknown> }; IHealthIndicator { readonly name: string; check():
   Promise<HealthIndicatorResult> }; HealthCheckEntry { name, status, details? };
   HealthResponse { status: 'ok' | 'error'; checks: HealthCheckEntry[] }. Imperative JSDoc on
   every export; document that rejections and timeouts are reported as down by the aggregator.
3. src/health/index.ts: selective barrel exporting exactly those types.

Constraints:
- TypeScript strict, zero any; @fileoverview + @layer Interface header.
- Timeless, English-only comments; no em dashes; no .gitkeep.
- Never add Co-Authored-By, "Generated with", or any AI-attribution line to commits, PR titles,
  PR bodies, or comments.

Verification:
- `pnpm typecheck && pnpm lint && pnpm build`: green (interfaces compile into the subpath d.ts).

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in the per-task block and the Task index row.
2. Tick the satisfied acceptance-criteria checkboxes.
3. Bump the phase Progress counter (X / 5).
4. Append a Completion log entry: `- 5.1 ✅ <YYYY-MM-DD>: <one-line summary>`.
5. Update the P5 row in ../development_plan.md (canonical) and mirror docs/tasks/README.md.
6. Recompute the overall counter line in ../development_plan.md.
7. Commit: `feat(health): add indicator contracts and subpath barrel (5.1)`.
````

---

### Task 5.2: Aggregation service

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: M
- **Depends on**: 5.1

#### Description

The readiness aggregator: runs all indicators concurrently, applies the per-indicator timeout, converts rejections and timeouts into `down` entries with diagnostic detail.

#### Acceptance criteria

- [x] All indicators run concurrently (verified by a test with two delayed indicators completing in near-parallel time).
- [x] An indicator exceeding `indicatorTimeoutMs` reports `down` with a timeout detail; a rejecting indicator reports `down` with the rejection reason summarized; other checks still report their real results.
- [x] Aggregate `status` is `ok` only when every check is `up`.
- [x] No timer leaks (timeouts cleared when the check settles first); 100% coverage holds.

#### Files to create / modify

- `src/health/health.service.ts`, `src/health/health.service.spec.ts`

#### Agent prompt

````
You are a senior NestJS library engineer working on @bymax-one/nest-core.

PROJECT: @bymax-one/nest-core, application foundation kit for NestJS 11. The readiness aggregator
is a small dependency-free implementation (no @nestjs/terminus, a documented spec decision). One
failing indicator never hides the results of the others.

CURRENT PHASE: 5 (health), Task 5.2 of 5

PRECONDITIONS
- Task 5.1 done: contracts exist on the phase branch.

REQUIRED READING (only these)
- docs/technical_specification.md §8.2 (aggregation semantics) and §14.5 (flat, concurrent,
  no dependency ordering).

TASK
Implement the aggregation service, test-first.

DELIVERABLES
1. src/health/health.service.ts: @Injectable() HealthService; constructor:
   @Inject(BYMAX_HEALTH_INDICATORS) indicators: IHealthIndicator[],
   @Inject(BYMAX_CORE_OPTIONS) options; checkReadiness(): Promise<HealthResponse> running every
   indicator via Promise.all over per-indicator wrappers; each wrapper races check() against a
   timeout of options.health.indicatorTimeoutMs (clearTimeout when the check settles first, no
   leaked timers), catching rejections into { status: 'down', details: { error: <message
   summary> } } and timeouts into { status: 'down', details: { timedOutAfterMs } }; aggregate
   status 'ok' only when all are 'up'. checkLiveness(): HealthResponse { status: 'ok', checks:
   [] } without touching indicators.
2. src/health/health.service.spec.ts, written first: all-up aggregation; one down among ups
   (others still reported); rejection conversion; timeout conversion with fake timers or a short
   real timeout; concurrency proof (two 50ms indicators complete in well under 100ms total);
   empty indicator array yields ok with empty checks.

Constraints:
- Explicit @Inject(Symbol); TypeScript strict, zero any; functions <= 50 lines; @fileoverview +
  @layer Service header.
- Timeless, English-only comments; no em dashes; every it() carries a scenario comment.
- Never add Co-Authored-By, "Generated with", or any AI-attribution line to commits, PR titles,
  PR bodies, or comments.

Verification:
- `pnpm test:cov`: green, 100%. `pnpm lint && pnpm typecheck`: green.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in the per-task block and the Task index row.
2. Tick the satisfied acceptance-criteria checkboxes.
3. Bump the phase Progress counter (X / 5).
4. Append a Completion log entry: `- 5.2 ✅ <YYYY-MM-DD>: <one-line summary>`.
5. Update the P5 row in ../development_plan.md (canonical) and mirror docs/tasks/README.md.
6. Recompute the overall counter line in ../development_plan.md.
7. Commit: `feat(health): add concurrent aggregation service with timeouts (5.2)`.
````

---

### Task 5.3: Health controller

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: M
- **Depends on**: 5.2

#### Description

The controller serving liveness and readiness under the configurable prefix, with the 200/503 status rule.

#### Acceptance criteria

- [x] `GET <prefix>/live` always 200 with `{ status: 'ok', checks: [] }`; `GET <prefix>/ready` 200 when all up, 503 with the full checks array otherwise.
- [x] The prefix comes from `options.health.path` (default `health`); the failing check is named in the 503 body.
- [x] 100% coverage holds.

#### Files to create / modify

- `src/health/health.controller.ts`, `src/health/health.controller.spec.ts`

#### Agent prompt

````
You are a senior NestJS library engineer working on @bymax-one/nest-core.

PROJECT: @bymax-one/nest-core, application foundation kit for NestJS 11. Health endpoints follow
a stable, versioned response contract; readiness signals through the HTTP status (200/503).

CURRENT PHASE: 5 (health), Task 5.3 of 5

PRECONDITIONS
- Task 5.2 done: HealthService implemented and tested.

REQUIRED READING (only these)
- docs/technical_specification.md §8.1 (endpoints, contract, status rule) and §4.1 (health
  options block).

TASK
Implement the controller, test-first.

DELIVERABLES
1. src/health/health.controller.ts: HealthController with two GET handlers (live, ready);
   constructor @Inject(HealthService via class injection with explicit @Inject(HealthService) or
   a dedicated Symbol if the family convention prefers it, stay consistent with phase 1 style);
   ready sets 503 via the response object or HttpCode mechanics when aggregate status is
   'error', 200 otherwise, always returning the full HealthResponse body. The route prefix is
   applied at registration time (the module passes options.health.path as the controller path:
   use a factory-driven approach consistent with how the spec's configurable path is honored;
   if NestJS route-prefix constraints require it, document the chosen mechanism in JSDoc and
   keep the default 'health' path first-class).
2. src/health/health.controller.spec.ts, written first: live is 200 with empty checks and never
   calls indicators (spy on the service); ready 200 all-up; ready 503 names the failing check in
   the body; body shape matches the contract exactly.

Constraints:
- Thin controller: validate, delegate, return; no aggregation logic in the controller.
- Explicit DI; TypeScript strict, zero any; @fileoverview + @layer Controller header.
- Timeless, English-only comments; no em dashes; every it() carries a scenario comment.
- Never add Co-Authored-By, "Generated with", or any AI-attribution line to commits, PR titles,
  PR bodies, or comments.

Verification:
- `pnpm test:cov`: green, 100%. `pnpm lint && pnpm typecheck`: green.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in the per-task block and the Task index row.
2. Tick the satisfied acceptance-criteria checkboxes.
3. Bump the phase Progress counter (X / 5).
4. Append a Completion log entry: `- 5.3 ✅ <YYYY-MM-DD>: <one-line summary>`.
5. Update the P5 row in ../development_plan.md (canonical) and mirror docs/tasks/README.md.
6. Recompute the overall counter line in ../development_plan.md.
7. Commit: `feat(health): add liveness and readiness controller (5.3)`.
````

---

### Task 5.4: Registration wiring, contract suite, dogfood

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: S
- **Depends on**: 5.3

#### Description

Conditional registration of the health feature on both paths, the pinned response contract suite, and packaging proof.

#### Acceptance criteria

- [x] Sync path registers controller and service only when `health.enabled`; async path honors the documented fail-fast rule for controller-bearing features (spec §2.2), both asserted.
- [x] Contract tests pin the exact readiness JSON for the all-up and one-down cases.
- [x] Health exports present in the `.` barrel where applicable (service/controller stay internal; contracts live in `./health`); dogfood green; 100% coverage holds.

#### Files to create / modify

- `src/core.module.ts`, `src/health/health.contract.spec.ts`

#### Agent prompt

````
You are a senior NestJS library engineer working on @bymax-one/nest-core.

PROJECT: @bymax-one/nest-core, application foundation kit for NestJS 11. Disabled health
registers no controller and no route; the response JSON is a versioned contract.

CURRENT PHASE: 5 (health), Task 5.4 of 5

PRECONDITIONS
- Task 5.3 done: controller and service implemented and tested.

REQUIRED READING (only these)
- docs/technical_specification.md §2.2 (registration rules, async controller caveat) and §8.1.

TASK
Wire registration, pin the contract, prove packaging, test-first.

DELIVERABLES
1. src/core.module.ts: sync path appends HealthController + HealthService only when resolved
   health.enabled; async path applies the documented behavior for controller-bearing features
   (registered when the async options make them resolvable; descriptive configuration error per
   the spec when the combination is unsupported); remove temporary health seam stubs.
2. src/health/health.contract.spec.ts, written first: exact JSON for all-up readiness, one-down
   readiness (503), and liveness; a registration test proving disabled health exposes no route
   (Nest testing module + route inspection or 404 assertion).
3. Confirm the ./health subpath surfaces only contracts and response types.

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
3. Bump the phase Progress counter (X / 5).
4. Append a Completion log entry: `- 5.4 ✅ <YYYY-MM-DD>: <one-line summary>`.
5. Update the P5 row in ../development_plan.md (canonical) and mirror docs/tasks/README.md.
6. Recompute the overall counter line in ../development_plan.md.
7. Commit: `feat(health): wire conditional registration and pin the contract (5.4)`.
````

---

### Task 5.5: Phase close: verification, PR, Copilot review, merge

- **Status**: 📋 ToDo
- **Priority**: P0
- **Size**: S
- **Depends on**: 5.1, 5.2, 5.3, 5.4

#### Description

Audit the phase Definition of Done, update dashboards, open the phase PR, obtain and address the GitHub Copilot review, merge on green.

#### Acceptance criteria

- [ ] Every P5 Definition of Done checkbox in `../development_plan.md` verified and ticked.
- [ ] Phase file, plan dashboard, and README index consistent.
- [ ] PR from `feat/phase-05-health` with CI green and Copilot review resolved; merged, branch deleted.

#### Files to create / modify

- This file (statuses), `../development_plan.md`, `README.md` (folder index)

#### Agent prompt

````
You are a senior release engineer closing a development phase of @bymax-one/nest-core.

PROJECT: @bymax-one/nest-core. One PR per phase; GitHub Copilot code review is a mandatory gate.

CURRENT PHASE: 5 (health), Task 5.5 of 5 (LAST)

PRECONDITIONS
- Tasks 5.1 through 5.4 done and committed on feat/phase-05-health; local gates green.

REQUIRED READING (only these)
- ../development_plan.md: P5 block (Definition of Done) and Progress Dashboard.
- docs/tasks/phase-05-health.md: task index and completion log.

TASK
Close phase 5 through its pull request with a GitHub Copilot review.

DELIVERABLES
1. Verify each P5 DoD item (503 with named failing check, liveness shape, contract JSON,
   disabled registration); tick the checkboxes in ../development_plan.md.
2. Update dashboards: this phase file, the P5 row and overall counter in ../development_plan.md,
   the folder index in docs/tasks/README.md.
3. `gh pr create --title "feat(core): phase 5, health endpoints" --body <professional summary>`.
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
3. Append: `- 5.5 ✅ <YYYY-MM-DD>: phase PR merged with Copilot review`.
4. Update the P5 row (✅, 100%) and overall counter in ../development_plan.md; mirror README.md.
5. Commit dashboard updates post-merge as `docs(core): close phase 5 dashboards (5.5)`.
````

---

## Completion log

<!-- Append one line per completed task: - <id> ✅ <YYYY-MM-DD>: <summary> -->
- 5.1 ✅ 2026-07-16: added IHealthIndicator/HealthIndicatorResult contracts and HealthResponse types, exported through the ./health subpath barrel.
- 5.2 ✅ 2026-07-16: added HealthService with concurrent Promise.all aggregation, per-indicator timeout via a cleared race, and safe rejection/timeout down-conversion.
- 5.3 ✅ 2026-07-16: added the createHealthController factory (configurable prefix baked into @Controller metadata) with live (always 200) and ready (200/503 via HttpAdapterHost.reply) handlers, plus an async-path consistency guard.
- 5.4 ✅ 2026-07-16: wired conditional registration into core.module.ts (sync gates HealthController+HealthService on health.enabled; async always registers at the default path and self-guards), added the booted-app contract suite (liveness, all-up, one-down/503, disabled-404), dogfood and both coverage configs green.
