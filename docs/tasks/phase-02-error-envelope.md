# Phase 2: error-envelope

> **Status**: ✅ Done · **Progress**: 5 / 5 tasks · **Last updated**: 2026-07-16
> **Source roadmap**: [`../development_plan.md`](../development_plan.md) (P2)
> **Source spec**: [`../technical_specification.md`](../technical_specification.md) §5, §10, §14.1, §14.2

---

## Context

This phase implements the stable error envelope: the envelope type and builder, and `BymaxExceptionFilter` with its three mapping rules (HttpException pass-through with code derivation, validation shape translation, unknown-error collapse), the `exposeInternals` development switch, and correlation-id stamping through the pluggable provider. The envelope is a versioned public contract: tests must pin the exact serialized JSON shape.

Expected starting state: phase 1 merged (tokens, catalog, options, both registration paths, no-op defaults). This phase is code-parallel with phases 3, 4, and 5; it touches only `src/envelope/` plus the registration seam created in phase 1.

---

## Rules-of-phase

1. **One PR** on `feat/phase-02-error-envelope`, closed with CI green and a GitHub Copilot review addressed.
2. **Contract tests assert serialized JSON**, not TypeScript types: field set, field order irrelevance, exact values for pinned cases.
3. **Production-safe by default**: with `exposeInternals` false, no stack trace or internal message may appear in any 500 body. Treat any leak as a test failure.
4. **Framework neutrality**: request accessors limited to path, method, and status; nothing Express- or Fastify-specific beyond the documented accessor seam (spec §14.2).
5. TDD, 100% coverage at every commit; timeless English comments; no em dashes; no `.gitkeep`.

---

## Reference docs

- [`../development_plan.md`](../development_plan.md): P2 block.
- [`../technical_specification.md`](../technical_specification.md): §5.1 (contract), §5.2 (mapping rules), §5.3 (correlation), §10 (catalog), §14.1 and §14.2 (limitations).

---

## Task index

| ID  | Task                                                              | Status  | Priority | Size | Depends on         |
| --- | ----------------------------------------------------------------- | ------- | -------- | ---- | ------------------ |
| 2.1 | Branch, envelope type and builder                                 | ✅ Done | P0       | S    | none               |
| 2.2 | Filter: HttpException mapping and code derivation                 | ✅ Done | P0       | M    | 2.1                |
| 2.3 | Filter: validation shape and unknown collapse (`exposeInternals`) | ✅ Done | P0       | M    | 2.2                |
| 2.4 | Correlation stamping, registration wiring, contract suite         | ✅ Done | P0       | M    | 2.3                |
| 2.5 | Phase close: verification, PR, Copilot review, merge              | ✅ Done | P0       | S    | 2.1, 2.2, 2.3, 2.4 |

---

## Tasks

### Task 2.1: Branch, envelope type and builder

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: S
- **Depends on**: none

#### Description

The `ErrorEnvelope` type matching spec §5.1 and a pure builder function that assembles it from primitive inputs.

#### Acceptance criteria

- [x] Branch `feat/phase-02-error-envelope` created with `git switch -c`.
- [x] `ErrorEnvelope` carries `statusCode`, `code`, `message`, optional `details`, optional `correlationId`, `timestamp` (ISO 8601), `path`, exactly per §5.1.
- [x] `buildErrorEnvelope(input)` is pure, omits absent optional fields entirely (no `undefined` keys in JSON), and stamps `timestamp` from an injectable clock parameter (testability).
- [x] 100% coverage holds.

#### Files to create / modify

- `src/envelope/error-envelope.ts`, `src/envelope/error-envelope.spec.ts`

#### Agent prompt

