# AGENTS.md

`@bymax-one/nest-core` is a **published, zero-dependency NestJS 11 foundation kit**. Everything
merged here reaches consumers as an npm release, so a change to an exported name, a DI token, a
response body or a documented default is a change to somebody else's running deployment.

Start with `CONTRIBUTING.md` for the verification gates every change runs, and
`docs/technical_specification.md` for the architecture and the contracts behind it. This repository
carries no `CLAUDE.md`; those two are the working contract, and this file does not restate either.
What follows is the review layer.

## Code Review Rules

<!-- shared:begin -->
<!--
  CANONICAL COPY: bymaxone/.github → agents/code-review-rules.md
  Do not edit this block in a consuming repository. It is replaced wholesale by
  the `agents-sync` reusable workflow, so a local edit is reverted on the next
  run. Change it here, cut a release, and every repository is offered the update.

  Repository-specific rules go OUTSIDE this block, below the closing marker.
-->

These rules hold in every Bymax repository. What is specific to this one is written after this
block, and the two are read together.

The pipeline already enforces formatting, linting, dependency policy, coverage and — where the
repository has one — the mutation gate. Do not spend a review on a **violation** of one of those: it
is a red check, not a comment. What follows is what CI cannot see.

**A change to the enforcing configuration is the opposite case, and it is in scope.** Every gate runs
the configuration from the branch under review — that branch's lint config, its coverage thresholds,
its mutation thresholds. So a pull request that deletes a rule, lowers a threshold or widens an
ignore glob turns the check **green**, because a gate reports on the rules it was handed. For those
diffs the review is the only independent check there is, and a weakened gate needs the same
justification a suppression does.

### A finding names what it read

Every factual claim in a review — about a library's API, about this repository's history, about what
a file contains — has to come from something read in the tree under review, and the finding should
say which. A claim assembled from recollection is likely to describe a previous version of whatever
it is about.

**Safe path**, by the kind of claim:

| Claim about                         | Read this                                                                      |
| ----------------------------------- | ------------------------------------------------------------------------------ |
| A library's API **shape**           | `node_modules/<pkg>/dist/**/*.d.ts` in this tree                               |
| A library's **runtime behaviour**   | that version's changelog entry, its documentation, or a test that exercises it |
| Commit authorship, dates or history | `git log --format='%an <%ae> / %cn <%ce>' <sha>`                               |
| What a file contains                | the file at the revision under review, not an earlier one                      |

The first two rows are separate on purpose, and the rule below says why: a field can stay optional
in the published type while becoming mandatory in behaviour. A `.d.ts` settles what a signature
accepts and nothing about what the implementation does with it, so a behavioural claim resting on
one is unfounded.

Weight the checking by what acting on the finding would cost. A comment that asks for a reworded
sentence is cheap to be wrong about; one that asks for history to be rewritten, a merge reverted, or
a release pulled is not — verify that class before raising it, and raise it at the severity the
evidence supports rather than the severity the consequence would deserve if true.

### A dependency upgrade migrates every call site, not only the ones that fail to compile

When an upgrade tightens a contract, the compiler catches only the call sites whose **shape**
changed. A field that stays optional in the published type while becoming mandatory in behaviour
compiles, passes the unit suite, and fails in production.

A `@bymax-one/*` version number carries **no compatibility information** while the libraries are
pre-stable: breaking changes ship in minor and patch releases by explicit policy, so `^` and `~`
protect against nothing. The migration note under **Apply to a derived backend** in the library's own
changelog is the compatibility contract.

**Safe path:** read **every** changelog entry from the version being replaced up to the proposed
one, not only the proposed one's, and check every call site they name — not only the ones the
compiler rejected. Upgrades routinely skip releases, and the entry that matters is often not the
last one: adopting `@bymax-one/nest-cache` 1.1.0 → 1.2.1 skipped 1.2.0, where a namespace-validation
security fix lives; 1.2.1's own entry is a field rename. Diff the `.d.ts` of the **previously adopted** version against
the **proposed** one — `npm pack` both, and name the two versions. Reaching for "the installed
declarations" is the trap: in a checkout of the branch under review the installed tree is already
the new version, so that diff compares a release with itself and shows nothing.

### Settled decisions are not review findings

Both are settled deliberately, and reopening either costs a round trip and changes nothing:

- **Do not propose a major version bump** for a breaking change in a `@bymax-one/*` library, and do
  not assert that this ecosystem follows strict SemVer. Until an API is declared stable, breaking
  changes ship in minor and patch releases; the migration note carries the compatibility information
  the number does not. If a document claims strict SemVer, the finding is that the claim is wrong —
  not that the version should be raised.
- **Do not propose pinning `bymaxone/.github` reusable workflows to a commit SHA.** They are
  referenced by the `@v1` alias on purpose: a fix has to land once and reach every repository, the
  tag is immutable and the alias moves only on a release, and pinning was measured to cost ~58
  dependency pull requests to propagate one change. Third-party actions are the opposite case and
  **are** pinned by SHA.

**Safe path:** if you believe a settled decision is now wrong, say so as a question in the pull
request rather than as a finding.

### Suppressions are refusals, not exceptions

`@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`, `eslint-disable` in any form,
`as unknown as` laundering a real type error, `istanbul ignore`, and in Rust `#[allow(...)]` over a
lint gate or `unsafe` without a `// SAFETY:` comment are blocking findings.

