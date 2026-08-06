# Mutation Testing Results: @bymax-one/nest-core

> **Plan:** [`mutation_testing_plan.md`](./mutation_testing_plan.md)
> **Tool:** Stryker Mutator v9 (Jest runner, TypeScript checker)
> **Thresholds:** `high: 99`, `low: 95`, `break: 95`

Mutant totals below separate the 373 valid mutants (the scored denominator) from
the 293 that the TypeScript checker rejects as non-compiling before they ever run
(`CompileError`); those are neither killable nor counted. The score is
`(killed + timeout) / (killed + timeout + survived)`.

---

## Baseline (before hardening)

| Metric                    | Value  |
| ------------------------- | ------ |
| Mutation score            | 87.40% |
| Valid mutants (scored)    | 373    |
| Killed                    | 317    |
| Timed out (counts killed) | 9      |
| Survived                  | 47     |
| No coverage               | 0      |
| Compile-error (excluded)  | 293    |
| Total generated           | 666    |

The 47 survivors clustered in four kinds of gap: assertions that compared a value
against the same imported constant the mutant changed (the error-code catalog);
`.toThrow()` checks that never asserted the message text (the async guards, the
cursor and registry error messages); optional-field spreads whose absence was
only checked after a JSON round-trip that hides an `undefined` key; and a handful
of clamping and pattern boundaries never exercised at the exact boundary value.

---

## Final (after hardening)

| Metric                    | Value  |
| ------------------------- | ------ |
| Mutation score            | 97.86% |
| Valid mutants (scored)    | 373    |
| Killed                    | 356    |
| Timed out (counts killed) | 9      |
| Survived (all equivalent) | 8      |
| No coverage               | 0      |
| Compile-error (excluded)  | 293    |
| Total generated           | 666    |

The `break: 95` gate passes (97.86% >= 95). Every one of the 39 killable
survivors was killed by a strengthened test (no production code was changed);
the 8 that remain are genuine equivalent mutants, documented below.

---

## After the optional-integration features

Covers the four features added together: OpenAPI documents, health-indicator
discovery, metrics contribution, and trace correlation.

| Metric                    | Value  |
| ------------------------- | ------ |
| Mutation score            | 98.76% |
| Valid mutants (scored)    | 723    |
| Killed                    | 705    |
| Timed out (counts killed) | 9      |
| Survived (all equivalent) | 9      |
| No coverage               | 0      |
| Compile-error (excluded)  | 450    |
| Total generated           | 1173   |

Every file the four features added scores 100%: the `openapi` and `metrics`
subpaths, the shared provider scan, the discovery and contribution services and
their markers, `trace-context.ts`, `runtime.environment.ts`, `optional-peer.ts`,
and the extended `core.options.ts`, `core.module.ts`, `defaults.providers.ts`,
`timing.interceptor.ts` and `error-envelope.ts`.

Eight of the nine survivors are the equivalent mutants already documented below.
The ninth is new and belongs to the same equivalence class as one of them: the
trace-id spread in the exception filter, which the envelope builder re-guards.

Three lessons from hardening these features are worth carrying forward:

- **A message assembled by a helper loses its literal coverage.** Extracting the
  optional-peer guidance into `missingPeerMessage(option, peer)` left the
  `'metrics.enabled'` argument unasserted, because the existing test matched only
  the package name and the install command. Both loader tests now assert the
  whole message, so the option that produced the failure stays named.
- **A static data catalogue is not exempt from mutation testing — it needs
  invariants, not a golden copy.** `openapi.schemas.ts` is 210 lines of OpenAPI
  objects, and its first run scored 22.54% with 110 survivors. Copying the
  catalogue into the spec as an expected literal would have killed them all and
  asserted nothing: the test would restate the data instead of describing a rule.
  It is covered instead by rules over the whole tree — every `$ref` resolves,
  every `required` field is declared in `properties`, every property is typed,
  every `oneOf` lists typed variants, no published string is blank — which took
  the file to 100% while staying readable as a specification of what a valid
  catalogue is. The two health status enums are additionally pinned by value,
  because they mirror union types the endpoints actually return and no structural
  rule can catch a vocabulary that drifts from the runtime.
- **A fixture that makes two identifiers equal cannot tell them apart.** The
  discovery scan names a failing provider by its class, falling back to its token
  when the class is anonymous. The first fixture built provider entries with
  `name: metatype.name`, so both branches produced the same string and the choice
  between them was unobservable. Giving the fixture a token that differs from the
  class name is what turned the fallback into a tested rule.

Hardening was entirely in test files. Representative strengthenings:

- **error-codes**: added an explicit literal-value assertion per `BYMAX_*`
  constant, since the mapping table compared `codeForStatus(x)` against the same
  imported constant the mutant emptied.
- **cursor**: added leading/trailing out-of-alphabet cursors (the lenient
  `base64url` decoder strips junk, so only an anchored pattern rejects them);
  asserted the exact encode-guard message; asserted `nextCursor` derives from the
  tail of a page wider than two items.
- **exception filter**: forced `exception.message` to diverge from the response
  message (via `Object.defineProperty`) so the response-message branches are
  provably load-bearing rather than shadowing the fallback.
- **health / metrics / passthrough guards**: asserted every sentence of each
  multi-part configuration-error message so no chunk can silently empty out.
- **health service**: pinned the uncoercible-reason placeholder to `Unknown
error` and added a message exactly at the 300-character truncation bound.
- **core module**: asserted `HealthService` registers only when health is
  enabled, the metrics timing-sink bridge binds and exports only when timing and
  metrics are both on, and both registration paths export their resolved tokens.

---

## Documented equivalent mutants