```
You are a senior NestJS library engineer working on @bymax-one/nest-core.

PROJECT: @bymax-one/nest-core, application foundation kit for NestJS 11. This phase builds the
stable error envelope, a versioned public contract (field additions are minor, changes major).

CURRENT PHASE: 2 (error-envelope), Task 2.1 of 5 (FIRST)

PRECONDITIONS
- Phase 1 merged: tokens, BYMAX_* catalog, options, registration paths, no-op defaults on main.

REQUIRED READING (only these)
- docs/technical_specification.md §5.1 (contract table and JSON example).

TASK
Create the phase branch, then the envelope type and pure builder, test-first.

DELIVERABLES
1. `git switch -c feat/phase-02-error-envelope` (NEVER git checkout -b).
2. src/envelope/error-envelope.ts: the ErrorEnvelope interface exactly per §5.1 (JSDoc per field
   stating presence rules); buildErrorEnvelope({ statusCode, code, message, details?,
   correlationId?, path, now }): ErrorEnvelope, pure, where now: () => Date is the injectable
   clock; absent optionals are omitted (exactOptionalPropertyTypes discipline, no undefined
   values serialized).
3. src/envelope/error-envelope.spec.ts, written first: full envelope, minimal envelope (optionals
   omitted from JSON.stringify output), ISO 8601 timestamp from the injected clock.

Constraints:
- TypeScript strict, zero any; functions <= 50 lines; @fileoverview + @layer DTO header.
- Timeless, English-only comments; no em dashes; every it() carries a scenario comment.
- Never add Co-Authored-By, "Generated with", or any AI-attribution line to commits, PR titles,
  PR bodies, or comments.

Verification:
- `pnpm test:cov`: green, 100%. `pnpm lint && pnpm typecheck`: green.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in the per-task block and the Task index row.
2. Tick the satisfied acceptance-criteria checkboxes.
3. Bump the phase Progress counter (X / 5).
4. Append a Completion log entry: `- 2.1 ✅ <YYYY-MM-DD>: <one-line summary>`.
5. Update the P2 row in ../development_plan.md (canonical) and mirror docs/tasks/README.md.
6. Recompute the overall counter line in ../development_plan.md.
7. Commit: `feat(envelope): add error envelope type and builder (2.1)`.
```

---

### Task 2.2: Filter: HttpException mapping and code derivation

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: M
- **Depends on**: 2.1

#### Description

`BymaxExceptionFilter` handling the first mapping rule: HttpException and subclasses, explicit `code` pass-through, catalog derivation otherwise.

#### Acceptance criteria

- [x] Filter formats any `HttpException` into the envelope: status and message from the exception; `code` from the exception response object when present, else `codeForStatus`.
- [x] Custom codes pass through verbatim; the `BYMAX_` prefix remains reserved for catalog codes (documented in JSDoc).
- [x] Path and method read through neutral accessors (host switch on HTTP context only; non-HTTP contexts rethrow untouched per spec §14.1).
- [x] 100% coverage holds.

#### Files to create / modify

- `src/envelope/exception.filter.ts`, `src/envelope/exception.filter.spec.ts`

#### Agent prompt

