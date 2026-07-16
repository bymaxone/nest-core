# Phase 4: pagination

> **Status**: 🔄 In Progress · **Progress**: 3 / 5 tasks · **Last updated**: 2026-07-16
> **Source roadmap**: [`../development_plan.md`](../development_plan.md) (P4)
> **Source spec**: [`../technical_specification.md`](../technical_specification.md) §7, §14.4

---

## Context

This phase delivers the `./pagination` subpath: framework-neutral offset and cursor primitives. Pure functions only, no providers, no module state, no validation-library decorators, no ORM awareness. The cursor codec produces opaque `base64url` strings; malformed input rejects with the shared catalog's validation code. `buildCursorResult` implements the fetch-one-extra convention.

Expected starting state: phase 1 merged (the `BYMAX_*` catalog exists). Code-parallel with phases 2, 3, and 5; touches only `src/pagination/`.

---

## Rules-of-phase

1. **One PR** on `feat/phase-04-pagination`, closed with CI green and a GitHub Copilot review addressed.
2. **Pure functions only**: no module state, no providers, no NestJS imports beyond the exception class used for cursor rejection.
3. **Cursors encode ordering keys only, never sensitive data**: an invariant documented in JSDoc and guarded by the payload typing (`Record<string, string | number>`).
4. **Boundary tests are the core of this phase**: clamping floors, caps, defaults, round-trips, tampered input.
5. TDD, 100% coverage at every commit; timeless English comments; no em dashes; no `.gitkeep`.

---

## Reference docs

- [`../development_plan.md`](../development_plan.md): P4 block.
- [`../technical_specification.md`](../technical_specification.md): §7.1 (offset), §7.2 (cursor), §7.3 (ORM neutrality), §14.4 (cursor discipline).

---

## Task index

| ID | Task | Status | Priority | Size | Depends on |
|---|---|---|---|---|---|
| 4.1 | Branch, offset primitives (`normalizePageQuery`, `buildPageResult`) | ✅ Done | P0 | M | none |
| 4.2 | Cursor codec (`encodeCursor`, `decodeCursor`) | ✅ Done | P0 | M | none |
| 4.3 | `normalizeCursorQuery` and `buildCursorResult` | ✅ Done | P0 | S | 4.2 |
| 4.4 | Subpath barrel, zero-provider proof, boundary suite | 📋 ToDo | P0 | S | 4.1, 4.3 |
| 4.5 | Phase close: verification, PR, Copilot review, merge | 📋 ToDo | P0 | S | 4.1, 4.2, 4.3, 4.4 |

---

## Tasks

### Task 4.1: Branch, offset primitives

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: M
- **Depends on**: none

#### Description

`normalizePageQuery` with clamping and per-call options, `PageMeta`/`PageResult`, and `buildPageResult` with computed meta.

#### Acceptance criteria

- [x] Branch `feat/phase-04-pagination` created with `git switch -c`.
- [x] `normalizePageQuery` clamps: page floor 1, limit floor 1, limit cap `maxLimit` (default 100), default limit 20; non-numeric and negative input falls back to defaults; options are per-call, never module state.
- [x] `buildPageResult` computes `totalPages` correctly including the zero-items case.
- [x] Signatures match spec §7.1 exactly; 100% coverage holds.

#### Files to create / modify

- `src/pagination/offset.ts`, `src/pagination/offset.spec.ts`

#### Agent prompt

````
You are a senior TypeScript library engineer working on @bymax-one/nest-core.

PROJECT: @bymax-one/nest-core, application foundation kit for NestJS 11. The ./pagination subpath
is framework-neutral: pure helpers, no providers, no ORM awareness. Consumers' repositories
execute the queries; these helpers only shape queries and results.

CURRENT PHASE: 4 (pagination), Task 4.1 of 5 (FIRST)

PRECONDITIONS
- Phase 1 merged (the shared BYMAX_* catalog exists in src/envelope/error-codes.ts).

REQUIRED READING (only these)
- docs/technical_specification.md §7.1 (exact signatures and defaults).

TASK
Create the phase branch and implement the offset primitives, test-first.

DELIVERABLES
1. `git switch -c feat/phase-04-pagination` (NEVER git checkout -b).
2. src/pagination/offset.ts: PageQuery, PageMeta, PageResult<T> interfaces and
   normalizePageQuery(raw, options?) plus buildPageResult(items, totalItems, query) exactly per
   spec §7.1. Coerce raw.page/raw.limit safely from unknown (Number conversion with NaN and
   negative fallback to defaults); clamp limit into [1, maxLimit]; page into [1, Infinity);
   totalPages = Math.ceil(totalItems / limit) with 0 items yielding 0 pages.
