# Phase 0: repository-scaffold

> **Status**: 🔄 In Progress · **Progress**: 3 / 6 tasks · **Last updated**: 2026-07-16
> **Source roadmap**: [`../development_plan.md`](../development_plan.md) (P0)
> **Source spec**: [`../technical_specification.md`](../technical_specification.md) §3, §12, §13

---

## Context

This phase turns an empty repository into a buildable, lintable, testable package skeleton carrying the full repository standard of the `@bymax-one` library family. Every later phase only adds source and tests; nothing structural changes after this phase closes.

The CI workflows are front-loaded here (a user-level requirement for this project): `ci`, `codeql`, `scorecard`, and `release` land in this phase so the pull request that closes phase 0, and every pull request after it, runs the full gate. The `release` workflow stays inert until a `v*.*.*` tag exists. CodeQL and OpenSSF Scorecard produce results once the repository is public.

Expected starting state: the repository contains only `docs/` (specification, development plan, and these task files). The default branch is `main`.

---

## Rules-of-phase

1. **One PR for the whole phase.** All tasks commit to `feat/phase-00-repository-scaffold`; the phase closes through a pull request with CI green and a GitHub Copilot code review addressed.
2. **Copy, then adapt.** Configuration mirrors the sibling `@bymax-one/nest-cache` and `@bymax-one/nest-logger` repositories. Copy the referenced file, adapt names and subpaths, never invent versions from memory.
3. **Three subpaths from day one.** `package.json` `exports` and `tsup.config.ts` declare `.`, `./pagination`, and `./health`, each ESM + CJS + d.ts, even while the barrels are placeholders.
4. **100% coverage threshold active from the first test run.** Both Jest configs enforce it; placeholder sources keep the run green.
5. **Zero direct dependencies.** `"dependencies": {}`; peers per the spec (§12), mirrored in `devDependencies`.
6. **No `.gitkeep`**, no pre-created empty directories, no em dashes anywhere.
7. **Timeless comments**: no phase or task references inside any committed file.

---

## Reference docs

- [`../development_plan.md`](../development_plan.md): P0 block (scope, DoD) and Global Conventions.
- [`../technical_specification.md`](../technical_specification.md): §3.1 (directory tree), §3.2 (subpath exports), §12 (dependencies, engines, injection discipline), §13 (quality gates, repository standard).
- Sibling references (clone from `https://github.com/bymaxone/<name>` if not checked out next to this repo): `nest-cache` (newest scaffold of this standard), `nest-logger` (governance files, dogfood script).

---

## Task index

| ID  | Task                                                            | Status  | Priority | Size | Depends on              |
| --- | --------------------------------------------------------------- | ------- | -------- | ---- | ----------------------- |
| 0.1 | Branch, `package.json`, pnpm install                            | ✅ Done | P0       | S    | none                    |
| 0.2 | Build configs: tsconfig set, tsup, placeholder barrels          | ✅ Done | P0       | S    | 0.1                     |
| 0.3 | Lint, format, local governance (husky, commitlint, lint-staged) | ✅ Done | P0       | S    | 0.1                     |
| 0.4 | Jest configs (100% threshold) and Stryker config                | 📋 ToDo | P0       | S    | 0.2                     |
| 0.5 | CI workflows, guard scripts, community files                    | 📋 ToDo | P0       | L    | 0.2, 0.3, 0.4           |
| 0.6 | Phase close: verification, PR, Copilot review, merge            | 📋 ToDo | P0       | S    | 0.1, 0.2, 0.3, 0.4, 0.5 |

---

## Tasks

### Task 0.1: Branch, `package.json`, pnpm install

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: S
- **Depends on**: none

#### Description

Create the phase branch, author `package.json` under the `@bymax-one` scope with the three-subpath exports map, the peer-dependency set from the spec, canonical scripts, and run `pnpm install`.

#### Acceptance criteria

- [x] Branch `feat/phase-00-repository-scaffold` exists and is checked out (docs committed to `main` first if the repo had no initial commit).
- [x] `package.json` has `"name": "@bymax-one/nest-core"`, `"version": "0.1.0-alpha.0"`, `"dependencies": {}`, engines `node >= 24`, `publishConfig` public.
- [x] `exports` declares exactly `.`, `./pagination`, `./health`, each with `types`/`import`/`require` targets under `dist/`.
- [x] Peers: `@nestjs/common` ^11, `@nestjs/core` ^11, `reflect-metadata` ^0.2, `rxjs` ^7, `prom-client` ^15 with `peerDependenciesMeta` marking only `prom-client` optional.
- [x] `pnpm install` completes with no missing-peer warnings.

