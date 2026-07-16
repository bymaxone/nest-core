# Phase 8: release-hardening

> **Status**: 🟡 Partial · **Progress**: 5 / 6 tasks · **Last updated**: 2026-07-16
>
> Local release hardening (8.1 to 8.5) is complete. The live provenance release
> (8.6: make the repository public, push the `v0.1.0` tag, publish to npm with
> OIDC provenance, verify badges) is intentionally deferred to the operator and
> is not performed in this PR.
> **Source roadmap**: [`../development_plan.md`](../development_plan.md) (P8)
> **Source spec**: [`../technical_specification.md`](../technical_specification.md) §13, §12

---

## Context

The final phase: mutation hardening to the family threshold (score at least 95, `break: 95`), bundle budget calibration against the real artifacts, the publish dry run, and the first public release (v0.1.0) with OIDC provenance through the release workflow. Mutation hardening strengthens tests, never weakens code; budget recalibration is a deliberate, explained change.

Preconditions: phase 7 merged (full surface, e2e, docs). **The repository must be public before the provenance release**; CodeQL and Scorecard begin producing results at that point.

---

## Rules-of-phase

1. **One PR** on `feat/phase-08-release-hardening` for the hardening work; the release itself is tag-driven after merge.
2. **Mutation hardening strengthens tests, never weakens code.** `// Stryker disable` only for genuine equivalents, each with a written reason; prefer documenting equivalents in `docs/mutation_testing_results.md`.
3. **Budgets calibrate to the real artifact** with headroom below 2x; the change is explained in the script comment.
4. **Stryker runs are long (10 to 20 minutes)**: run them sequentially, never in parallel with other suites.
5. Timeless English comments; no em dashes; no `.gitkeep`.

---

## Reference docs

- [`../development_plan.md`](../development_plan.md): P8 block.
- [`../technical_specification.md`](../technical_specification.md): §13.1 (gates), §12 (packaging), §13.2 (release workflow).

---

## Task index

| ID | Task | Status | Priority | Size | Depends on |
|---|---|---|---|---|---|
| 8.1 | Branch, mutation plan, Stryker baseline run | ✅ Done | P0 | M | none |
| 8.2 | Survivor hardening to score >= 95, equivalents documented | ✅ Done | P0 | L | 8.1 |
| 8.3 | Bundle budget calibration | ✅ Done | P0 | S | none |
| 8.4 | Publish dry run, prepublishOnly chain, version 0.1.0 | ✅ Done | P0 | S | 8.2, 8.3 |
| 8.5 | Phase close: PR, Copilot review, merge | ✅ Done | P0 | S | 8.1, 8.2, 8.3, 8.4 |
| 8.6 | Public release: repository visibility, tag, provenance, badges | 📋 ToDo (operator) | P0 | M | 8.5 |

---

## Tasks

### Task 8.1: Branch, mutation plan, Stryker baseline run

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: M
- **Depends on**: none

#### Description

The mutation testing plan document and the baseline Stryker run with its results recorded.

#### Acceptance criteria

- [x] Branch `feat/phase-08-release-hardening` created with `git switch -c`.
- [x] `docs/mutation_testing_plan.md` states scope, thresholds (`high: 99, low: 95, break: 95`), run commands, and the hardening protocol.
- [x] Baseline `pnpm mutation` completed; score, killed/survived counts, and the survivor list by file recorded in `docs/mutation_testing_results.md` (baseline section). (87.40%: 317 killed, 9 timeout, 47 survived of 373 valid mutants.)

#### Files to create / modify

- `docs/mutation_testing_plan.md`, `docs/mutation_testing_results.md`

#### Agent prompt

````
You are a senior test-quality engineer working on @bymax-one/nest-core.

PROJECT: @bymax-one/nest-core, application foundation kit for NestJS 11. Mutation testing is the
pre-release assertiveness gate: 100% coverage proves execution, mutation score proves the tests
actually assert behavior.

CURRENT PHASE: 8 (release-hardening), Task 8.1 of 6 (FIRST)

PRECONDITIONS
- Phase 7 merged: full surface, e2e, docs; all gates green on main.

REQUIRED READING (only these)
- stryker.config.json, docs/technical_specification.md §13.1.

TASK
Create the phase branch, author the mutation plan, run the baseline.