3. src/pagination/offset.spec.ts, written first: table-driven boundary tests (page 0, negative,
   NaN, string numerics, limit above cap, exact cap, floor, defaults applied, custom
   defaultLimit/maxLimit per call, zero-items meta).

Constraints:
- Pure functions, no state; TypeScript strict, zero any; functions <= 50 lines; @fileoverview +
  @layer Utility header; imperative JSDoc with the defaults stated.
- Timeless, English-only comments; no em dashes; every it() carries a scenario comment.
- Never add Co-Authored-By, "Generated with", or any AI-attribution line to commits, PR titles,
  PR bodies, or comments.

Verification:
- `pnpm test:cov`: green, 100%. `pnpm lint && pnpm typecheck`: green.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in the per-task block and the Task index row.
2. Tick the satisfied acceptance-criteria checkboxes.
3. Bump the phase Progress counter (X / 5).
4. Append a Completion log entry: `- 4.1 ✅ <YYYY-MM-DD>: <one-line summary>`.
5. Update the P4 row in ../development_plan.md (canonical) and mirror docs/tasks/README.md.
6. Recompute the overall counter line in ../development_plan.md.
7. Commit: `feat(pagination): add offset primitives with clamping (4.1)`.
````

---

### Task 4.2: Cursor codec

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: M
- **Depends on**: none

#### Description

The opaque `base64url` cursor codec: `encodeCursor` and `decodeCursor` with malformed-input rejection mapped to the shared validation code.

#### Acceptance criteria

- [x] `decodeCursor(encodeCursor(x))` round-trips for string and number values.
- [x] Malformed input (not base64url, not JSON, JSON of the wrong shape, values of disallowed types) rejects with an `HttpException` whose response carries `code: BYMAX_VALIDATION_FAILED` and status 400.
- [x] The payload type is constrained to `Record<string, string | number>` at compile time and revalidated at runtime on decode.
- [x] 100% coverage holds.

#### Files to create / modify

- `src/pagination/cursor.ts`, `src/pagination/cursor.spec.ts`

#### Agent prompt

````
You are a senior TypeScript library engineer working on @bymax-one/nest-core.

PROJECT: @bymax-one/nest-core, application foundation kit for NestJS 11. Cursors are opaque
base64url strings encoding ordering keys only; the codec is the contract, consumers never parse
cursors manually. Cursors are not encrypted or signed and must never contain sensitive data.

CURRENT PHASE: 4 (pagination), Task 4.2 of 5

PRECONDITIONS
- Phase branch feat/phase-04-pagination exists (task 4.1 created it; if executing 4.2 first in a
  parallel setup, create it with git switch -c).

REQUIRED READING (only these)
- docs/technical_specification.md §7.2 (codec signatures) and §14.4 (cursor discipline).

TASK
Implement the cursor codec, test-first.

DELIVERABLES
1. src/pagination/cursor.ts: encodeCursor(payload: Record<string, string | number>): string
   using Buffer JSON + base64url; decodeCursor<T extends Record<string, string | number>>(cursor:
   string): T decoding, JSON-parsing, and runtime-validating the shape (plain object, values only
   string or number), throwing a BadRequestException whose response object is
   { code: BYMAX_VALIDATION_FAILED, message: <fixed descriptive message> } on ANY malformed
   input (catch decode/parse errors, never leak the underlying parse error text). Document the
   never-sensitive-data invariant in the JSDoc of both functions.
2. src/pagination/cursor.spec.ts, written first: round-trip with mixed string/number payload;
   rejection cases: random text, valid base64 of non-JSON, JSON array, JSON with boolean value,
   empty string; assert status 400 and the code on the exception response; assert the original
   parse error text does not appear in the message.

Constraints:
- Pure functions; node: Buffer only, no external encoding libs; TypeScript strict, zero any.
- Timeless, English-only comments; no em dashes; every it() carries a scenario comment.
- Never add Co-Authored-By, "Generated with", or any AI-attribution line to commits, PR titles,
  PR bodies, or comments.

Verification:
- `pnpm test:cov`: green, 100%. `pnpm lint && pnpm typecheck`: green.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in the per-task block and the Task index row.
2. Tick the satisfied acceptance-criteria checkboxes.
3. Bump the phase Progress counter (X / 5).
4. Append a Completion log entry: `- 4.2 ✅ <YYYY-MM-DD>: <one-line summary>`.
5. Update the P4 row in ../development_plan.md (canonical) and mirror docs/tasks/README.md.
6. Recompute the overall counter line in ../development_plan.md.
7. Commit: `feat(pagination): add opaque base64url cursor codec (4.2)`.
````