#### Files to create / modify

- `package.json`, `pnpm-lock.yaml` (generated), `.gitignore`

#### Agent prompt

```
You are a senior NestJS library release engineer working on @bymax-one/nest-core.

PROJECT: @bymax-one/nest-core, the application foundation kit for NestJS 11 services: stable
error envelope, request timing, pagination primitives, health endpoints, optional Prometheus
metrics. Public npm package, three subpaths (., ./pagination, ./health), zero direct
dependencies, everything is a peer. Mirrors the conventions of the sibling @bymax-one libraries.

CURRENT PHASE: 0 (repository-scaffold), Task 0.1 of 6 (FIRST)

PRECONDITIONS
- The repository contains only docs/ (spec, plan, task files). Default branch: main.
- If main has no commits yet, first commit the docs set to main: `docs(core): add specification,
  development plan, and task files`.

REQUIRED READING (only these)
- docs/technical_specification.md §3.2 (subpath exports) and §12 (dependencies, engines).
- Sibling package.json for the canonical scripts and dev toolchain versions: read
  ../nest-cache/package.json (clone https://github.com/bymaxone/nest-cache next to this repo if
  absent). Copy version ranges from there; do not invent versions from memory.

TASK
Create the phase branch and author package.json, then install.

DELIVERABLES
1. Branch: `git switch -c feat/phase-00-repository-scaffold` (NEVER `git checkout -b`).
2. `package.json`: name @bymax-one/nest-core; version 0.1.0-alpha.0; description; MIT license;
   repository/homepage/bugs pointing to https://github.com/bymaxone/nest-core; sideEffects false;
   files ["dist","LICENSE","README.md","CHANGELOG.md"]; exports map for ., ./pagination, ./health
   (each types/import/require into dist/index.*, dist/pagination/index.*, dist/health/index.*);
   main/types fallback into dist; "dependencies": {}; peerDependencies exactly per the spec §12.1
   with peerDependenciesMeta marking prom-client optional; devDependencies mirroring the peers plus
   the dev toolchain copied from ../nest-cache/package.json (jest, ts-jest, tsup, typescript,
   eslint, prettier, stryker, husky, commitlint, lint-staged, supertest); canonical scripts (build,
   typecheck, lint, lint:fix, test, test:cov, test:e2e, test:cov:all, mutation, size, dogfood,
   clean, prepublishOnly, prepare); packageManager set to the local pnpm (`pnpm --version`, 11.x);
   engines node >=24; publicConfig { "access": "public" }.
3. `.gitignore`: node_modules, dist, coverage, reports, .stryker-tmp.
4. Run `pnpm install`; confirm pnpm-lock.yaml generates cleanly.

Constraints:
- "dependencies": {} stays empty, no exceptions.
- English-only file content; timeless comments; no em dashes anywhere.
- Do NOT create .gitkeep or empty directories.
- Never add Co-Authored-By, "Generated with", or any AI-attribution line to commits, PR titles,
  PR bodies, or comments.

Verification:
- `pnpm install`: completes with no missing-peer warnings.
- `node -e "const p=require('./package.json'); if(Object.keys(p.dependencies||{}).length) throw new Error('deps not empty')"`: no throw.
- `node -e "const p=require('./package.json'); ['.','./pagination','./health'].forEach(s=>{if(!p.exports[s])throw new Error(s)})"`: no throw.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in the per-task block and the Task index row.
2. Tick the satisfied acceptance-criteria checkboxes.
3. Bump the phase Progress counter (X / 6) in the header blockquote.
4. Append a Completion log entry: `- 0.1 ✅ <YYYY-MM-DD>: <one-line summary>`.
5. Update the P0 row in ../development_plan.md (Progress Dashboard, canonical) and mirror it in
   docs/tasks/README.md.
6. Recompute the overall counter line in ../development_plan.md.
7. Commit on the phase branch: `feat(core): scaffold package.json and workspace (0.1)`.
```

---

### Task 0.2: Build configs: tsconfig set, tsup, placeholder barrels

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: S
- **Depends on**: 0.1

#### Description

Create the strict tsconfig set and `tsup.config.ts` with three entries, plus placeholder barrels so typecheck and build run green from this task onward.