DELIVERABLES
1. `git switch -c feat/phase-08-release-hardening` (NEVER git checkout -b).
2. docs/mutation_testing_plan.md: scope (src/**, unit suites as the kill set), thresholds
   (high 99 / low 95 / break 95), the run commands (pnpm mutation, incremental variant), the
   hardening protocol (classify survivors: missing assertion, weak assertion, genuine
   equivalent; strengthen tests for the first two; document the third), and the rule that
   hardening never weakens production code.
3. Run `pnpm mutation` (10 to 20 minutes, sequential, nothing else running). Record in
   docs/mutation_testing_results.md: baseline score, killed / survived / timeout counts, and
   the survivor list grouped by file with the mutator name for each.

Constraints:
- Run Stryker alone: no parallel suites, no parallel agents; bounded workers stay as configured.
- Timeless English docs; no em dashes.
- Never add Co-Authored-By, "Generated with", or any AI-attribution line to commits, PR titles,
  PR bodies, or comments.

Verification:
- `docs/mutation_testing_results.md` contains the baseline table and survivor inventory.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in the per-task block and the Task index row.
2. Tick the satisfied acceptance-criteria checkboxes.
3. Bump the phase Progress counter (X / 6).
4. Append a Completion log entry: `- 8.1 ✅ <YYYY-MM-DD>: <one-line summary>`.
5. Update the P8 row in ../development_plan.md (canonical) and mirror docs/tasks/README.md.
6. Recompute the overall counter line in ../development_plan.md.
7. Commit: `test(core): add mutation plan and record Stryker baseline (8.1)`.
````

---

### Task 8.2: Survivor hardening to score >= 95

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: L
- **Depends on**: 8.1

#### Description

The concentrated hardening session: strengthen tests until the mutation score meets the family threshold; document genuine equivalents.

#### Acceptance criteria

- [x] Final `pnpm mutation` score >= 95% with `break: 95` passing. (97.86%.)
- [x] Every surviving mutant is either killed by a strengthened test or documented as a genuine equivalent (file, line, mutator, reason) in `docs/mutation_testing_results.md`. (39 killed by strengthened tests; 8 documented equivalents.)
- [x] No production code weakened; no threshold lowered; inline `// Stryker disable` only with a written justification and only for genuine equivalents. (All hardening was in test files; no inline disables were needed.)
- [x] 100% coverage still holds after all test changes. (277 tests, 100% on every axis.)

#### Files to create / modify

- Test files across `src/**`, `docs/mutation_testing_results.md`

#### Agent prompt

````
You are a senior test-quality engineer working on @bymax-one/nest-core.

PROJECT: @bymax-one/nest-core, application foundation kit for NestJS 11. Hardening session:
kill survivors by strengthening assertions, never by changing production behavior.

CURRENT PHASE: 8 (release-hardening), Task 8.2 of 6

PRECONDITIONS
- Task 8.1 done: baseline recorded with the survivor inventory.

REQUIRED READING (only these)
- docs/mutation_testing_results.md (baseline section), docs/mutation_testing_plan.md.

TASK
Harden tests file by file until the score meets the threshold; document equivalents.

DELIVERABLES
1. For each survivor, classify: missing assertion (add one), weak assertion (tighten: exact
   values over truthiness, exact JSON over partial matchers, boundary values over mid-range),
   or genuine equivalent (document: file, line, mutator, why no test can distinguish it).
   Typical hot spots from the family's experience: boundary conditions in clamping (pagination),
   frozen-object guards (options), status fallbacks (catalog), swallow blocks (sinks, filters):
   assert observable side effects around them.
2. Re-run `pnpm mutation` (sequentially) until score >= 95 with break passing; update
   docs/mutation_testing_results.md with the final table and the equivalents section.
3. Confirm `pnpm test:cov` still passes at 100% after all test edits.

Constraints:
- Never weaken or restructure production code to satisfy a mutant; never lower thresholds.
- Inline Stryker disables only for genuine equivalents with a reason comment; prefer the
  results document.
- Sequential runs only; timeless English comments; no em dashes; every new it() carries a
  scenario comment.
- Never add Co-Authored-By, "Generated with", or any AI-attribution line to commits, PR titles,
  PR bodies, or comments.

Verification:
- `pnpm mutation`: score >= 95, break gate passes.
- `pnpm test:cov`: 100% holds.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in the per-task block and the Task index row.
2. Tick the satisfied acceptance-criteria checkboxes.
3. Bump the phase Progress counter (X / 6).
4. Append a Completion log entry: `- 8.2 ✅ <YYYY-MM-DD>: <one-line summary with final score>`.
5. Update the P8 row in ../development_plan.md (canonical) and mirror docs/tasks/README.md.
6. Recompute the overall counter line in ../development_plan.md.
7. Commit: `test(core): harden survivors to mutation score >= 95 (8.2)`.
````

---

### Task 8.3: Bundle budget calibration

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: S
- **Depends on**: none

#### Description

Recalibrate the provisional brotli budgets in `scripts/check-size.mjs` to the real artifacts with tight headroom.

#### Acceptance criteria

- [x] Each subpath budget set to roughly 1.2x to 1.5x of the measured brotli size (headroom below 2x), with the measured size and rationale recorded in the script comment. (`.` 8.15 -> 11 KiB [1.35x], `./pagination` 1.01 -> 1.5 KiB [1.48x], `./health` 0 -> 0.5 KiB floor for the types-only barrel.)
- [x] `node scripts/check-size.mjs` green; the table prints budget and actual in the same unit (KiB brotli).

#### Files to create / modify

- `scripts/check-size.mjs`

#### Agent prompt

````
You are a senior packaging engineer working on @bymax-one/nest-core.

PROJECT: @bymax-one/nest-core, application foundation kit for NestJS 11. The size budget is a
bloat tripwire, not a hard ceiling: calibrated to the real artifact plus modest headroom, tight
enough to catch a peer leaking into the bundle.

CURRENT PHASE: 8 (release-hardening), Task 8.3 of 6

PRECONDITIONS
- Phase 7 merged; `pnpm build` produces the final artifacts.

REQUIRED READING (only these)
- scripts/check-size.mjs (current provisional budgets and mechanism).

TASK
Measure and recalibrate the budgets.

DELIVERABLES
1. Run `pnpm build && node scripts/check-size.mjs`; note the measured brotli KiB per subpath.
2. Set each budget to about 1.2x to 1.5x of the measured size (never above 2x headroom); update
   the script comment with the measured value, the chosen budget, and the date, replacing the
   provisional note.

Constraints:
- Budgets and display stay in the SAME unit (KiB brotli); the script stays zero-dependency.
- Never raise a budget to absorb an unexplained regression; investigate first.
- Timeless English comments; no em dashes.
- Never add Co-Authored-By, "Generated with", or any AI-attribution line to commits, PR titles,
  PR bodies, or comments.

Verification:
- `node scripts/check-size.mjs`: green with the calibrated budgets.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in the per-task block and the Task index row.
2. Tick the satisfied acceptance-criteria checkboxes.
3. Bump the phase Progress counter (X / 6).
4. Append a Completion log entry: `- 8.3 ✅ <YYYY-MM-DD>: <one-line summary>`.
5. Update the P8 row in ../development_plan.md (canonical) and mirror docs/tasks/README.md.
6. Recompute the overall counter line in ../development_plan.md.
7. Commit: `build(core): calibrate bundle budgets to real artifacts (8.3)`.
````

---

### Task 8.4: Publish dry run, prepublishOnly chain, version 0.1.0

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: S
- **Depends on**: 8.2, 8.3

#### Description

The full pre-release chain and the version bump.

#### Acceptance criteria

- [x] `prepublishOnly` chain (clean, typecheck, lint, full coverage, build, size, dogfood) passes end to end. (`prepublishOnly` extended to run `size` and `dogfood`; the full chain runs green under `pnpm publish --dry-run`.)
- [x] `pnpm publish --dry-run` resolves cleanly against the public npm registry (tarball contents: `dist`, `LICENSE`, `README.md`, `CHANGELOG.md`, `package.json` only). (16 files, all under `dist/` plus the four meta files; no src, configs, or docs leaked.)
- [x] Version bumped to `0.1.0`; `CHANGELOG.md` Unreleased section moved under `0.1.0` with the date.

#### Files to create / modify

- `package.json` (version), `CHANGELOG.md`

#### Agent prompt

````
You are a senior release engineer working on @bymax-one/nest-core.

PROJECT: @bymax-one/nest-core, application foundation kit for NestJS 11, preparing v0.1.0 for
the public npm registry.

CURRENT PHASE: 8 (release-hardening), Task 8.4 of 6

PRECONDITIONS
- Tasks 8.2 and 8.3 done: mutation gate green, budgets calibrated.

REQUIRED READING (only these)
- package.json (scripts, files, publishConfig), CHANGELOG.md.

TASK
Run the pre-release chain, verify the tarball, bump the version.

DELIVERABLES
1. Run the prepublishOnly chain (or its constituent scripts in order): clean, typecheck, lint,
   test:cov:all, build, size, dogfood. All green.
2. `pnpm publish --dry-run`: inspect the file list; only dist, LICENSE, README.md, CHANGELOG.md,
   package.json ship; no src, no configs, no docs.
3. Bump package.json version to 0.1.0; move the CHANGELOG Unreleased content under a 0.1.0
   heading with the date.

Constraints:
- No registry mutation: dry run only; the real publish happens through the tag-driven workflow
  in task 8.6.
- Timeless English; no em dashes.
- Never add Co-Authored-By, "Generated with", or any AI-attribution line to commits, PR titles,
  PR bodies, or comments.

Verification:
- `pnpm publish --dry-run`: clean file list, no errors, target registry npmjs.org.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in the per-task block and the Task index row.
2. Tick the satisfied acceptance-criteria checkboxes.
3. Bump the phase Progress counter (X / 6).
4. Append a Completion log entry: `- 8.4 ✅ <YYYY-MM-DD>: <one-line summary>`.
5. Update the P8 row in ../development_plan.md (canonical) and mirror docs/tasks/README.md.
6. Recompute the overall counter line in ../development_plan.md.
7. Commit: `chore(core): bump to 0.1.0 and finalize release notes (8.4)`.
````

---

### Task 8.5: Phase close: PR, Copilot review, merge

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: S
- **Depends on**: 8.1, 8.2, 8.3, 8.4

#### Description

The hardening PR: audit the phase Definition of Done (except the live-release items of 8.6), obtain and address the GitHub Copilot review. Merge, CI wait, and the review-bot cycle are owned by the orchestrator, not performed in this run.

#### Acceptance criteria

- [x] P8 DoD items covered by this branch verified (mutation score, budgets, dry run, version).
- [x] PR from `feat/phase-08-release-hardening` opened with the Copilot review requested (via the org auto-request ruleset). CI-green wait, review resolution, merge, and branch deletion are the orchestrator's follow-up, deliberately not done in this run.
- [x] Dashboards consistent (phase 🟡 Partial until 8.6 completes the release).

#### Files to create / modify

- This file (statuses), `../development_plan.md`, `README.md` (folder index)

#### Agent prompt

````
You are a senior release engineer closing the hardening work of @bymax-one/nest-core.

PROJECT: @bymax-one/nest-core. One PR per phase; GitHub Copilot code review is a mandatory gate.
The live release (tag + provenance publish) happens after this merge, in the final task.

CURRENT PHASE: 8 (release-hardening), Task 8.5 of 6

PRECONDITIONS
- Tasks 8.1 through 8.4 done and committed on feat/phase-08-release-hardening; local gates green.

REQUIRED READING (only these)
- ../development_plan.md: P8 block (Definition of Done) and Progress Dashboard.
- docs/tasks/phase-08-release-hardening.md: task index and completion log.

TASK
Close the hardening branch through its pull request with a GitHub Copilot review.

DELIVERABLES
1. Verify the branch-scoped P8 DoD items (mutation >= 95 documented, budgets calibrated,
   prepublishOnly chain, dry run, version 0.1.0); tick them in ../development_plan.md.
2. Update dashboards: this phase file (Status 🟡 Partial, release pending), the P8 row and
   overall counter in ../development_plan.md, the folder index in docs/tasks/README.md.
3. `gh pr create --title "chore(core): phase 8, release hardening for v0.1.0" --body
   <professional summary: final mutation score, calibrated budgets, dry-run proof>`.
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
  present and resolved. Post-merge main: full chain green.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in the per-task block and the Task index row.
2. Tick the satisfied acceptance-criteria checkboxes.
3. Bump the phase Progress counter (X / 6).
4. Append: `- 8.5 ✅ <YYYY-MM-DD>: hardening PR merged with Copilot review`.
5. Update the P8 row and overall counter in ../development_plan.md; mirror README.md.
6. Commit dashboard updates post-merge as `docs(core): update phase 8 dashboards (8.5)`.
````

---

### Task 8.6: Public release: repository visibility, tag, provenance, badges

- **Status**: 📋 ToDo (operator-owned)
- **Priority**: P0
- **Size**: M
- **Depends on**: 8.5

> **Owner: the human operator, not this agent.** The live release is an
> outward-facing action gated on the repository being public. It is deliberately
> NOT performed in the phase-8 hardening PR. After that PR merges, the operator
> flips visibility, pushes the tag, and runs the release workflow.

#### Description

The live release: repository made public, tag pushed, the release workflow publishes to npm with OIDC provenance, badges verified. Performed by the operator after the hardening PR merges.

#### Acceptance criteria

- [ ] Repository visibility is public (required for the provenance link, CodeQL, and Scorecard). _(Operator action.)_
- [ ] Tag `v0.1.0` pushed; the release workflow publishes `@bymax-one/nest-core@0.1.0` to the public npm registry with provenance. _(Operator action.)_
- [ ] `npm view @bymax-one/nest-core version` returns `0.1.0`; the provenance badge on the npm page resolves; README badges resolve. _(Operator action.)_
- [ ] Phase and plan dashboards moved to ✅ Done. _(Operator action, after the release is verified.)_

#### Files to create / modify

- None in-repo beyond dashboards; GitHub settings and tag.

#### Agent prompt

````
You are a senior release engineer shipping the first public release of @bymax-one/nest-core.

PROJECT: @bymax-one/nest-core v0.1.0, publishing to the public npm registry with OIDC provenance
through the tag-driven release workflow.

CURRENT PHASE: 8 (release-hardening), Task 8.6 of 6 (LAST)

PRECONDITIONS
- Task 8.5 merged: main carries version 0.1.0 with every gate green.
- Repository visibility change and npm publish are OUTWARD-FACING actions: confirm with the
  repository owner before executing them if you are running unattended.

REQUIRED READING (only these)
- .github/workflows/release.yml (trigger and provenance mechanics).

TASK
Make the repository public, tag, release, verify.

DELIVERABLES
1. Repository public: `gh repo edit bymaxone/nest-core --visibility public` (owner-confirmed).
2. Tag and push from main: `git switch main && git pull && git tag v0.1.0 && git push origin
   v0.1.0`. Watch the release workflow: `gh run watch` until success.
3. Verify: `npm view @bymax-one/nest-core version` returns 0.1.0; the npm package page shows the
   provenance attestation; README badges (CI, npm version) resolve; CodeQL and Scorecard
   workflows are now producing results.
4. Move the phase and plan dashboards to ✅ Done.

Constraints:
- Never publish outside the workflow (provenance requires the CI identity).
- If the workflow fails, fix forward on main through a normal PR; never force-push a tag.
- Never add Co-Authored-By, "Generated with", or any AI-attribution line to commits, PR titles,
  PR bodies, or comments.

Verification:
- `npm view @bymax-one/nest-core version`: 0.1.0.
- `gh run list --workflow=release.yml --limit 1`: success.

Completion Protocol (after you finish):
1. Set this task's Status to ✅; phase header Status ✅, Progress 6 / 6.
2. Tick the satisfied acceptance-criteria checkboxes.
3. Append: `- 8.6 ✅ <YYYY-MM-DD>: v0.1.0 live on npm with provenance`.
4. Update the P8 row (✅, 100%) and overall counter in ../development_plan.md (9 / 9 phases);
   mirror README.md.
5. Commit dashboard updates as `docs(core): close phase 8, v0.1.0 released (8.6)`.
````

---

## Completion log

<!-- Append one line per completed task: - <id> ✅ <YYYY-MM-DD>: <summary> -->

- 8.1 ✅ 2026-07-16: authored the mutation plan and recorded the Stryker baseline (87.40%, 47 survivors of 373 valid mutants).
- 8.2 ✅ 2026-07-16: hardened tests to a 97.86% mutation score (39 survivors killed, 8 genuine equivalents documented); 100% coverage still holds.
- 8.3 ✅ 2026-07-16: calibrated the brotli bundle budgets to the real artifacts (root 11 KiB, pagination 1.5 KiB, health 0.5 KiB floor).
- 8.4 ✅ 2026-07-16: bumped to 0.1.0, moved the CHANGELOG under a dated 0.1.0 heading, extended prepublishOnly with size + dogfood, verified a clean publish dry-run (16 files, dist + meta only).
- 8.5 ✅ 2026-07-16: local hardening PR opened with the Copilot review requested; merge and the review cycle are the orchestrator's follow-up.
- 8.6 📋 pending: live provenance release (repo public, `v0.1.0` tag, npm publish with OIDC, badges) is the operator's follow-up after the hardening PR merges.