---

### Task 4.3: `normalizeCursorQuery` and `buildCursorResult`

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: S
- **Depends on**: 4.2

#### Description

Cursor query normalization (same clamping engine as offset) and the fetch-one-extra result builder.

#### Acceptance criteria

- [x] `normalizeCursorQuery` clamps limit identically to the offset path and passes the cursor through untouched (validation happens at decode time).
- [x] `buildCursorResult(items, limit, toCursor)`: with `limit + 1` rows fetched, trims the extra row and derives `nextCursor` from the last returned item; with `limit` rows or fewer, `nextCursor` is `null`.
- [x] Signatures match spec §7.2; 100% coverage holds.

#### Files to create / modify

- `src/pagination/cursor.ts`, `src/pagination/cursor.spec.ts`

#### Agent prompt

````
You are a senior TypeScript library engineer working on @bymax-one/nest-core.

PROJECT: @bymax-one/nest-core, application foundation kit for NestJS 11. buildCursorResult
implements the fetch-one-extra convention: the repository queries limit + 1 rows; the helper
trims and derives nextCursor.

CURRENT PHASE: 4 (pagination), Task 4.3 of 5

PRECONDITIONS
- Task 4.2 done: the codec exists on the phase branch.

REQUIRED READING (only these)
- docs/technical_specification.md §7.2 (CursorQuery, CursorResult, builder semantics).

TASK
Implement cursor query normalization and the result builder, test-first.

DELIVERABLES
1. Extend src/pagination/cursor.ts: CursorQuery, CursorResult<T>;
   normalizeCursorQuery(raw, options?) reusing the same limit-clamping logic as the offset path
   (extract a shared internal clampLimit helper if duplication appears, kept private to the
   subpath); buildCursorResult<T>(items, limit, toCursor) per the acceptance criteria, calling
   encodeCursor(toCursor(lastReturnedItem)) only when a next page exists.
2. Extend src/pagination/cursor.spec.ts, written first: limit+1 rows trims to limit and yields a
   decodable nextCursor derived from the last returned (not the trimmed) item; exactly limit rows
   yields null; fewer rows yields null; empty items yields null and empty array; clamping table
   for normalizeCursorQuery.

Constraints:
- Pure functions; TypeScript strict, zero any; functions <= 50 lines.
- Timeless, English-only comments; no em dashes; every it() carries a scenario comment.
- Never add Co-Authored-By, "Generated with", or any AI-attribution line to commits, PR titles,
  PR bodies, or comments.

Verification:
- `pnpm test:cov`: green, 100%. `pnpm lint && pnpm typecheck`: green.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in the per-task block and the Task index row.
2. Tick the satisfied acceptance-criteria checkboxes.
3. Bump the phase Progress counter (X / 5).
4. Append a Completion log entry: `- 4.3 ✅ <YYYY-MM-DD>: <one-line summary>`.
5. Update the P4 row in ../development_plan.md (canonical) and mirror docs/tasks/README.md.
6. Recompute the overall counter line in ../development_plan.md.
7. Commit: `feat(pagination): add cursor query normalization and result builder (4.3)`.
````

---

### Task 4.4: Subpath barrel, zero-provider proof, boundary suite

- **Status**: 📋 ToDo
- **Priority**: P0
- **Size**: S
- **Depends on**: 4.1, 4.3

#### Description

The `./pagination` barrel, proof that the subpath involves zero NestJS providers, and the consolidated boundary review.

#### Acceptance criteria

- [ ] `src/pagination/index.ts` exports the full §7 surface, nothing internal.
- [ ] A test imports the built `./pagination` subpath and verifies it works without any Nest module or provider in scope.
- [ ] Dogfood smoke test green (ESM and CJS for the subpath); bundle stays within the provisional budget; 100% coverage holds.

#### Files to create / modify

- `src/pagination/index.ts`, `src/pagination/subpath.spec.ts`

#### Agent prompt

````
You are a senior TypeScript library engineer working on @bymax-one/nest-core.

PROJECT: @bymax-one/nest-core, application foundation kit for NestJS 11. The ./pagination subpath
must be consumable standalone: zero providers, zero module context.

CURRENT PHASE: 4 (pagination), Task 4.4 of 5

PRECONDITIONS
- Tasks 4.1 and 4.3 done: offset and cursor surfaces complete on the phase branch.

REQUIRED READING (only these)
- docs/technical_specification.md §3.2 (subpath table) and §7 (public surface list).

TASK
Finalize the subpath barrel and prove standalone consumption, test-first.

