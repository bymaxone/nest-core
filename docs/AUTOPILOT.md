# Autopilot Config — @bymax-one/nest-core

> Per-project parameters for /bymax-workflow:autopilot. Reviewed and
> approved by the operator before the first run. The planning docs own WHAT
> to build; this file owns HOW the chain runs.

## Identity

- **Project root**: /Users/maximiliano/Documents/MyApps/bymax-one/nest-core
- **GitHub repo**: bymaxone/nest-core (visibility: private — must become public before the phase 8 release task)
- **Default branch**: main
- **Product summary**: Zero-dependency NestJS 11 foundation library published as
  `@bymax-one/nest-core`: dynamic module (`forRoot`/`forRootAsync`) providing an
  error-envelope exception filter, a request-timing interceptor with pluggable
  sink, framework-neutral pagination helpers (`./pagination` subpath), health
  endpoints with a pluggable indicator contract (`./health` subpath), and an
  optional Prometheus metrics endpoint behind a lazily loaded `prom-client`
  optional peer. Defining constraint: `"dependencies": {}` stays empty, explicit
  `@Inject(Symbol)` DI everywhere, 100% Jest coverage from phase 0, TypeScript
  strict with zero suppression comments.
- **Roadmap file**: docs/development_plan.md
- **Tasks index**: docs/tasks/README.md
- **Phases**: 9 phases / 47 tasks (phase files docs/tasks/phase-NN-*.md, P0–P8)

## External preconditions

| Applies to                                   | Check (exit 0 = OK)                                                                     | On failure                                                                                                                                                                                                                                                                                                            |
| -------------------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| launch                                       | `command -v gh && gh auth status`                                                       | STOP — operator runs `gh auth login`                                                                                                                                                                                                                                                                                  |
| launch                                       | `node -e "process.exit(parseInt(process.versions.node, 10) >= 24 ? 0 : 1)"`             | STOP — package requires Node >= 24 (engines)                                                                                                                                                                                                                                                                          |
| launch                                       | `command -v pnpm`                                                                       | STOP — pnpm 11.x is the package manager                                                                                                                                                                                                                                                                               |
| phase 8 release task (8.x live release only) | `test "$(gh repo view bymaxone/nest-core --json visibility -q .visibility)" = "PUBLIC"` | Complete the phase's local tasks (Stryker hardening, budgets, dry run) and its PR normally; if the repo is still private when only the live tag/publish remains, mark P8 🟡 Partial "blocked on repository visibility (provenance requires public)" in both dashboards, notify, STOP. Never flip visibility yourself. |

No Docker, Testcontainers, or external services are required by any gate: the
e2e suite boots an in-process Nest fixture app via supertest.

## Model policy

| Phase | Model   | Rationale                                                                                                                               |
| ----- | ------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 0     | sonnet  | mechanical scaffold on a fully specified checklist (configs, workflows, community files)                                                |
| 1     | inherit | architectural foundation: ConfigurableModuleBuilder, conditional registration, token set — every later phase builds on these decisions  |
| 2     | inherit | security-sensitive: error-disclosure rules (`exposeInternals`), production-safe collapse of unknown errors, versioned public contract   |
| 3     | sonnet  | small, well-specified interceptor on wiring established in P1                                                                           |
| 4     | inherit | security-sensitive: opaque cursor codec parses untrusted base64url input; malformed-input rejection and no-sensitive-data invariant     |
| 5     | sonnet  | mechanical controller + aggregation service on established wiring with a pinned response contract                                       |
| 6     | inherit | first contact with `prom-client` as a lazily loaded optional peer — invented APIs and accidental top-level imports are the failure mode |
| 7     | sonnet  | e2e fixture + README on an established, fully specified surface                                                                         |
| 8     | inherit | final hardening/audit phase: mutation-survivor analysis, budget calibration, first public release                                       |

Fix sub-agents always escalate to inherit when a phase stalls on review/CI
findings.

**Heavy phases** (silent-death watch widened to ~120 min): 7 (e2e suites),
8 (Stryker runs take 10–20 minutes and must never run in parallel with other
suites).

## Gates

| Gate (local command)                                                                         | Active from                                 |
| -------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `pnpm lint && pnpm typecheck && pnpm build`                                                  | phase 0                                     |
| `pnpm test:cov` (Jest, 100% line/branch/function/statement in both configs)                  | phase 0                                     |
| `node scripts/check-size.mjs` (after `pnpm build`; provisional budgets until P8 calibration) | phase 0                                     |
| `node scripts/dogfood-smoke-test.mjs` (all three subpaths, ESM + CJS, packed tarball)        | phase 0                                     |
| `pnpm test:e2e` (in-process fixture app, bounded workers, one suite at a time)               | phase 7                                     |
| Stryker mutation score >= 95 (`break: 95`)                                                   | phase 8 only — pre-release gate, not per-PR |

CI (`ci.yml`, created in P0) runs lint, typecheck, build, tests, and size
sequentially on every PR from the first PR onward.

**Expected-skip CI checks**: `codeql` and `scorecard` report skipped/neutral
while the repository is private — they count as pass until visibility flips.
`release.yml` stays inert until a `v*` tag exists.

## Invariant greps

Each command must print nothing. Run phase-wide before every PR.

