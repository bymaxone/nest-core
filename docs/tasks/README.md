# Development Tasks: @bymax-one/nest-core

> **Last updated:** 2026-07-06
> **Source roadmap:** [`../development_plan.md`](../development_plan.md) · **Spec:** [`../technical_specification.md`](../technical_specification.md)

Tasks live **one file per phase** in this folder (`phase-NN-<slug>.md`). Each phase file is self-contained: context, rules-of-phase, reference docs, a task index, the tasks (each with an executable 4-backtick **Agent prompt**), and a completion log.

> **Canonical phase status lives in the [Progress Dashboard](../development_plan.md#progress-dashboard) of the development plan.** This folder index mirrors it for convenience: when a phase or task changes state, update the plan dashboard first, then this table.

---

## Phase files (folder index)

| Phase | File                                                                     | Tasks       | Status         |
| ----- | ------------------------------------------------------------------------ | ----------- | -------------- |
| 0     | [`phase-00-repository-scaffold.md`](./phase-00-repository-scaffold.md)   | 6 / 6       | ✅ Done        |
| 1     | [`phase-01-module-core.md`](./phase-01-module-core.md)                   | 6 / 6       | ✅ Done        |
| 2     | [`phase-02-error-envelope.md`](./phase-02-error-envelope.md)             | 5 / 5       | ✅ Done        |
| 3     | [`phase-03-timing-interceptor.md`](./phase-03-timing-interceptor.md)     | 4 / 4       | ✅ Done        |
| 4     | [`phase-04-pagination.md`](./phase-04-pagination.md)                     | 5 / 5       | ✅ Done        |
| 5     | [`phase-05-health.md`](./phase-05-health.md)                             | 5 / 5       | ✅ Done        |
| 6     | [`phase-06-metrics.md`](./phase-06-metrics.md)                           | 5 / 5       | ✅ Done        |
| 7     | [`phase-07-integration-and-docs.md`](./phase-07-integration-and-docs.md) | 2 / 5       | 🔄 In Progress |
| 8     | [`phase-08-release-hardening.md`](./phase-08-release-hardening.md)       | 0 / 6       | 📋 ToDo        |
|       | **Total**                                                                | **38 / 47** | 🔄 In Progress |

---

## Status legend

| Symbol | Meaning     |
| ------ | ----------- |
| 📋     | ToDo        |
| 🔄     | In Progress |
| 👀     | Review      |
| ✅     | Done        |
| ⛔     | Blocked     |
| 🟡     | Partial     |

Task sizes: **S** (< ~100 LoC), **M** (~100 to 250), **L** (~250+). Priorities: **P0** (blocking), **P1** (important), **P2** (nice-to-have).

---

## Execution guidance for AI agents

> **Read this before executing any task.**

### Token economy

1. **Do not load a whole phase file**: jump to your task's anchor and use `Read` with `offset`/`limit`.
2. **Do not load the plan or spec entirely**: each task lists REQUIRED READING with exact sections; read only those.
3. **Do not load sibling libraries entirely** (`nest-auth`, `nest-logger`, `nest-cache`): copy only the specific file a task references.

### Branch and PR workflow (mandatory, one PR per phase)

1. The first task of each phase creates the working branch: `git switch -c feat/phase-NN-<slug>` (never `git checkout -b`).
2. Every task in the phase commits to that branch with Conventional Commits: `<type>(core): <subject> (<N.M>)`.
3. The last task of each phase opens the pull request with `gh pr create`, requests a **GitHub Copilot code review**, addresses every Copilot finding, and merges only after CI is green and the review is resolved.
4. Never add `Co-Authored-By`, "Generated with", or any AI-attribution line to commits, PR titles, PR bodies, or comments.

### Parallelization and memory safety

- Phases 2, 3, 4, and 5 are code-parallel once phase 1 lands (disjoint directories). Phase 6 joins after phase 3.
- **Test suites always run sequentially**: one runner at a time, bounded workers (`maxWorkers: '50%'` pinned in the Jest configs). Never run two suites in parallel, and never fan out test execution across parallel agents.

### Self-update protocol (mandatory at the end of each task)

1. The task block's **Status** and its acceptance-criteria checkboxes.
2. The phase file's **Task index** row and the header **Progress** counter (`X / Y`).
3. The phase file's **Completion log** (append `- <id> ✅ <YYYY-MM-DD>: <summary>`).
4. The phase row in the [plan dashboard](../development_plan.md#progress-dashboard) (canonical) and this README's folder index, then recompute the plan's overall counter line.
5. Commit using the phase branch, Conventional Commits, no attribution trailers of any kind.

### Blocked / review

- Blocked: set `Status: ⛔`, add `> **Blocker:** ...` under the task header, no destructive commit.
- Acceptance fails after 2 red-green cycles: set `Status: 👀` and add an inline note.

---

## Project-wide constraints (apply to every task)

- **Zero `dependencies`**: `package.json` ships `"dependencies": {}`. Required peers: `@nestjs/common` ^11, `@nestjs/core` ^11, `reflect-metadata` ^0.2, `rxjs` ^7. Optional peer: `prom-client` ^15 (`peerDependenciesMeta`), loaded lazily only when metrics are enabled.
- **Three subpaths** built by tsup (ESM + CJS + d.ts): `.`, `./pagination`, `./health`. The `exports` map is the only public surface; no deep imports into `dist`.
- **Explicit DI**: every provider constructor parameter and factory `inject` entry uses `@Inject(token)` with a `Symbol` token. The bundle builds without `emitDecoratorMetadata`.
- **Code-Craft Standard**: TypeScript strict (no `any`, no suppression comments); functions <= 50 lines; files <= 800; `@fileoverview` + `@layer` header per file; imperative JSDoc on exports; English-only, timeless comments (no phase or task references in committed code or config).
- **Coverage**: 100% line/branch/function/statement enforced in both Jest configs from phase 0 onward. Every `it()` carries a block comment stating the scenario and the rule it protects. Mutation testing (Stryker, `break: 95`) is a pre-release gate in phase 8, not per PR.
- **CI from the first PR**: the four workflows (`ci`, `codeql`, `scorecard`, `release`) are created in phase 0, so every pull request in every later phase runs the full gate. CodeQL and Scorecard produce results once the repository is public; `release.yml` stays inert until a version tag exists.
- **No placeholder files**: never create `.gitkeep` or pre-create empty directories; directories emerge from real files.
- **No em dashes** in code, comments, or documentation. Use commas, colons, or parentheses.
