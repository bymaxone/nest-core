# Mutation Testing Plan: @bymax-one/nest-core

> **Owner:** test-quality gate for the first public release
> **Tool:** Stryker Mutator (`@stryker-mutator/core` v9) with the Jest runner and the TypeScript checker
> **Config:** [`../stryker.config.json`](../stryker.config.json)

Mutation testing is the pre-release assertiveness gate. One hundred percent line,
branch, function, and statement coverage proves the tests execute every path;
the mutation score proves those tests actually assert behavior. A surviving
mutant is a change to production code that no test could tell apart from the
original: a hole in the assertions, not in the execution.

---

## Scope

- **Mutated surface:** `src/**/*.ts`, excluding spec files, `__tests__`
  directories, barrel `index.ts` files, and `*.d.ts`. This mirrors the `mutate`
  globs in `stryker.config.json`.
- **Kill set:** the unit suites run through the dedicated Stryker Jest config
  (`jest.stryker.config.ts`). The end-to-end suite (`test/e2e`) is not part of
  the kill set: Stryker measures unit assertiveness, and e2e boot time would
  dominate every mutant run.
- **Coverage analysis:** `perTest` with `enableFindRelatedTests`, so each mutant
  is exercised only by the tests that touch its code, keeping runs bounded.

---

## Thresholds

Family-wide thresholds, pinned in `stryker.config.json`:

| Threshold | Value | Meaning                                                   |
| --------- | ----- | --------------------------------------------------------- |
| `high`    | 99    | Score at or above this is reported as healthy (green).    |
| `low`     | 95    | Score below this is reported as warning (red band).       |
| `break`   | 95    | Score below this fails the run with a non-zero exit code. |

The gate for release is a score of at least 95 with the `break` check passing.

---

## Run commands

- **Full run (release gate):** `pnpm mutation` (`stryker run`). Ten to twenty
  minutes. Runs the whole mutated surface.
- **Incremental run (iteration):** `pnpm mutation:incremental`
  (`stryker run --incremental`). Reuses `reports/stryker-incremental.json` to
  re-test only mutants affected by changed files. Used while hardening; the
  release gate is always a full run.
- **Dry run (config sanity):** `pnpm mutation:dry-run`
  (`stryker run --dryRunOnly`). Confirms the runner and checker are wired
  without mutating.

### Memory safety

Stryker forks its own pool of Jest workers (`concurrency: 4`). It must run
**alone**: never alongside another Jest or Vitest suite, and never fanned out
across parallel agents. Concurrent suites multiply the worker count and have
exhausted machine memory in the past. Run the mutation gate sequentially, as the
only test process on the machine.

---

## Hardening protocol

Classify every surviving mutant into one of three buckets and act accordingly.

1. **Missing assertion.** The test executes the mutated line but never checks its
   result. Add an assertion that observes the effect. Example: a side-effecting
   sink whose call was never verified.
2. **Weak assertion.** The test checks the result loosely, so the mutant slips
   through. Tighten it: exact values over truthiness, exact JSON shape over
   partial matchers, boundary values over mid-range inputs. Typical hot spots are
   clamping boundaries (pagination limits), frozen-object guards (options
   normalization), status fallbacks (error-code catalog), and swallowed
   exceptions (timing sink, exception filter): assert the observable side effect
   around them.
3. **Genuine equivalent.** No test can distinguish the mutant from the original
   because the two are behaviorally identical (for example, a mutated statement
   whose result is never observable, or a change that produces the same output on
   every reachable input). Document it in
   [`mutation_testing_results.md`](./mutation_testing_results.md) with the file,
   line, mutator, and the reason no test can kill it. An inline
   `// Stryker disable next-line <mutator>` comment is used only for a genuine
   equivalent, and only with a written justification on the same line.

**Hardening strengthens tests, never production code.** The production behavior
is frozen at this point; a mutant is killed by a better test, never by reshaping
the code to make the mutant impossible, and never by lowering a threshold.

---

## Deliverables

- [`mutation_testing_results.md`](./mutation_testing_results.md): the baseline
  score with killed / survived / timeout counts and the survivor inventory, then
  the final score after hardening and the documented-equivalents section.