Each survivor below is a genuine equivalent: no test can distinguish the mutant
from the original because they produce identical observable behavior on every
reachable input. They are left as survivors (not `// Stryker disable`d) and
recorded here; the score clears the gate without suppressing them.

| #   | File                               | Line:Col | Mutator               | Mutation                                                                       | Why it is equivalent                                                                                                                                                                                                                                                                                                              |
| --- | ---------------------------------- | -------- | --------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `src/pagination/offset.ts`         | 87:52    | EqualityOperator      | `totalItems > 0` -> `totalItems >= 0`                                          | Only `totalItems === 0` selects a different branch, and both branches yield `0`: the true branch is `Math.floor(0) === 0`, the false branch is the literal `0`. The result is identical for every input.                                                                                                                          |
| 2   | `src/pagination/cursor.ts`         | 165:47   | EqualityOperator      | `limit > 0` -> `limit >= 0`                                                    | Same shape as above: only `limit === 0` differs, and both branches yield `0` (`Math.floor(0)` vs the literal `0`), so `safeLimit` is unchanged for every input.                                                                                                                                                                   |
| 3   | `src/pagination/cursor.ts`         | 100:11   | BlockStatement        | `catch { throw cursorRejection() }` -> `catch {}`                              | Emptying the catch leaves `parsed` as its initial `undefined`; `isOrderingKeyRecord(undefined)` is then `false`, so the very next guard throws the identical `cursorRejection()`. Same exception, same message, for every non-JSON input.                                                                                         |
| 4   | `src/pagination/cursor.ts`         | 54:46    | ConditionalExpression | `typeof entry === 'number'` -> `true`                                          | Leaves `true && Number.isFinite(entry)`, i.e. `Number.isFinite(entry)`. The strict `Number.isFinite` never coerces, so it already returns `false` for every non-number; the `typeof === 'number'` guard it replaces is redundant, and the predicate is unchanged for every value.                                                 |
| 5   | `src/envelope/error-codes.ts`      | 102:7    | EqualityOperator      | `status >= CLIENT_ERROR_MIN` -> `status > CLIENT_ERROR_MIN`                    | The two differ only at `status === 400`, but 400 is a catalogued row returned by the `Map` lookup before this branch is reached, so the boundary is unreachable and the fallback is identical for every status that gets here.                                                                                                    |
| 6   | `src/envelope/error-codes.ts`      | 102:37   | EqualityOperator      | `status < CLIENT_ERROR_MAX` -> `status <= CLIENT_ERROR_MAX`                    | The two differ only at `status === 500`, but 500 is a catalogued row returned before this branch, so the boundary is unreachable and every reachable status resolves to the same code.                                                                                                                                            |
| 7   | `src/core.module.ts`               | 64:37    | ObjectLiteral         | `setExtras({ isGlobal: true }, ...)` -> `setExtras({}, ...)`                   | The transform computes `global: extras.isGlobal !== false`. With the default removed, an unset `isGlobal` is `undefined`, and `undefined !== false` is still `true`, so the module is global unless explicitly set to `false` either way. `global` is identical for every extras input.                                           |
| 8   | `src/envelope/exception.filter.ts` | 344:11   | ConditionalExpression | `context.correlationId !== undefined ? { correlationId } : {}` -> `true ? ...` | The always-spread form injects `correlationId: undefined` into the builder input, but `buildErrorEnvelope` re-guards `input.correlationId !== undefined` and omits an undefined value, so the emitted envelope is byte-for-byte identical whether or not a correlation id is present.                                             |
| 9   | `src/envelope/exception.filter.ts` | 348:51   | ConditionalExpression | `context.traceId !== undefined ? { traceId } : {}` -> `... && true`            | Identical in kind to #8, and for the same reason: the always-spread form hands the builder `traceId: undefined`, which `buildErrorEnvelope` re-guards and omits. The guard exists at the call site because `exactOptionalPropertyTypes` rejects an explicit `undefined` for an optional field, not because it changes the output. |

---

## Reproduction

```
pnpm mutation
```

Runs the full gate sequentially (about three and a half minutes on the reference
machine). The HTML report is written to `reports/mutation/mutation.html` and the
machine-readable report to `reports/mutation/mutation.json`.

---

## Re-run — 2026-08-06

| Metric             | Value        |
| ------------------ | ------------ |
| **Mutation score** | **98.76 %**  |
| Surviving mutants  | 9            |
| Break threshold    | 95 % -> PASS |

No change to the score. All nine survivors are equivalent, and this pass verified each rather
than assuming it.

The two envelope spreads are the notable ones: `buildErrorEnvelope` applies the same conditional
spreads to its own input, so a key handed over as `undefined` is dropped there regardless — the
filter's guards state intent at the call site, they do not decide the envelope. Assertions were
added that the envelope OMITS those keys rather than carrying them as `undefined`, which
`toHaveProperty` and `JSON.stringify` both fail to distinguish.

The rest: 400 and 500 are catalogued and return before the range check, so neither boundary is
reachable; the two pagination clamps agree with their else branch at zero; the cursor's decode
catch leaves `parsed` undefined, which the shape check rejects identically; and JSON has no
literal for NaN or Infinity, so the finite-number check cannot see one.

Inline directives were added during this pass and then removed, for the same reason as the
sibling config package: equivalents are documented here, not annotated in the source.

Every equivalence claim in this section was checked by running the mutant, not by reading it.
Where a `// Stryker disable next-line` directive was found not to apply — above a `} catch {`, a
`.replace()` inside a method chain, a multi-line `sort(...)` argument, or anywhere inside a
builder chain — it was replaced with the block `disable`/`restore` form, or, where that does not
work either, with a plain comment at the line so the reasoning is visible rather than silently
ineffective.