#### Acceptance criteria

- [x] `tsconfig.json` (strict, ES2022, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) plus build/jest/e2e variants, adapted from the sibling reference.
- [x] `tsup.config.ts` declares three entries (`src/index.ts`, `src/pagination/index.ts`, `src/health/index.ts`), formats ESM + CJS, `dts: true`, peers externalized (`/^@nestjs\//`, `rxjs`, `reflect-metadata`, `prom-client`), `minify: false`.
- [x] Placeholder barrels exist (`export {}`) and `pnpm typecheck` and `pnpm build` pass; `dist/` shows `.mjs`, `.cjs`, `.d.ts` for the three subpaths.

#### Files to create / modify

- `tsconfig.json`, `tsconfig.build.json`, `tsconfig.jest.json`, `tsconfig.e2e.json`, `tsup.config.ts`
- `src/index.ts`, `src/pagination/index.ts`, `src/health/index.ts` (placeholders)

#### Agent prompt

```
You are a senior NestJS library build engineer working on @bymax-one/nest-core.

PROJECT: @bymax-one/nest-core, application foundation kit for NestJS 11 (error envelope, timing,
pagination, health, optional metrics). Three subpaths (., ./pagination, ./health), ESM + CJS +
d.ts via tsup, zero direct dependencies.

CURRENT PHASE: 0 (repository-scaffold), Task 0.2 of 6

PRECONDITIONS
- Task 0.1 done: package.json exists, pnpm install has run, branch feat/phase-00-repository-scaffold
  is checked out.

REQUIRED READING (only these)
- docs/technical_specification.md §3.1 (directory tree) and §3.2 (subpath exports).
- Reference configs to copy and adapt: ../nest-cache/tsconfig.json (and its variants) and
  ../nest-cache/tsup.config.ts.

TASK
Author the tsconfig set and tsup config for three subpaths; add placeholder barrels.

DELIVERABLES
1. tsconfig.json strict base (target ES2022, module NodeNext or the sibling's proven module
   setting, strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes, declaration handled by
   tsup dts) with paths aliases for @bymax-one/nest-core, /pagination, /health into src barrels.
2. tsconfig.build.json, tsconfig.jest.json, tsconfig.e2e.json variants adapted from the sibling.
3. tsup.config.ts: entries { index: src/index.ts, 'pagination/index': src/pagination/index.ts,
   'health/index': src/health/index.ts }, format ['esm','cjs'], dts true, minify false (the
   ecosystem ships readable bundles), treeshake true, splitting false, target node24,
   external [/^@nestjs\//, 'rxjs', 'reflect-metadata', 'prom-client'].
4. Placeholder barrels src/index.ts, src/pagination/index.ts, src/health/index.ts each containing
   `export {};` with a one-line @fileoverview header describing the subpath's future surface in
   timeless wording.

Constraints:
- TypeScript strict, zero any, no suppression comments.
- English-only, timeless comments (no phase or task references); no em dashes; no .gitkeep.
- Never add Co-Authored-By, "Generated with", or any AI-attribution line to commits, PR titles,
  PR bodies, or comments.

Verification:
- `pnpm typecheck`: passes.
- `pnpm build`: dist/ contains index.{mjs,cjs,d.ts}, pagination/index.*, health/index.*.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in the per-task block and the Task index row.
2. Tick the satisfied acceptance-criteria checkboxes.
3. Bump the phase Progress counter (X / 6) in the header blockquote.
4. Append a Completion log entry: `- 0.2 ✅ <YYYY-MM-DD>: <one-line summary>`.
5. Update the P0 row in ../development_plan.md (canonical) and mirror docs/tasks/README.md.
6. Recompute the overall counter line in ../development_plan.md.
7. Commit on the phase branch: `build(core): add tsconfig set and tsup subpath build (0.2)`.
```

---

### Task 0.3: Lint, format, local governance

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: S
- **Depends on**: 0.1

#### Description

ESLint flat config with the family's restricted-import rules, Prettier, and the local commit governance chain (husky, commitlint, lint-staged, `.gitmessage`).

#### Acceptance criteria

