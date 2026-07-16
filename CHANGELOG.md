# Changelog

All notable changes to `@bymax-one/nest-core` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The `release.yml` workflow extracts the section matching the pushed `vX.Y.Z` tag
as the GitHub Release body, so each released version needs a matching `## [X.Y.Z]`
heading here.

## [0.1.0] - 2026-07-16

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

[0.1.0]: https://github.com/bymaxone/nest-core/releases/tag/v0.1.0
