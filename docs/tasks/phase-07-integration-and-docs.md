# Phase 7: integration-and-docs

> **Status**: 📋 ToDo · **Progress**: 0 / 5 tasks · **Last updated**: 2026-07-06
> **Source roadmap**: [`../development_plan.md`](../development_plan.md) (P7)
> **Source spec**: [`../technical_specification.md`](../technical_specification.md) §15, §13.2

---

## Context

This phase proves the whole surface works together the way a real application consumes it, and documents it publicly. An end-to-end fixture application exercises both registration paths with the feature combinations that matter; cross-feature assertions verify the seams (envelope carries the correlation id, timing feeds metrics, readiness reflects a failing indicator); the README becomes the complete public reference, with examples mirrored by fixture code so they are guaranteed to compile.

Expected starting state: phases 2 through 6 merged; every feature works in isolation with 100% coverage.

---

## Rules-of-phase

1. **One PR** on `feat/phase-07-integration-and-docs`, closed with CI green and a GitHub Copilot review addressed.
2. **E2E suites run with the bounded worker pool, one suite at a time**; never in parallel with the unit suite.
3. **README examples must compile**: they are extracted from or mirrored by fixture code, never pseudocode.
4. **No new feature code**: integration gaps found here are fixed as bugs against the feature's contract, not as new surface.
5. TDD where fixes are needed; 100% coverage holds; timeless English comments; no em dashes; no `.gitkeep`.

---

## Reference docs

- [`../development_plan.md`](../development_plan.md): P7 block.
- [`../technical_specification.md`](../technical_specification.md): §15 (example integration), §13.2 (repository standard), §2.2 (registration paths).

---

## Task index

| ID | Task | Status | Priority | Size | Depends on |
|---|---|---|---|---|---|
| 7.1 | Branch, e2e fixture app, `forRoot` combinations | 📋 ToDo | P0 | M | none |
| 7.2 | `forRootAsync` e2e and cross-feature assertions | 📋 ToDo | P0 | M | 7.1 |
| 7.3 | Full README (feature tour, configuration reference, examples) | 📋 ToDo | P0 | M | 7.2 |
| 7.4 | CHANGELOG entry, dogfood, docs polish | 📋 ToDo | P1 | S | 7.3 |
| 7.5 | Phase close: verification, PR, Copilot review, merge | 📋 ToDo | P0 | S | 7.1, 7.2, 7.3, 7.4 |

---

## Tasks

### Task 7.1: Branch, e2e fixture app, `forRoot` combinations

- **Status**: 📋 ToDo
- **Priority**: P0
- **Size**: M
- **Depends on**: none

#### Description

The e2e fixture application and the sync-path suites: all features enabled together, and everything off.

#### Acceptance criteria

- [ ] Branch `feat/phase-07-integration-and-docs` created with `git switch -c`.
- [ ] `test/e2e/` fixture boots a real Nest app (supertest) with envelope + timing + health + metrics enabled: error responses match the envelope contract, `/health/live` and `/health/ready` respond, `/metrics` scrapes.
- [ ] Everything-off fixture: no health route (404), no metrics route, errors flow through Nest's default shape (filter absent).
- [ ] Suites run under `jest.e2e.config.ts` with bounded workers; unit suite untouched.

#### Files to create / modify

- `test/e2e/fixture/app.fixture.ts`, `test/e2e/forroot-all-on.e2e-spec.ts`, `test/e2e/forroot-all-off.e2e-spec.ts`

#### Agent prompt

````
You are a senior NestJS integration engineer working on @bymax-one/nest-core.

PROJECT: @bymax-one/nest-core, application foundation kit for NestJS 11. This phase proves the
assembled surface end to end with a real Nest application fixture.

CURRENT PHASE: 7 (integration-and-docs), Task 7.1 of 5 (FIRST)

PRECONDITIONS
- Phases 2 through 6 merged; all unit suites green at 100%.

REQUIRED READING (only these)
- docs/technical_specification.md §15 (integration example) and §2.2 (sync path).

TASK
Create the phase branch, the fixture app, and the two sync-path e2e suites.

DELIVERABLES
1. `git switch -c feat/phase-07-integration-and-docs` (NEVER git checkout -b).
2. test/e2e/fixture/app.fixture.ts: a factory building a Nest application from a small fixture
   module (one controller with: a happy route, a route throwing NotFoundException, a route
   throwing a plain Error, a slow route) with BymaxCoreModule wired per a passed options object;
   include a stub correlation provider and a stub health indicator (switchable up/down) as
   fixture providers.