- [x] `eslint.config.mjs` (flat, v9) with `@typescript-eslint` strict rules, import ordering, and `no-restricted-imports` banning bare `crypto`, `bcrypt`, `argon2`, `uuid`, `nanoid`, `crypto-js` (node: builtins only).
- [x] `.prettierrc` and `.prettierignore` (lockfile guarded) match the sibling standard.
- [x] `.husky/pre-commit` runs lint-staged; `.husky/commit-msg` runs commitlint; `commitlint.config.cjs` extends the conventional config; `lint-staged` block in `package.json`.
- [x] A non-conventional commit message is rejected locally (verified once, then amended away).
- [x] `pnpm lint` passes on the placeholder sources.

#### Files to create / modify

- `eslint.config.mjs`, `.prettierrc`, `.prettierignore`, `commitlint.config.cjs`, `.gitmessage`, `.husky/pre-commit`, `.husky/commit-msg`, `package.json` (lint-staged block, prepare script)

#### Agent prompt

```
You are a senior TypeScript tooling engineer working on @bymax-one/nest-core.

PROJECT: @bymax-one/nest-core, application foundation kit for NestJS 11. Public npm package with
the @bymax-one repository standard: flat ESLint, Prettier, husky + commitlint + lint-staged
enforcing Conventional Commits locally.

CURRENT PHASE: 0 (repository-scaffold), Task 0.3 of 6

PRECONDITIONS
- Tasks 0.1 done (package.json, install); branch feat/phase-00-repository-scaffold checked out.

REQUIRED READING (only these)
- Reference files to copy and adapt from the sibling: ../nest-logger/eslint.config.mjs,
  ../nest-logger/commitlint.config.cjs, ../nest-logger/.gitmessage, ../nest-logger/.husky/,
  ../nest-logger/.prettierrc, ../nest-logger/.prettierignore, and the lint-staged block in
  ../nest-logger/package.json.

TASK
Wire lint, format, and local commit governance, adapted to this package's surface.

DELIVERABLES
1. eslint.config.mjs: flat config; @typescript-eslint strict (no-explicit-any error); import
   order; eslint-config-prettier last; no-restricted-imports banning bare crypto, bcrypt, argon2,
   uuid, nanoid, crypto-js with node: builtins as the pointed alternative. Adapt scoped folder
   rules to this package (envelope/, timing/, pagination/, health/, metrics/); drop rules for
   folders this lib does not have.
2. .prettierrc and .prettierignore copied; keep the lockfile guarded from formatting.
3. commitlint.config.cjs extending @commitlint/config-conventional; .gitmessage listing this
   package's scopes (core, envelope, timing, pagination, health, metrics, docs, ci).
4. .husky/pre-commit running lint-staged; .husky/commit-msg running commitlint --edit; prepare
   script "husky" in package.json; lint-staged block (eslint --fix + prettier --write on staged
   TS/JS/MD/JSON).

Constraints:
- English-only, timeless comments; no em dashes; no .gitkeep.
- Never add Co-Authored-By, "Generated with", or any AI-attribution line to commits, PR titles,
  PR bodies, or comments.

Verification:
- `pnpm lint`: passes.
- `git commit --allow-empty -m "bad message"`: rejected by commitlint (then reset the attempt).

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in the per-task block and the Task index row.
2. Tick the satisfied acceptance-criteria checkboxes.
3. Bump the phase Progress counter (X / 6) in the header blockquote.
4. Append a Completion log entry: `- 0.3 ✅ <YYYY-MM-DD>: <one-line summary>`.
5. Update the P0 row in ../development_plan.md (canonical) and mirror docs/tasks/README.md.
6. Recompute the overall counter line in ../development_plan.md.
7. Commit on the phase branch: `chore(core): add lint, format, and commit governance (0.3)`.
```

---

### Task 0.4: Jest configs (100% threshold) and Stryker config

- **Status**: 📋 ToDo
- **Priority**: P0
- **Size**: S
- **Depends on**: 0.2

#### Description

Both Jest configs with the 100% coverage threshold and bounded workers, plus the Stryker configuration that phase 8 will execute.

#### Acceptance criteria

- [ ] `jest.config.ts` (unit) and `jest.coverage.config.ts` (full-coverage run) both enforce `coverageThreshold` at 100% on all four axes and pin `maxWorkers: '50%'`.
- [ ] `jest.e2e.config.ts` present for the later fixture suite (no threshold conflicts, `passWithNoTests` while empty).
- [ ] `stryker.config.json` targets `src/**/*.ts`, jest runner, thresholds `high: 99, low: 95, break: 95`.
- [ ] `pnpm test:cov` passes (placeholder sources only, threshold active).