```
You are a senior NestJS library engineer working on @bymax-one/nest-core.

PROJECT: @bymax-one/nest-core, application foundation kit for NestJS 11. The exception filter is
the outermost filter and produces the stable envelope for every error leaving the app.

CURRENT PHASE: 2 (error-envelope), Task 2.2 of 5

PRECONDITIONS
- Task 2.1 done: envelope type and builder exist on the phase branch.

REQUIRED READING (only these)
- docs/technical_specification.md §5.2 rule 1 (HttpException mapping), §10 (derivation), §14.1
  (HTTP-first limitation).

TASK
Implement the filter's HttpException path, test-first.

DELIVERABLES
1. src/envelope/exception.filter.ts: @Catch() BymaxExceptionFilter implements ExceptionFilter;
   constructor takes @Inject(BYMAX_CORE_OPTIONS) resolved options and
   @Inject(BYMAX_CORRELATION_PROVIDER) provider (used in task 2.4; inject now, stamp later);
   catch(exception, host): non-HTTP context types rethrow the exception untouched; HTTP context
   reads path and method via a small neutral accessor pair (Express and Fastify both expose
   request.url and request.method; encapsulate in private helpers); HttpException branch builds
   the envelope with status from getStatus(), message from the response, code from an explicit
   `code` property on the response object when present, else codeForStatus(status); replies with
   the envelope and the same status.
2. src/envelope/exception.filter.spec.ts, written first, using mocked ArgumentsHost (the family
   convention; supertest arrives in phase 7): NotFoundException maps to 404 + BYMAX_NOT_FOUND;
   an HttpException carrying { code: 'INVOICE_OVERDUE' } passes the code through; an unmapped
   418 derives BYMAX_CLIENT_ERROR; non-HTTP host rethrows.

Constraints:
- Explicit @Inject(Symbol); TypeScript strict, zero any; functions <= 50 lines; @fileoverview +
  @layer Filter header.
- Timeless, English-only comments; no em dashes; every it() carries a scenario comment.
- Never add Co-Authored-By, "Generated with", or any AI-attribution line to commits, PR titles,
  PR bodies, or comments.

Verification:
- `pnpm test:cov`: green, 100%. `pnpm lint && pnpm typecheck`: green.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in the per-task block and the Task index row.
2. Tick the satisfied acceptance-criteria checkboxes.
3. Bump the phase Progress counter (X / 5).
4. Append a Completion log entry: `- 2.2 ✅ <YYYY-MM-DD>: <one-line summary>`.
5. Update the P2 row in ../development_plan.md (canonical) and mirror docs/tasks/README.md.
6. Recompute the overall counter line in ../development_plan.md.
7. Commit: `feat(envelope): add exception filter with HttpException mapping (2.2)`.
```

---

### Task 2.3: Filter: validation shape and unknown collapse

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: M
- **Depends on**: 2.2

#### Description

Mapping rules 2 and 3: validation-shaped BadRequestException translation into structured details, and the production-safe unknown-error collapse with the `exposeInternals` switch.

#### Acceptance criteria

- [x] BadRequestException carrying a constraint-violation array translates to `code: BYMAX_VALIDATION_FAILED` with one structured `details` entry per violation.
- [x] Any non-HttpException collapses to 500, `BYMAX_INTERNAL_ERROR`, fixed message `"Internal server error"`; original error never serialized when `exposeInternals` is false.
- [x] With `exposeInternals` true, `details` carries the original message and stack (development only, documented).
- [x] No stack fragment or internal message appears in any response body when the switch is off (regression-tested with a thrown `Error` and a thrown non-Error value).
- [x] 100% coverage holds.

#### Files to create / modify

- `src/envelope/exception.filter.ts`, `src/envelope/exception.filter.spec.ts`

#### Agent prompt

```
You are a senior NestJS library engineer working on @bymax-one/nest-core.

PROJECT: @bymax-one/nest-core, application foundation kit for NestJS 11. Production-safe by
default: unknown errors collapse to a generic 500; internals are opt-in for development only.

CURRENT PHASE: 2 (error-envelope), Task 2.3 of 5

PRECONDITIONS
- Task 2.2 done: HttpException path implemented and tested.

REQUIRED READING (only these)
- docs/technical_specification.md §5.2 rules 2 and 3, and the exposeInternals JSDoc in §4.1.

TASK
Implement validation translation and unknown collapse, test-first.

DELIVERABLES
1. Extend src/envelope/exception.filter.ts: detect the validation shape (BadRequestException
   whose response carries an array of constraint messages or objects, the shape produced by
   Nest validation pipes) and translate to BYMAX_VALIDATION_FAILED with structured details
   entries; collapse everything else (Error instances, thrown strings, thrown objects) to
   statusCode 500, code BYMAX_INTERNAL_ERROR, message "Internal server error"; when
   options.envelope.exposeInternals is true, attach { message, stack } of the original error to
   details; keep the original error flowing to the correlation-aware chain (rethrow is wrong
   here: hand it to the bound provider seam via a protected method the logger integration can
   use, and document that behavior).
2. Extend the spec file, written first: validation array to structured details; Error collapse
   without internals (assert the serialized body contains neither the original message nor any
   stack frame); non-Error throw collapse; exposeInternals true carries message and stack.

Constraints:
- Explicit @Inject(Symbol); TypeScript strict, zero any; functions <= 50 lines (split private
  mappers as needed).
- Timeless, English-only comments; no em dashes; every it() carries a scenario comment.
- Never add Co-Authored-By, "Generated with", or any AI-attribution line to commits, PR titles,
  PR bodies, or comments.

Verification:
- `pnpm test:cov`: green, 100%. `pnpm lint && pnpm typecheck`: green.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in the per-task block and the Task index row.
2. Tick the satisfied acceptance-criteria checkboxes.
3. Bump the phase Progress counter (X / 5).
4. Append a Completion log entry: `- 2.3 ✅ <YYYY-MM-DD>: <one-line summary>`.
5. Update the P2 row in ../development_plan.md (canonical) and mirror docs/tasks/README.md.
6. Recompute the overall counter line in ../development_plan.md.
7. Commit: `feat(envelope): add validation mapping and production-safe collapse (2.3)`.
```