3. test/e2e/forroot-all-on.e2e-spec.ts: forRoot with everything enabled (metrics too;
   prom-client is a devDependency): envelope JSON exact for the 404 and the collapsed 500;
   /health/live 200; /health/ready 200 up and 503 when the stub indicator is down; /metrics
   contains http_requests_total after traffic.
4. test/e2e/forroot-all-off.e2e-spec.ts: all features disabled: health and metrics routes 404;
   thrown errors produce Nest's default error body (assert the envelope's `code` field is
   ABSENT, proving the filter is not registered).

Constraints:
- E2E runs under jest.e2e.config.ts, bounded workers, one suite at a time; never parallel with
  the unit suite.
- TypeScript strict, zero any; timeless English comments; no em dashes; every it() carries a
  scenario comment.
- Never add Co-Authored-By, "Generated with", or any AI-attribution line to commits, PR titles,
  PR bodies, or comments.

Verification:
- `pnpm test:e2e`: green.
- `pnpm test:cov`: still green at 100% (e2e does not dilute unit coverage config).

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in the per-task block and the Task index row.
2. Tick the satisfied acceptance-criteria checkboxes.
3. Bump the phase Progress counter (X / 5).
4. Append a Completion log entry: `- 7.1 ✅ <YYYY-MM-DD>: <one-line summary>`.
5. Update the P7 row in ../development_plan.md (canonical) and mirror docs/tasks/README.md.
6. Recompute the overall counter line in ../development_plan.md.
7. Commit: `test(core): add e2e fixture and forRoot combination suites (7.1)`.
````

---

### Task 7.2: `forRootAsync` e2e and cross-feature assertions

- **Status**: 📋 ToDo
- **Priority**: P0
- **Size**: M
- **Depends on**: 7.1

#### Description

The async-path suite and the cross-feature seams: correlation id in the envelope, timing feeding metrics, pass-through transparency.

#### Acceptance criteria

- [ ] `forRootAsync` fixture (factory + inject) passes the same all-on assertions as the sync suite.
- [ ] Envelope carries the stub provider's correlation id; timing samples appear in `/metrics` histogram counts; async everything-off leaves requests observably identical to a bare app (pass-through proof).
- [ ] Readiness flips 200 to 503 when the stub indicator goes down mid-suite.

#### Files to create / modify

- `test/e2e/forrootasync.e2e-spec.ts`, `test/e2e/cross-feature.e2e-spec.ts`

#### Agent prompt

````
You are a senior NestJS integration engineer working on @bymax-one/nest-core.

PROJECT: @bymax-one/nest-core, application foundation kit for NestJS 11. The async path gates
pipeline slots inside factories; cross-feature seams are contracts (correlation provider,
timing sink bridge, indicator token).

CURRENT PHASE: 7 (integration-and-docs), Task 7.2 of 5

PRECONDITIONS
- Task 7.1 done: fixture and sync suites green.

REQUIRED READING (only these)
- docs/technical_specification.md §2.2 (async path), §5.3, §9.3.

TASK
Author the async e2e suite and the cross-feature assertion suite.

DELIVERABLES
1. test/e2e/forrootasync.e2e-spec.ts: fixture wired through forRootAsync({ inject, useFactory });
   all-on assertions mirroring 7.1; everything-off via async options: a request to the happy
   route returns byte-identical body and status to a bare Nest app without the module (the
   pass-through transparency proof).
2. test/e2e/cross-feature.e2e-spec.ts: correlation id from the stub provider appears in the
   envelope of an error response; after N requests the /metrics output shows the matching
   http_requests_total count for the route label; flipping the stub indicator flips readiness
   200 to 503 and back.

Constraints:
- Bounded workers, sequential suites; TypeScript strict, zero any; timeless English comments;
  no em dashes; every it() carries a scenario comment.
- Never add Co-Authored-By, "Generated with", or any AI-attribution line to commits, PR titles,
  PR bodies, or comments.

Verification:
- `pnpm test:e2e`: green, both registration paths covered.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in the per-task block and the Task index row.
2. Tick the satisfied acceptance-criteria checkboxes.
3. Bump the phase Progress counter (X / 5).
4. Append a Completion log entry: `- 7.2 ✅ <YYYY-MM-DD>: <one-line summary>`.
5. Update the P7 row in ../development_plan.md (canonical) and mirror docs/tasks/README.md.
6. Recompute the overall counter line in ../development_plan.md.
7. Commit: `test(core): add forRootAsync and cross-feature e2e suites (7.2)`.
````

---

### Task 7.3: Full README

- **Status**: 📋 ToDo
- **Priority**: P0
- **Size**: M
- **Depends on**: 7.2