#### Files to create / modify

- `jest.config.ts`, `jest.coverage.config.ts`, `jest.e2e.config.ts`, `stryker.config.json`

#### Agent prompt

```
You are a senior test-infrastructure engineer working on @bymax-one/nest-core.

PROJECT: @bymax-one/nest-core, application foundation kit for NestJS 11. Quality floor: 100%
line/branch/function/statement coverage enforced in BOTH Jest configs; Stryker mutation testing
as a pre-release gate (break 95).

CURRENT PHASE: 0 (repository-scaffold), Task 0.4 of 6

PRECONDITIONS
- Tasks 0.1 and 0.2 done; placeholder barrels compile and build.

REQUIRED READING (only these)
- Reference configs: ../nest-cache/jest.config.ts, ../nest-cache/jest.coverage.config.ts (or the
  equivalent pair in ../nest-logger), and ../nest-cache/stryker.config.json.
- docs/technical_specification.md §13.1 (test gates).

TASK
Author the three Jest configs and the Stryker config with the family thresholds.

DELIVERABLES
1. jest.config.ts: ts-jest against tsconfig.jest.json; collectCoverageFrom src/**/*.ts excluding
   barrels only if the sibling does so (prefer no exclusions); coverageThreshold global 100/100/
   100/100; maxWorkers '50%'; passWithNoTests true while no spec exists.
2. jest.coverage.config.ts: same threshold (both configs MUST agree at 100%, they drift easily).
3. jest.e2e.config.ts: rootDir test/e2e (directory created later by a real spec), maxWorkers
   '50%', passWithNoTests true.
4. stryker.config.json: jest runner, mutate src/**/*.ts, thresholds { high: 99, low: 95, break: 95 },
   ignoreStatic false as the starting point.

Constraints:
- Both coverage configs at 100%; never a lower per-directory tier.
- English-only, timeless comments; no em dashes; no .gitkeep (test/e2e is NOT pre-created).
- Never add Co-Authored-By, "Generated with", or any AI-attribution line to commits, PR titles,
  PR bodies, or comments.

Verification:
- `pnpm test:cov`: green with the 100% threshold active.
- `node -e "const c=require('./stryker.config.json'); if(c.thresholds.break!==95) throw new Error('break')"`: no throw.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in the per-task block and the Task index row.
2. Tick the satisfied acceptance-criteria checkboxes.
3. Bump the phase Progress counter (X / 6) in the header blockquote.
4. Append a Completion log entry: `- 0.4 ✅ <YYYY-MM-DD>: <one-line summary>`.
5. Update the P0 row in ../development_plan.md (canonical) and mirror docs/tasks/README.md.
6. Recompute the overall counter line in ../development_plan.md.
7. Commit on the phase branch: `test(core): add jest and stryker configuration (0.4)`.
```

---

### Task 0.5: CI workflows, guard scripts, community files

- **Status**: 📋 ToDo
- **Priority**: P0
- **Size**: L
- **Depends on**: 0.2, 0.3, 0.4

#### Description

The four GitHub workflows, dependabot, issue templates, the bundle-size and dogfood guard scripts, and the public community file set. This is the task that makes CI gate every subsequent pull request.

#### Acceptance criteria

