# Changelog

All notable changes to `@bymax-one/nest-core` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The `release.yml` workflow extracts the section matching the pushed `vX.Y.Z` tag
as the GitHub Release body, so each released version needs a matching `## [X.Y.Z]`
heading here.

## [Unreleased]

## [0.1.0] - 2026-08-03

First published release. Everything below ships in it.

The `Fixed` and `Security` entries record defects found and corrected before
publication, not regressions any consumer saw — there is no earlier release to
have regressed from. They are kept because the reasoning is worth having.

### Added

- Repository scaffold: `package.json` with the three-subpath exports map (`.`, `./pagination`, `./health`), zero direct dependencies, and the required peer set
- Strict TypeScript configuration (base, build, jest, e2e variants) and a three-entry tsup build producing ESM + CJS + `.d.ts`
- Flat ESLint config, Prettier, and local commit governance (husky, commitlint, lint-staged)
- Jest unit and aggregated coverage configurations enforcing a 100% threshold on every axis, plus the Stryker mutation-testing configuration for the pre-release gate
- CI, CodeQL, OpenSSF Scorecard, and tag-driven release workflows, Dependabot, and issue templates
- Zero-dependency bundle-size and dogfood smoke-test guard scripts
- `BymaxCoreModule` with `forRoot` and `forRootAsync`, conditional registration per feature, and an `isGlobal` extra
- Error envelope: a stable, versioned JSON contract with a `BYMAX_` error-code catalog and custom-code pass-through
- Request timing interceptor: one sample per request to a pluggable `ITimingSink`, with a configurable slow-request flag
- Pagination subpath (`./pagination`): offset and cursor helpers, with an opaque, validated cursor codec
- Health subpath (`./health`): a pluggable indicator contract behind liveness and readiness endpoints
- Optional Prometheus metrics endpoint: a lazily-loaded optional peer, with default HTTP request-count and duration metrics
- An end-to-end test suite proving both registration paths, all features together, and every feature disabled
- The complete public README: feature tour, configuration reference, and integration examples
- Mutation-testing gate at the family threshold (score at least 95, `break: 95`), with the surviving mutants documented as genuine equivalents
- Bundle-size budgets calibrated to the real release artifacts (KiB brotli per subpath, headroom below 2x)

- **`pnpm check:exports`** runs `attw --pack . --profile strict` against the packed
  tarball. Its absence is why both defects above went unnoticed: a source-level
  typecheck compiles `src` and never resolves through the `exports` map.
- **`pnpm check:runtime`** packs the tarball, lays it out the way npm would, and
  loads every subpath from it in ESM _and_ CommonJS, asserting the expected values
  are really exported. `attw` proves the declarations resolve; it never runs the
  JavaScript. Both gates run in CI.

### Fixed

- **CommonJS consumers resolved ESM type declarations.** The `exports` map
  declared a single `types` condition, so `require()` landed on `.d.ts` instead of
  `.d.cts` — `attw --profile strict` reports it as _Masquerading as ESM_ on every
  subpath. Types are now declared per condition.

- **`node10` type resolution failed outright**: the manifest carried no complete
  set of `main`, `module`, `types` and `typesVersions`. All four are now present.

### Security

- **Peer floors raised to exclude known-vulnerable NestJS versions.** The declared
  ranges were `@nestjs/common ^11.0.0` and `@nestjs/core ^11.0.0`, and both
  admitted versions carrying published advisories:

  | Peer             | Advisory                                                                                                                                    | Vulnerable                    | New floor  |
  | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ---------- |
  | `@nestjs/common` | [GHSA-cj7v-w2c7-cp7c](https://github.com/advisories/GHSA-cj7v-w2c7-cp7c) — remote code execution via the `Content-Type` header              | `>= 11.0.0-next.1, < 11.0.16` | `^11.0.16` |
  | `@nestjs/core`   | [GHSA-36xv-jgw5-4q75](https://github.com/advisories/GHSA-36xv-jgw5-4q75) — improper neutralization of special elements in downstream output | `<= 11.1.17`                  | `^11.1.18` |

  A peer range is a statement about which versions this library supports. A floor
  below a published advisory tells a consumer that a vulnerable install is a
  supported one, and nothing in their tooling contradicts it — the install resolves
  cleanly and silently. Corrected before the first publish, so no released version
  ever carried the permissive range. No runtime behaviour changed.

[0.1.0]: https://github.com/bymaxone/nest-core/releases/tag/v0.1.0
[Unreleased]: https://github.com/bymaxone/nest-core/compare/v0.1.0...HEAD
