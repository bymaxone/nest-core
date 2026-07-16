# Changelog

All notable changes to `@bymax-one/nest-core` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The `release.yml` workflow extracts the section matching the pushed `vX.Y.Z` tag
as the GitHub Release body, so each released version needs a matching `## [X.Y.Z]`
heading here.

## [Unreleased]

### Added

- Repository scaffold: `package.json` with the three-subpath exports map (`.`, `./pagination`, `./health`), zero direct dependencies, and the required peer set
- Strict TypeScript configuration (base, build, jest, e2e variants) and a three-entry tsup build producing ESM + CJS + `.d.ts`
- Flat ESLint config, Prettier, and local commit governance (husky, commitlint, lint-staged)
- Jest unit and aggregated coverage configurations enforcing a 100% threshold on every axis, plus the Stryker mutation-testing configuration for the pre-release gate
- CI, CodeQL, OpenSSF Scorecard, and tag-driven release workflows, Dependabot, and issue templates
- Zero-dependency bundle-size and dogfood smoke-test guard scripts

[Unreleased]: https://github.com/bymaxone/nest-core/compare/main...HEAD