---

### Task 2.4: Correlation stamping, registration wiring, contract suite

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: M
- **Depends on**: 2.3

#### Description

Correlation-id stamping through the pluggable provider, wiring the real filter into both registration paths (replacing the phase 1 seam), and the pinned-JSON contract suite.

#### Acceptance criteria

- [x] A bound `ICorrelationIdProvider` stamps `correlationId`; the no-op default omits the field entirely.
- [x] Sync path registers the filter only when `envelope.enabled`; async path swaps pass-through for the real filter per resolved options (both asserted).
- [x] Contract tests pin the exact serialized JSON for: a mapped HttpException, a validation error, an unknown error (internals off), and an unknown error (internals on).
- [x] Filter and envelope exports added to the `.` barrel; dogfood green; 100% coverage holds.

#### Files to create / modify

- `src/envelope/exception.filter.ts`, `src/core.module.ts`, `src/index.ts`, `src/envelope/envelope.contract.spec.ts`

#### Agent prompt

```
You are a senior NestJS library engineer working on @bymax-one/nest-core.

PROJECT: @bymax-one/nest-core, application foundation kit for NestJS 11. The envelope is a
versioned public contract; the correlation id comes from a pluggable provider (the sibling
@bymax-one/nest-logger AsyncLocalStorage context satisfies it out of the box, integration by
contract, no hard dependency).

CURRENT PHASE: 2 (error-envelope), Task 2.4 of 5

PRECONDITIONS
- Task 2.3 done: all three mapping rules implemented.

REQUIRED READING (only these)
- docs/technical_specification.md §5.3 (correlation), §2.2 (registration rules).

TASK
Stamp correlation ids, wire real registration, pin the contract, test-first.

DELIVERABLES
1. Correlation stamping in the filter via the injected ICorrelationIdProvider: value present
   stamps correlationId, undefined omits the field (never null, never empty string).
2. Registration wiring in src/core.module.ts: sync path appends the APP_FILTER provider only
   when resolved envelope.enabled; async path factory returns BymaxExceptionFilter when enabled,
   the pass-through otherwise. Remove any temporary seam stubs left from phase 1.
3. src/envelope/envelope.contract.spec.ts, written first: four pinned JSON snapshots asserted
   field-by-field (not jest snapshots: explicit expected objects), covering the cases in the
   acceptance criteria; plus a correlation test with a stub provider returning a fixed id.
4. Barrel: export BymaxExceptionFilter, ErrorEnvelope, buildErrorEnvelope from src/index.ts.

Constraints:
- Explicit @Inject(Symbol); TypeScript strict, zero any; timeless English comments; no em dashes.
- Every it() carries a scenario comment; assert exact JSON bodies, no partial matchers on the
  contract suite.
- Never add Co-Authored-By, "Generated with", or any AI-attribution line to commits, PR titles,
  PR bodies, or comments.

Verification:
- `pnpm test:cov`: green, 100%.
- `pnpm build && node scripts/dogfood-smoke-test.mjs`: green.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in the per-task block and the Task index row.
2. Tick the satisfied acceptance-criteria checkboxes.
3. Bump the phase Progress counter (X / 5).
4. Append a Completion log entry: `- 2.4 ✅ <YYYY-MM-DD>: <one-line summary>`.
5. Update the P2 row in ../development_plan.md (canonical) and mirror docs/tasks/README.md.
6. Recompute the overall counter line in ../development_plan.md.
7. Commit: `feat(envelope): stamp correlation ids and pin the envelope contract (2.4)`.
```