DELIVERABLES
1. src/pagination/index.ts: selective exports of PageQuery, PageMeta, PageResult,
   normalizePageQuery, buildPageResult, CursorQuery, CursorResult, normalizeCursorQuery,
   encodeCursor, decodeCursor, buildCursorResult. No export * and no internal helpers leaked.
2. src/pagination/subpath.spec.ts, written first: exercises a realistic flow end to end (raw
   query in, normalized, one-extra fetch simulated with an array, result built, next page
   decoded) importing only from the barrel; confirms no NestJS testing module is needed.
3. Run the build and the guard scripts; if the pagination bundle exceeds the provisional 3 KiB
   brotli budget, flag it in the PR body rather than raising the budget (budgets change
   deliberately, not automatically).

Constraints:
- Selective barrel only; TypeScript strict, zero any.
- Timeless, English-only comments; no em dashes; every it() carries a scenario comment.
- Never add Co-Authored-By, "Generated with", or any AI-attribution line to commits, PR titles,
  PR bodies, or comments.

Verification:
- `pnpm test:cov`: green, 100%.
- `pnpm build && node scripts/check-size.mjs && node scripts/dogfood-smoke-test.mjs`: green.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in the per-task block and the Task index row.
2. Tick the satisfied acceptance-criteria checkboxes.
3. Bump the phase Progress counter (X / 5).
4. Append a Completion log entry: `- 4.4 ✅ <YYYY-MM-DD>: <one-line summary>`.
5. Update the P4 row in ../development_plan.md (canonical) and mirror docs/tasks/README.md.
6. Recompute the overall counter line in ../development_plan.md.
7. Commit: `feat(pagination): finalize subpath barrel and standalone proof (4.4)`.
````

---

### Task 4.5: Phase close: verification, PR, Copilot review, merge

- **Status**: 📋 ToDo
- **Priority**: P0
- **Size**: S
- **Depends on**: 4.1, 4.2, 4.3, 4.4

#### Description

Audit the phase Definition of Done, update dashboards, open the phase PR, obtain and address the GitHub Copilot review, merge on green.

#### Acceptance criteria

- [ ] Every P4 Definition of Done checkbox in `../development_plan.md` verified and ticked.
- [ ] Phase file, plan dashboard, and README index consistent.
- [ ] PR from `feat/phase-04-pagination` with CI green and Copilot review resolved; merged, branch deleted.

#### Files to create / modify

- This file (statuses), `../development_plan.md`, `README.md` (folder index)

#### Agent prompt

````
You are a senior release engineer closing a development phase of @bymax-one/nest-core.

PROJECT: @bymax-one/nest-core. One PR per phase; GitHub Copilot code review is a mandatory gate.

CURRENT PHASE: 4 (pagination), Task 4.5 of 5 (LAST)

PRECONDITIONS
- Tasks 4.1 through 4.4 done and committed on feat/phase-04-pagination; local gates green.

REQUIRED READING (only these)
- ../development_plan.md: P4 block (Definition of Done) and Progress Dashboard.
- docs/tasks/phase-04-pagination.md: task index and completion log.

TASK
Close phase 4 through its pull request with a GitHub Copilot review.

DELIVERABLES
1. Verify each P4 DoD item (clamping boundaries, round-trip, tampered rejection, fetch-one-extra
   trim, zero-provider import); tick the checkboxes in ../development_plan.md.
2. Update dashboards: this phase file, the P4 row and overall counter in ../development_plan.md,
   the folder index in docs/tasks/README.md.
3. `gh pr create --title "feat(core): phase 4, pagination primitives" --body <professional
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
3. Append: `- 4.5 ✅ <YYYY-MM-DD>: phase PR merged with Copilot review`.
4. Update the P4 row (✅, 100%) and overall counter in ../development_plan.md; mirror README.md.
5. Commit dashboard updates post-merge as `docs(core): close phase 4 dashboards (4.5)`.
````

---

## Completion log

<!-- Append one line per completed task: - <id> ✅ <YYYY-MM-DD>: <summary> -->

- 4.1 ✅ 2026-07-16: offset primitives with clamping (page floor, limit floor/cap, per-call defaults) and computed-meta page-result builder; 100% coverage.
- 4.2 ✅ 2026-07-16: opaque base64url cursor codec; decode rejects non-base64url, non-JSON, wrong-shape, and disallowed-value input with a detail-free BYMAX_VALIDATION_FAILED 400; 100% coverage.
- 4.3 ✅ 2026-07-16: cursor query normalization (shared limit clamp, string cursor pass-through) and fetch-one-extra result builder deriving nextCursor from the last returned item; 100% coverage.