Anything a configured gate already reports belongs to the gate, not to a review: where a repository
lints `no-explicit-any` as an error — most do — an `as any` is a red check, and raising it here only
duplicates it. Check the repository's lint configuration before reporting a suppression rather than
assuming the list is exhaustive in either direction.

A failing gate means the code is wrong, the type is wrong, or the rule is wrong. **Safe path:** fix
whichever it is. Changing a rule's configuration with a stated reason is legitimate; scattering
per-call-site silencers is not.

### Comments state constraints, never history

A comment must read as true for whoever opens the file next. Flag any comment that narrates what a
previous version did, names a phase, task, ticket or review round, or explains a change rather than
the code. **Safe path:** state the constraint that still holds, and let `git log` carry the history.

### Size and layering

Functions over **50 lines** and nesting deeper than four levels are findings in the repository's own
source and test directories. Every non-trivial source file opens with a header stating its purpose
and its layer, and every exported symbol carries a doc comment.

**The 800-line file limit applies to what a change introduces, not to what it inherits.** A
repository that already carries a file past the line — a generator, a long end-to-end suite — would
otherwise produce a finding on every pull request touching three lines of it, which the author
cannot act on and did not cause. Raise it for a **new** file over the limit, or when a change pushes
a file past it or materially grows one already over.

Markdown, generated output and lockfiles are **out of scope**: a changelog is an append-only log that
only grows, a lockfile is generated, and neither has layers. Reporting their length is a false
positive on every dependency bump and every release note.

**Safe path:** extract by responsibility rather than by line count — the limit is a symptom, and one
file doing two jobs is the defect.

### No placeholders for empty directories

`.gitkeep`, `.keep` and pre-created empty directory skeletons do not belong in the tree. A directory
exists when there is a real file to put in it. **Safe path:** document the intended structure in a
plan or README, and let the first real file create the path.

### Language and attribution

Everything published is English — source, comments, tests, commit messages, pull request titles and
bodies, `README.md`, `CHANGELOG.md` and everything under `.github/`. Bymax projects keep `docs/` in
**Portuguese** by explicit decision; do not report Portuguese there as a finding.

No commit, pull request, comment or code may attribute authorship to an AI assistant or coding tool,
in any form. **This governs text a change introduces** — a trailer, a "generated with" line, a
signature in a comment or a description.

Git's own author and committer fields are set by the contributor's git configuration rather than by
anything in the diff. Before reporting one as a violation, read it:
`git log -1 --format='%an <%ae> / %cn <%ce>' <sha>`. The claim is trivially checkable and expensive
to act on — it asks for history to be rewritten.

<!-- shared:end -->

### The published surface is the barrels, not the file tree

This package ships five subpaths — `.`, `./pagination`, `./health`, `./metrics`, `./openapi` — each
built as its own bundle. A symbol is public only if a barrel re-exports it: `src/index.ts` or the
`index.ts` of a subpath. Reachability through a relative path is not API, and neither is presence in
`dist/`.

So "this export is undocumented" is a finding only after checking which of the two it is. An
internal helper needs no README entry, and adding one would document something a consumer cannot
import. The `check:published` gate cross-checks the documentation against the built types, and a
snippet in `README.md` is compiled against `dist/` — a code sample that does not compile fails CI
rather than merely reading badly.

**Safe path:** resolve the symbol through the barrel before calling it public.

### A DI token's registry key is public contract

Tokens are minted with `Symbol.for`, never `Symbol()`, and the registry key strings in
`src/core.tokens.ts` are as binding as the export names. Do not propose `Symbol()` as the safer
form: this package inlines shared modules into every subpath bundle, so a `Symbol()` token mints a
different identity per bundle and a provider registered from the package root becomes unreachable
from a subpath injecting "the same" token. That is not hypothetical — it is the 1.3.0 defect that
made `applyBymaxOpenApi` throw on every consumer boot.

Changing an existing key is a breaking change even though no signature moves, and it belongs on the
major-release checklist rather than in an ordinary pull request.

### This bundle ships its comments

The published `.mjs` is not minified, so a docblock is bytes on the wire, and `scripts/check-size.mjs`
holds a hard brotli budget per subpath. Prose in a file that reaches a bundle has a measurable cost;
prose in a types-only file has none, because the file erases at build time. When rationale can live
in either, it belongs in the one that erases.

**Raising a budget is a weakened gate, and the shared rule above applies to it.** The number moves
only after checking that the growth is the feature: that no module entered the bundle which was not
already there, and that the addition is code rather than prose that could live in an erased file.
`scripts/check-size.mjs` carries that reasoning for every past recalibration, and a new one is
expected to add its own.

### Zero runtime dependencies, and optional peers stay behind a dynamic import

`package.json` declares no `dependencies` at all, on purpose. Proposing one — however small, however
popular — is proposing to break the package's central promise, and it needs to be raised as a
question rather than as a finding.

`@nestjs/swagger`, `@opentelemetry/api` and `prom-client` are **optional** peers, reached only
through dynamic `import()` behind their feature flag. A static import of any of the three is a
finding: it makes an optional peer mandatory for every consumer, including the ones with the feature
switched off. `pnpm check:runtime` asserts on the packed artifact that all three stay unloaded when
their features are disabled.

### `docs/` is English in this repository

The shared block exempts Portuguese under `docs/` because Bymax projects generally keep it there.
This repository does not: it is a published library whose specification is read by consumers outside
Bymax, so `docs/` is English like everything else. Portuguese anywhere in this tree is a finding.