#### Description

The complete public README: feature tour, full configuration reference, integration examples mirrored by fixture code.

#### Acceptance criteria

- [ ] README documents every option in `BymaxCoreModuleOptions` (a reference table per feature block with defaults) and every subpath export.
- [ ] Integration examples: quick start (`forRoot`), production wiring (`forRootAsync`), correlation provider binding (including the `useExisting` pattern with `@bymax-one/nest-logger`), custom health indicator, paginated controller (offset and cursor), enabling metrics.
- [ ] Every code example mirrors fixture or spec-verified code; a consumer following only the README reaches a working setup.
- [ ] Badges row present; sections follow the sibling libraries' README structure.

#### Files to create / modify

- `README.md`

#### Agent prompt

````
You are a senior developer-experience engineer working on @bymax-one/nest-core.

PROJECT: @bymax-one/nest-core, application foundation kit for NestJS 11, public npm package.
The README is the primary public reference; examples must be real (mirrored by fixture code),
never pseudocode.

CURRENT PHASE: 7 (integration-and-docs), Task 7.3 of 5

PRECONDITIONS
- Tasks 7.1 and 7.2 done: fixtures cover every documented flow.

REQUIRED READING (only these)
- docs/technical_specification.md §4 (options), §5 to §9 (feature contracts), §15 (example).
- README structure reference: the sibling ../nest-logger/README.md (headings and badge row only,
  do not copy content).