- [ ] `.github/workflows/ci.yml` runs lint, typecheck, build, size check, and `test:cov:all` sequentially on pull_request and push to main.
- [ ] `codeql.yml`, `scorecard.yml`, `release.yml` (tag-driven, npm publish with OIDC `--provenance`), `dependabot.yml`, and issue templates present, adapted from the sibling.
- [ ] `scripts/check-size.mjs` (zero-dep, KiB brotli, provisional budgets: `.` 10 KiB, `./pagination` 3 KiB, `./health` 4 KiB) and `scripts/dogfood-smoke-test.mjs` (SUBPATHS: `.`, `./pagination`, `./health`) run green against the placeholder build.
- [ ] `README.md` skeleton with badges, `LICENSE` (MIT), `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1 by reference, not transcribed), `CHANGELOG.md` (Unreleased section).

#### Files to create / modify

- `.github/workflows/{ci,codeql,scorecard,release}.yml`, `.github/dependabot.yml`, `.github/ISSUE_TEMPLATE/*`
- `scripts/check-size.mjs`, `scripts/dogfood-smoke-test.mjs`
- `README.md`, `LICENSE`, `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `CHANGELOG.md`

#### Agent prompt

```
You are a senior CI/CD and open-source hygiene engineer working on @bymax-one/nest-core.

PROJECT: @bymax-one/nest-core, application foundation kit for NestJS 11, public npm package under
the @bymax-one repository standard (four workflows, dependabot, guard scripts, community files).

CURRENT PHASE: 0 (repository-scaffold), Task 0.5 of 6

PRECONDITIONS
- Tasks 0.2, 0.3, 0.4 done: build, lint, and test:cov run green locally.

REQUIRED READING (only these)
- Reference files to copy and adapt: ../nest-cache/.github/workflows/*.yml,
  ../nest-cache/.github/dependabot.yml, ../nest-cache/.github/ISSUE_TEMPLATE/,
  ../nest-logger/scripts/check-size.mjs, ../nest-logger/scripts/dogfood-smoke-test.mjs,
  ../nest-logger/SECURITY.md, ../nest-logger/CONTRIBUTING.md, ../nest-logger/CODE_OF_CONDUCT.md.
- docs/technical_specification.md §13.2 (repository standard) and §13.1 (provisional budgets).

TASK
Land CI, guard scripts, and the community file set so every later PR is fully gated.

DELIVERABLES
1. ci.yml: on pull_request and push to main; single job running sequentially: pnpm install
   (frozen lockfile), lint, typecheck, build, node scripts/check-size.mjs, test:cov:all. Bounded
   test workers come from the Jest config; do not parallelize suites in the workflow.
2. codeql.yml and scorecard.yml copied and adapted (they produce results once the repository is
   public; ship them enabled, do not gut them).
3. release.yml: tag-driven (v*.*.*), builds, runs the full gate, publishes to npm with OIDC
   --provenance. Inert until a tag exists.
4. dependabot.yml and the issue templates, adapted to this repository.
5. scripts/check-size.mjs: zero-dep (node:zlib, node:fs, node:url, node:path), measures brotli
   KiB per subpath bundle, budgets: index 10 KiB, pagination 3 KiB, health 4 KiB, marked
   provisional in a comment (recalibrated at release). scripts/dogfood-smoke-test.mjs: packs the
   tarball and verifies ESM + CJS resolution of ., ./pagination, ./health.
6. README.md skeleton: title, one-paragraph value proposition, badge row (CI, npm version,
   license, coverage, mutation), install, quick start placeholder, link to docs/. LICENSE (MIT,
   Bymax One). SECURITY.md (private disclosure contact). CONTRIBUTING.md (setup, scripts,
   Conventional Commits, 100% coverage bar). CODE_OF_CONDUCT.md referencing Contributor Covenant
   2.1 by link (never transcribed). CHANGELOG.md with an Unreleased section.

Constraints:
- Guard scripts stay zero-dependency (supply-chain rule for anything in the publish path).
- English-only, timeless content; no em dashes; no .gitkeep.
- Never add Co-Authored-By, "Generated with", or any AI-attribution line to commits, PR titles,
  PR bodies, or comments.

Verification:
- `pnpm build && node scripts/check-size.mjs`: green, table printed in KiB brotli.
- `node scripts/dogfood-smoke-test.mjs`: all subpath resolutions pass (ESM and CJS).
- `npx yaml-lint .github/workflows/*.yml` or a YAML parse via node: all workflows parse.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in the per-task block and the Task index row.
2. Tick the satisfied acceptance-criteria checkboxes.
3. Bump the phase Progress counter (X / 6) in the header blockquote.
4. Append a Completion log entry: `- 0.5 ✅ <YYYY-MM-DD>: <one-line summary>`.
5. Update the P0 row in ../development_plan.md (canonical) and mirror docs/tasks/README.md.
6. Recompute the overall counter line in ../development_plan.md.
7. Commit on the phase branch: `ci(core): add workflows, guard scripts, and community files (0.5)`.
```

---

### Task 0.6: Phase close: verification, PR, Copilot review, merge

- **Status**: 📋 ToDo
- **Priority**: P0
- **Size**: S
- **Depends on**: 0.1, 0.2, 0.3, 0.4, 0.5

#### Description

Audit the phase's Definition of Done, update every dashboard, open the phase pull request, obtain and address a GitHub Copilot code review, and merge with CI green.

#### Acceptance criteria

- [ ] Every P0 Definition of Done checkbox in `../development_plan.md` is verified and ticked.
- [ ] Phase file header, task index, completion log, plan dashboard, and README index all consistent.
- [ ] PR opened from `feat/phase-00-repository-scaffold` to `main`; CI green on the PR.
- [ ] GitHub Copilot code review requested; every finding addressed (fix or a reasoned reply); review resolved.
- [ ] PR merged; branch deleted; `main` builds green.

#### Files to create / modify

- This file (statuses), `../development_plan.md`, `README.md` (folder index)

#### Agent prompt

```
You are a senior release engineer closing a development phase of @bymax-one/nest-core.

PROJECT: @bymax-one/nest-core, application foundation kit for NestJS 11. One pull request per
phase; GitHub Copilot code review is a mandatory gate on every phase PR.

CURRENT PHASE: 0 (repository-scaffold), Task 0.6 of 6 (LAST)

PRECONDITIONS
- Tasks 0.1 through 0.5 done and committed on feat/phase-00-repository-scaffold.
- `pnpm lint && pnpm typecheck && pnpm build && pnpm test:cov` all green locally.

REQUIRED READING (only these)
- ../development_plan.md: the P0 block (Definition of Done) and the Progress Dashboard.
- docs/tasks/phase-00-repository-scaffold.md: task index and completion log.

TASK
Close phase 0 through its pull request with a GitHub Copilot review.

DELIVERABLES
1. Verify each P0 Definition of Done item by running the commands it implies; tick the checkboxes
   in ../development_plan.md.
2. Update dashboards: this phase file header (Status 👀 while in review, ✅ after merge), task
   index, completion log; the P0 row and overall counter in ../development_plan.md; the folder
   index in docs/tasks/README.md.
3. Push the branch and open the PR: `gh pr create --title "feat(core): phase 0, repository
   scaffold" --body <professional summary: what landed, how it was verified, DoD checklist>`.
4. Request a GitHub Copilot code review on the PR (Reviewers panel in the GitHub UI, or
   `gh pr edit <number> --add-reviewer copilot-pull-request-reviewer[bot]` when available on the
   repository). Wait for the review, then address EVERY finding: fix legitimate issues in new
   commits on the branch; reply with a short technical justification where the finding does not
   apply. Re-request review after fixes.
5. Merge only when CI is green and the Copilot review is resolved: `gh pr merge --squash
   --delete-branch`. Confirm main builds green after merge.

Constraints:
- Never merge with a red or pending CI check; never dismiss a Copilot finding without a reply.
- PR title and body in professional English.
- Never add Co-Authored-By, "Generated with", or any AI-attribution line to commits, PR titles,
  PR bodies, or comments.

Verification:
- `gh pr checks <number>`: all green before merge.
- `gh pr view <number> --json reviews`: shows the Copilot review present and resolved.
- After merge: `git switch main && git pull && pnpm build && pnpm test:cov`: green.

Completion Protocol (after you finish):
1. Set this task's Status to ✅ in the per-task block and the Task index row.
2. Tick the satisfied acceptance-criteria checkboxes.
3. Set the phase header Status to ✅ and Progress to 6 / 6.
4. Append a Completion log entry: `- 0.6 ✅ <YYYY-MM-DD>: phase PR merged with Copilot review`.
5. Update the P0 row (✅, 100%) and overall counter in ../development_plan.md; mirror README.md.
6. The merge commit itself closes the phase; no further commit needed beyond dashboard updates
   (commit those as `docs(core): close phase 0 dashboards (0.6)` if done post-merge).
```

---

## Completion log

<!-- Append one line per completed task: - <id> ✅ <YYYY-MM-DD>: <summary> -->

- 0.1 ✅ 2026-07-16: package.json scaffolded (three-subpath exports, empty dependencies, peers per spec 12.1) and pnpm install completed with no missing-peer warnings; pnpm pinned to the local 10.8.1 (spec text mentioned 11.x, reconciled to reality).
- 0.2 ✅ 2026-07-16: strict tsconfig set (base/build/jest/e2e), tsup config with three entries, and placeholder barrels landed; typecheck and build both pass, dist/ contains .mjs/.cjs/.d.ts for `.`, `./pagination`, `./health`.
- 0.3 ✅ 2026-07-16: flat ESLint config, Prettier, husky pre-commit/commit-msg, commitlint, and the lint-staged block landed; a non-conventional commit message was rejected locally by the commit-msg hook, then reset.