```bash
# No suppression comments anywhere in source or tests
grep -rnE "@ts-ignore|@ts-expect-error|@ts-nocheck|eslint-disable" src/ test/ 2>/dev/null

# Timeless comments: no plan-stage or task references in committed code
grep -rniE "phase [0-9]|task [0-9]+\.[0-9]" src/ test/ 2>/dev/null

# Banned import sources: node: builtins are the only crypto/id source
grep -rnE "from '(crypto|uuid|nanoid|bcrypt|argon2|crypto-js)'" src/ test/ 2>/dev/null

# prom-client is never imported at top level in src/ (lazy factory only; type-only imports allowed)
grep -rn "from 'prom-client'" src/ 2>/dev/null | grep -v "import type"

# dependencies stays empty
node -e "const d=require('./package.json').dependencies; if (d && Object.keys(d).length) { console.log(JSON.stringify(d)); }"

# No placeholder files
find . -path ./node_modules -prune -o \( -name '.gitkeep' -o -name '.keep' \) -print

# No em dashes in source, tests, or the README
grep -rn "—" src/ test/ README.md 2>/dev/null
```

## Security invariants & review focus

Auditable statements for /security-review and /bymax-quality:code-review on
every PR:

- **No internal disclosure in production errors.** With `exposeInternals`
  false (the default), no stack trace, original error message, or internal
  detail appears in any 5xx response; unknown errors collapse to the fixed
  message "Internal server error" with `code: BYMAX_INTERNAL_ERROR`.
- **Cursors are opaque ordering keys, never secrets.** The base64url codec
  parses untrusted input: malformed or tampered cursors reject with
  `BYMAX_VALIDATION_FAILED` and never echo raw decode errors; cursor payloads
  are typed to `Record<string, string | number>` ordering keys only.
- **Supply chain: `dependencies` is empty.** Any runtime dependency addition
  is a contract violation. `prom-client` is an optional peer loaded lazily
  inside the registry factory; metrics disabled means zero import (test-verified).
- **Sinks and indicators are untrusted plugins.** A timing sink that throws is
  swallowed without affecting the response; a health indicator that throws or
  times out becomes a `down` entry without hiding other checks. Indicator
  diagnostic detail must not surface secrets (connection strings, credentials).
- **Bounded label cardinality.** Metrics labels are `method`, `route`
  (template, never raw URL), and `status_code` only.
- **No suppression, no threshold weakening.** `@ts-ignore`, `eslint-disable`,
  lowered coverage/mutation thresholds, and `// Stryker disable` without a
  written equivalence justification are all merge blockers.

Per-phase focus where the model policy marks the phase sensitive:

- **P2**: exact envelope JSON shape pinned by contract tests; the
  `exposeInternals` switch and the 4xx/5xx code-derivation table.
- **P4**: codec round-trip and malformed-input properties; the
  no-sensitive-data cursor invariant guarded by payload typing and a test.
- **P6**: lazy-load boundary (no top-level `prom-client` import), fail-fast
  boot error naming the missing peer, label discipline on the two HTTP metrics.
- **P8**: mutation hardening strengthens tests, never weakens code; budget
  recalibration is deliberate and explained; publish tarball contains only
  `dist`, `LICENSE`, `README.md`, `CHANGELOG.md`, `package.json`.

## Review bot

- **Reviewer**: `copilot-pull-request-reviewer[bot]` (request with
  `gh pr edit <PR#> --add-reviewer copilot-pull-request-reviewer[bot]`) —
  mandated by the tasks README: every phase PR gets a Copilot review and every
  finding is addressed, down to nit severity.
- **Review-bot timeout**: 15 minutes — a request pending this long with no
  review submitted is treated as bot-unresponsive: the request is removed, a
  factual PR comment records it, and the gate proceeds CI-only (the
  implementer's zero-findings review floor already ran before the PR).

## Merge policy

- **Method**: squash (delete branch on merge — always)
- **Grace window**: 5 minutes since last push
- **Review-bot timeout**: 15 minutes (see Review bot above)
- **Stall limit**: 3 full fix cycles on the same phase → 🟡/⛔ + notify + STOP

## Custom conventions

- **One PR per phase, strictly sequential execution.** The plan's
  parallelization notes describe code independence only; the chain never runs
  two implementers at once, and test suites always run sequentially with
  bounded workers (`maxWorkers: '50%'` pinned in the Jest configs).
- **Branches**: `feat/phase-NN-<slug>` created with `git switch -c` (never
  `git checkout -b`).
- **Commits**: Conventional Commits, `<type>(core): <subject> (<N.M>)` — the
  task id belongs in commit subjects only, never in committed code or docs-as-config.
  No `Co-Authored-By`, no "Generated with", no AI attribution anywhere (commits,
  PR titles, PR bodies, comments).
- **Dashboard self-update protocol**: task status, phase file task index +
  completion log, then the plan Progress Dashboard (canonical), then the tasks
  README mirror — in that order, committed on the phase branch.
- **Token economy for implementers**: read only the task's REQUIRED READING
  sections (the task files cite exact spec sections); never load the whole
  spec, plan, or a sibling library.
- **Every `it()` carries a block comment** stating the scenario and the rule
  it protects.
- **No `.gitkeep`/placeholder files; no em dashes** in code, comments, or
  documentation.