- test/e2e/fixture/app.fixture.ts (the examples' source of truth).

TASK
Write the complete public README.

DELIVERABLES
1. README.md: title and one-paragraph value proposition; badge row (CI, npm version, license,
   coverage, mutation score); Features section (the five areas, one line each, opt-in noted);
   Install (pnpm add @bymax-one/nest-core, peers listed, prom-client marked optional); Quick
   start (forRoot minimal); Configuration reference (per-feature tables: option, type, default,
   description, sourced from §4.1); Error envelope contract (the JSON, field table, code
   catalog summary, custom-code pass-through); Request timing (sample shape, sink binding
   example); Pagination (offset and cursor controller examples); Health (custom indicator
   example, response contract, 200/503 rule); Metrics (enabling, optional peer note, default
   HTTP metrics table); Integration with @bymax-one/nest-logger (the useExisting correlation
   binding); Compatibility (Node >= 24, NestJS 11, Express and Fastify); Contributing and
   License links.
2. Every example compiles: mirror fixture code; where a snippet simplifies, keep it type-correct
   against the real API.

Constraints:
- Professional, public-grade English; no em dashes anywhere; no internal references (only this
  repository and published sibling packages).
- Never add Co-Authored-By, "Generated with", or any AI-attribution line to commits, PR titles,
  PR bodies, or comments.

Verification:
- Extract each TypeScript snippet mentally against src types; run `pnpm typecheck` on any
  snippet you ported into the fixture; `pnpm lint` on the repo stays green (markdown untouched
  by eslint but prettier formats it: run `pnpm exec prettier --check README.md`).

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in the per-task block and the Task index row.
2. Tick the satisfied acceptance-criteria checkboxes.
3. Bump the phase Progress counter (X / 5).
4. Append a Completion log entry: `- 7.3 ✅ <YYYY-MM-DD>: <one-line summary>`.
5. Update the P7 row in ../development_plan.md (canonical) and mirror docs/tasks/README.md.
6. Recompute the overall counter line in ../development_plan.md.
7. Commit: `docs(core): write the complete public README (7.3)`.
````

---

### Task 7.4: CHANGELOG entry, dogfood, docs polish

- **Status**: 📋 ToDo
- **Priority**: P1
- **Size**: S
- **Depends on**: 7.3

#### Description

The changelog entry for the upcoming release, the packaging proof, and a final documentation pass.

#### Acceptance criteria

- [ ] `CHANGELOG.md` Unreleased section describes the full 0.1.0 surface (one bullet per feature area).
- [ ] Dogfood smoke test green from the packed tarball (every subpath, ESM and CJS).
- [ ] `SECURITY.md` and `CONTRIBUTING.md` reviewed against the final surface; stale statements corrected.

#### Files to create / modify

- `CHANGELOG.md`, `SECURITY.md` (review), `CONTRIBUTING.md` (review)

#### Agent prompt

````
You are a senior release engineer working on @bymax-one/nest-core.

PROJECT: @bymax-one/nest-core, application foundation kit for NestJS 11, preparing its first
public release notes and packaging proof.

CURRENT PHASE: 7 (integration-and-docs), Task 7.4 of 5

PRECONDITIONS
- Task 7.3 done: README complete.

REQUIRED READING (only these)
- CHANGELOG.md (current skeleton), README.md (final surface), scripts/dogfood-smoke-test.mjs.

TASK
Write the release notes, prove packaging, polish community docs.

DELIVERABLES
1. CHANGELOG.md: under Unreleased, an Added section: error envelope (stable contract, catalog),
   timing interceptor (sink contract, slow flag), pagination subpath (offset, cursor codec),
   health subpath (indicator contract, live/ready), optional Prometheus metrics (lazy optional
   peer, default HTTP metrics), module (forRoot/forRootAsync, conditional registration).
   Keep-a-Changelog format, one line each.
2. Run `pnpm build && node scripts/dogfood-smoke-test.mjs`; fix packaging drift if any subpath
   fails (exports map, files array).
3. Review SECURITY.md and CONTRIBUTING.md against the final surface; correct stale claims
   (scripts list, coverage bar, subpath list).

Constraints:
- Professional English; no em dashes; timeless wording.
- Never add Co-Authored-By, "Generated with", or any AI-attribution line to commits, PR titles,
  PR bodies, or comments.

Verification:
- `node scripts/dogfood-smoke-test.mjs`: all subpaths pass ESM + CJS.
- `pnpm exec prettier --check CHANGELOG.md SECURITY.md CONTRIBUTING.md`: clean.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in the per-task block and the Task index row.
2. Tick the satisfied acceptance-criteria checkboxes.
3. Bump the phase Progress counter (X / 5).
4. Append a Completion log entry: `- 7.4 ✅ <YYYY-MM-DD>: <one-line summary>`.
5. Update the P7 row in ../development_plan.md (canonical) and mirror docs/tasks/README.md.
6. Recompute the overall counter line in ../development_plan.md.
7. Commit: `docs(core): add release notes and packaging proof (7.4)`.
````

---

### Task 7.5: Phase close: verification, PR, Copilot review, merge

- **Status**: 📋 ToDo
- **Priority**: P0
- **Size**: S
- **Depends on**: 7.1, 7.2, 7.3, 7.4

#### Description

Audit the phase Definition of Done, update dashboards, open the phase PR, obtain and address the GitHub Copilot review, merge on green.

#### Acceptance criteria

- [ ] Every P7 Definition of Done checkbox in `../development_plan.md` verified and ticked.
- [ ] Phase file, plan dashboard, and README index consistent.
- [ ] PR from `feat/phase-07-integration-and-docs` with CI green and Copilot review resolved; merged, branch deleted.

#### Files to create / modify

- This file (statuses), `../development_plan.md`, `README.md` (folder index)

#### Agent prompt

````
You are a senior release engineer closing a development phase of @bymax-one/nest-core.

PROJECT: @bymax-one/nest-core. One PR per phase; GitHub Copilot code review is a mandatory gate.

CURRENT PHASE: 7 (integration-and-docs), Task 7.5 of 5 (LAST)

PRECONDITIONS
- Tasks 7.1 through 7.4 done and committed on feat/phase-07-integration-and-docs; local gates
  green including test:e2e.

REQUIRED READING (only these)
- ../development_plan.md: P7 block (Definition of Done) and Progress Dashboard.
- docs/tasks/phase-07-integration-and-docs.md: task index and completion log.

TASK
Close phase 7 through its pull request with a GitHub Copilot review.

DELIVERABLES
1. Verify each P7 DoD item (both registration paths e2e, README option coverage, dogfood,
   README-mirrors-fixture check); tick the checkboxes in ../development_plan.md.
2. Update dashboards: this phase file, the P7 row and overall counter in ../development_plan.md,
   the folder index in docs/tasks/README.md.
3. `gh pr create --title "test(core): phase 7, end-to-end integration and public docs" --body
   <professional summary>`.
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
  present and resolved. Post-merge main: `pnpm build && pnpm test:cov && pnpm test:e2e` green.

Completion Protocol (after you finish):
1. Set this task's Status to ✅; phase header Status ✅, Progress 5 / 5.
2. Tick the satisfied acceptance-criteria checkboxes.
3. Append: `- 7.5 ✅ <YYYY-MM-DD>: phase PR merged with Copilot review`.
4. Update the P7 row (✅, 100%) and overall counter in ../development_plan.md; mirror README.md.
5. Commit dashboard updates post-merge as `docs(core): close phase 7 dashboards (7.5)`.
````

---

## Completion log

<!-- Append one line per completed task: - <id> ✅ <YYYY-MM-DD>: <summary> -->