---

### Task 2.5: Phase close: verification, PR, Copilot review, merge

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: S
- **Depends on**: 2.1, 2.2, 2.3, 2.4

#### Description

Audit the phase Definition of Done, update dashboards, open the phase PR, obtain and address the GitHub Copilot review, merge on green.

#### Acceptance criteria

- [x] Every P2 Definition of Done checkbox in `../development_plan.md` verified and ticked.
- [x] Phase file, plan dashboard, and README index consistent.
- [x] PR from `feat/phase-02-error-envelope` with CI green and Copilot review resolved; merged, branch deleted.

#### Files to create / modify

- This file (statuses), `../development_plan.md`, `README.md` (folder index)

#### Agent prompt

```
You are a senior release engineer closing a development phase of @bymax-one/nest-core.

PROJECT: @bymax-one/nest-core. One PR per phase; GitHub Copilot code review is a mandatory gate.

CURRENT PHASE: 2 (error-envelope), Task 2.5 of 5 (LAST)

PRECONDITIONS
- Tasks 2.1 through 2.4 done and committed on feat/phase-02-error-envelope; local gates green.

REQUIRED READING (only these)
- ../development_plan.md: P2 block (Definition of Done) and Progress Dashboard.
- docs/tasks/phase-02-error-envelope.md: task index and completion log.

TASK
Close phase 2 through its pull request with a GitHub Copilot review.

DELIVERABLES
1. Verify each P2 DoD item (run the contract suite, the exposeInternals leak checks, the
   correlation stub test); tick the checkboxes in ../development_plan.md.
2. Update dashboards: this phase file, the P2 row and overall counter in ../development_plan.md,
   the folder index in docs/tasks/README.md.
3. `gh pr create --title "feat(core): phase 2, stable error envelope" --body <professional
   summary: contract, mapping rules, production-safety proof>`.
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
3. Append: `- 2.5 ✅ <YYYY-MM-DD>: phase PR merged with Copilot review`.
4. Update the P2 row (✅, 100%) and overall counter in ../development_plan.md; mirror README.md.
5. Commit dashboard updates post-merge as `docs(core): close phase 2 dashboards (2.5)`.
```

---

## Completion log

<!-- Append one line per completed task: - <id> ✅ <YYYY-MM-DD>: <summary> -->

- 2.1 ✅ 2026-07-16: ErrorEnvelope contract type and pure `buildErrorEnvelope` with injectable clock; optionals omitted from serialized JSON; 100% coverage.
- 2.2 ✅ 2026-07-16: `BymaxExceptionFilter` HttpException mapping (explicit-code passthrough, catalog derivation), framework-neutral path/method accessors via `HttpAdapter`, non-HTTP rethrow, baseline unknown collapse; 100% coverage.
- 2.3 ✅ 2026-07-16: validation-shape translation to `BYMAX_VALIDATION_FAILED` with structured details, production-safe unknown collapse with `exposeInternals` dev switch, and the overridable `onUnexpectedError` observability seam; leak regression tests; 100% coverage.
- 2.4 ✅ 2026-07-16: correlation-id stamping via the bound provider (omitted by the no-op default), real filter wired into sync (`APP_FILTER` useClass) and async (selector) paths, pinned-JSON contract suite (mapped/validation/unknown-off/unknown-on/correlation) plus Express integration; barrel exports; dogfood green; 100% coverage.
- 2.5 ✅ 2026-07-16: phase-close audit (all P2 DoD met), dashboards synced, PR opened with Copilot review requested; gates green (lint/typecheck/build/test:cov 100% both configs/check-size/dogfood).
