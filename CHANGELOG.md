# Changelog

All notable changes to `@bymax-one/nest-core` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The `release.yml` workflow extracts the section matching the pushed `vX.Y.Z` tag
as the GitHub Release body, so each released version needs a matching `## [X.Y.Z]`
heading here.

## [Unreleased]

## [1.2.2] - 2026-08-10

Remediation of a local audit's metrics-auth and pagination-bound findings (merged in #62). No
API changed.

### Fixed

- **Offset-safe page cap.** `normalizePageQuery` resolves the limit first and caps `page` to
  `floor(MAX_SAFE_INTEGER / limit) + 1`, so a hostile `page` can no longer drive
  `(page - 1) * limit` past the safe-integer range and lose precision before a repository computes
  its offset.
- **The `/metrics` bearer scheme is matched case-insensitively.** An HTTP auth scheme is
  case-insensitive (RFC 7235) and may be separated from the credential by more than one space or a
  tab; the check now accepts `bearer`/`BEARER`/mixed case and that whitespace, and anchors the
  scheme to the start of the header to close a mid-string smuggling path.
- **A misconfigured scrape token fails closed.** A `metrics.authToken` configured empty or
  whitespace-only is now rejected at boot instead of being silently treated as unset — which left
  `/metrics` open. A real token is kept verbatim.

### Documentation

- `metrics.authToken` is documented in the README and the technical specification, including a
  protected-scrape example.

## [1.2.1] - 2026-08-08

A patch: the envelope fix below changes a response status for a class of client errors, without
touching the module's API or any option.

### Fixed

- **An error carrying a 4xx status it marked exposable keeps that status, instead of collapsing to 500.** Express's body pipeline throws `http-errors` instances before any handler runs — a payload
  past the limit is `PayloadTooLargeError` (413), malformed JSON is a `SyntaxError` (400), an
  unsupported media type is 415. None is a Nest `HttpException`, so each reached the generic
  500 collapse: a client that sent too large a body, or malformed JSON, was told the server failed,
  and a monitor counted a 5xx for a request that never entered the application. The filter now reads
  the `expose: true` flag and the numeric status these carry and honours it — restricted to the 4xx
  range, because a self-reported 5xx is still a server failure whose account of itself must not
  surface, so it stays a generic 500.

## [1.2.0] - 2026-08-08

Both entries change what a caller receives, which is why this is a minor rather than a patch: an
application wiring `@bymax-one/nest-auth` starts seeing that library's own error codes where it
previously saw one collapsed `BYMAX_BAD_REQUEST`, and a deployment with a feature disabled starts
answering `404` where it answered `500`.

### Fixed

- **A feature disabled on the `forRootAsync` path answers `404` instead of `500`.** Route metadata
  is fixed before the async options resolve, so the health and metrics controllers register
  regardless and guard at request time. That guard threw a plain `Error`, which the envelope
  renders as `BYMAX_INTERNAL_ERROR` — so every consumer registering asynchronously with
  `metrics: { enabled: false }`, which is the ordinary configuration and the one that keeps the
  optional `prom-client` peer unloaded, served an unauthenticated `/metrics` that answered a
  server error to anyone who asked. It counted as a real failure in alerting, in error budgets and
  in any uptime check pointed at the service, describing a state nothing was wrong with.

  The route now reads as absent, which is what the caller would have seen had the framework been
  able to skip the registration. Only the feature's _absence_ is normalised: a resolved path that
  disagrees with the route the controller was registered at is a genuine misconfiguration and
  still throws.

- **A domain error's `details` reach the caller, and a nested `{ error: { … } }` body is read as
  readily as a flat one.** The filter passed an explicit `code` through but dropped the structured
  context beside it, and recognised the fields only when they sat directly on the response.

  `@bymax-one/nest-auth` builds `{ error: { code, message, details } }`, so a backend wiring both
  libraries rendered every distinct auth failure identically — a duplicate e-mail, a password below
  the policy floor, a missing field all arrived as `BYMAX_BAD_REQUEST` / `"Auth Exception"` with no
  details. A client could not branch on the failure, and neither could whoever was debugging it.

  A nested object is followed only when it carries a string `code`, since `error` is an ordinary
  word for a response body to use; a flat code still wins over a nested one; and a `details` value
  that is neither an array nor an object — including the `null` `AuthException` writes to mean
  "none" — is omitted rather than reshaped, so the field stays present only when context exists.

## [1.1.1] - 2026-08-07

**Documentation and tooling.** `dist/` differs from `1.1.0` only in the text of the comments
described below; no runtime code changed.

### Changed

- **Equivalent mutants are documented in the source instead of only in the report.** The nine
  now carry `// Stryker disable next-line <Mutator>: <reason>` on the line they apply to,
  which is the convention now shared across the `@bymax-one/nest-*` libraries. The measured
  score moves from **98.76%** to **100%** — no test and no production logic changed; Stryker
  excludes an ignored mutant from the denominator instead of counting it as one the suite
  failed to kill.

  Two needed the block `disable`/`restore` form, because `next-line` binds to the following
  statement and those mutants do not sit on one: the cursor-parse catch body, and
  `setExtras({ isGlobal: true }, …)` inside the builder chain. The second was already known —
  the note above that call said a directive does not attach there and left the mutant counted.
  That prose is now the directive's reason, and the block brackets the builder statement alone
  so nothing else in the file loses its `ObjectLiteral` mutants. Both were confirmed by
  running them: the pass reports zero survivors where it reported nine.

- The README claimed **Zero suppressions** as a rule. It states what is true now: every
  suppression carries its reason, in the grammar Stryker parses.

### Added

- `check:mutants` gate (`scripts/check-mutation-directives.mjs`) — validates every
  `// Stryker` comment against the parser's own regular expression, rejecting a reason
  written after `--` instead of a colon, a reason wrapped onto a second comment line, a stray
  comma in the mutator list, and a mutator name Stryker does not know, which matches nothing
  and so silences nothing. Wired into CI and `prepublishOnly`.

## [1.1.0] - 2026-08-05

Four optional integrations, each off by default and each loading nothing until it
is turned on: OpenAPI documents in development, health-indicator discovery, a
metrics contribution contract, and OpenTelemetry trace correlation.

### Added

- **OpenAPI documents, development only.** A new `openapi` option block and a new
  `./openapi` subpath exporting `applyBymaxOpenApi`. Enabling the block and calling
  the helper once during bootstrap serves an interactive UI and the raw document,
  carrying the schemas this package already owns — the error envelope and its code
  catalog, the health response, and the offset and cursor page shapes with their
  query parameters.

  `@nestjs/swagger` is an optional peer, reached only through a lazy dynamic import,
  exactly like `prom-client`: an application that leaves the feature off never loads
  it, and enabling the feature without installing it fails at boot with a message
  naming the package and the install command.

  The schemas are contributed as plain specification objects rather than decorated
  classes. A decorator runs when its class is defined, so describing these contracts
  with `@ApiProperty` would load the peer in every application that imports this
  package, including the ones that never enable the feature.

  A contributed entry never overwrites one the document already defines.

- **Health-indicator discovery.** A new `health.autoDiscover` option and a
  `@BymaxHealthIndicator()` marker, exported from the `./health` subpath alongside
  the contract it belongs to. With discovery enabled, every marked provider in the
  application joins readiness — so a library an application merely imports can
  contribute its own check without the application registering anything.

  Discovery matches the marker, never the shape of an object: a provider that
  happens to expose a `name` and a `check` is not a readiness probe, and scraping
  one in would let an unrelated failure take an application out of rotation. A
  provider that is marked but does not implement `IHealthIndicator` fails the boot
  naming the class, rather than being skipped silently.

  Explicit registration still wins: an indicator bound under
  `BYMAX_HEALTH_INDICATORS` keeps its name and its position, and a discovered one
  with the same name is dropped. Discovered indicators are sorted by name, so the
  `checks` array is stable across restarts. The provider graph is walked once, at
  bootstrap.

  Off by default. It changes which failures can fail a readiness probe, which is
  a decision an application makes rather than one it inherits from its imports.

- **A metrics contribution contract.** A new `./metrics` subpath exporting
  `IMetricsContributor` and a `@BymaxMetricsContributor()` marker. A marked provider
  is handed the registry once at bootstrap and registers its own collectors, so a
  library's metrics appear on the application's existing scrape endpoint with
  nothing wired.

  Contributors receive the registry rather than injecting `BYMAX_METRICS_REGISTRY`:
  a library that injected the token would depend on this package's DI tokens, and
  therefore on the module. Receiving it as an argument means the only thing a
  contributing library imports is the contract and the marker.

  Registration failures are rethrown with the contributor named and the original
  error chained. `prom-client` reports a duplicate metric name but not who
  registered it, which in an application composing several libraries is the hard
  half of the question. Contributors run sorted by class name, so a collision fails
  the same way on every boot.

  No separate flag: contribution rides on the metrics feature. With metrics
  disabled no contributor runs and `prom-client` is still never loaded.

  This is the one subpath whose types name `prom-client`. Implementing the contract
  means constructing `prom-client` collectors, so anyone importing it already
  depends on the peer; every other subpath stays free of it.

- **Trace correlation.** A new `telemetry` option block reads the active OpenTelemetry
  span and carries its identifiers into the request-timing sample, into the exception
  filter's observability seam, and — behind `telemetry.exposeTraceId` — into the error
  envelope served to the client.

  `@opentelemetry/api` is an optional peer. Unlike the other two it is read on every
  request, so it is loaded once at bootstrap rather than at the point of use, and only
  when the feature is enabled.

  This package reads; it never traces. No span is created, no SDK configured, no
  exporter registered: all of that belongs to the instrumentation an operator already
  runs, and duplicating it would produce two spans per request.

  A request with nothing recording, or an all-zero span context, resolves to no trace:
  the fields are absent rather than set to a sentinel. Trace identifiers are never used
  as metric labels — a trace id is unbounded, and one unbounded label is enough to make
  a scrape endpoint the most expensive route in a service.

### Changed

- **The marker-based provider scan is now shared.** Readiness discovery and metrics
  contribution use one scan, which reads Nest's provider graph, matches a literal
  metadata key, and labels each match by class name — falling back to the provider
  token for an anonymous class. Behavior is unchanged for readiness.

### Security

- **A trace id is not published in a response body by default.** `telemetry.exposeTraceId`
  is off: a trace id is not a secret, but in a response it tells a caller that a tracing
  backend exists and hands them the identifier correlating their request with everything
  else in that trace. With the option off the identifiers still reach the timing sample and
  the logging seam.
- **The OpenAPI document is never served in production.** `NODE_ENV` decides, and
  the decision is fail-closed: only `development` and `test` are non-production, so
  an unset or unrecognized value is production. The guard runs in two independent
  layers — the option resolver forces the feature off, and the bootstrap helper
  refuses again without trusting that resolution — and there is no override. Asking
  for the document in production is a no-op with a warning, not an error, so one
  configuration can be shared across environments.

### Notes

- `applyBymaxOpenApi` must be called **before** `app.listen()`. Mounting the document
  re-registers routes on the HTTP adapter, and doing that against an
  already-initialized Express 5 application replaces the router: every other route,
  including this package's health endpoints, stops resolving.

## [1.0.1] - 2026-08-04

**Behaviour change on the readiness endpoint.** A failing indicator's message no
longer appears in the HTTP response by default; it goes to the logger instead.

### Security

- **The readiness response no longer publishes an indicator's failure message.**
  `GET /health/ready` returned `details.error` carrying the rejecting indicator's
  `Error#message`. That endpoint is typically unauthenticated and reachable by
  whatever probes it — and an indicator rarely authors its own failure text: it
  writes `await this.redis.ping()` and lets the driver's error propagate. Driver
  errors carry hosts, ports and, for a connection string, credentials. An
  indicator failing with `connection refused: postgres://user:PASSWORD@db:5432`
  served that string to anyone who could reach the probe.

  A failing check is now `{ name, status: 'down' }` and nothing more. The message
  is written to Nest's `Logger` instead, so the diagnostic survives in a channel
  that already has access control rather than being lost.

  `health.exposeIndicatorErrors` (default `false`) puts it back in the response
  for local debugging — the same shape, and the same warning, as
  `envelope.exposeInternals`. The library made opposite choices about the same
  risk in two places; they now agree.

  `timedOutAfterMs` is unaffected: that number is one this library chose, not text
  an indicator produced.

### Changed

- **The Health and Security Model sections describe the split**, and the
  configuration table documents the new option. The previous text said an
  indicator "cannot leak more than it already chose to put in a message", which
  assigned a choice the indicator's author usually never makes.

## [1.0.0] - 2026-08-03

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

[1.1.0]: https://github.com/bymaxone/nest-core/compare/v1.0.1...v1.1.0
[1.0.1]: https://github.com/bymaxone/nest-core/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/bymaxone/nest-core/releases/tag/v1.0.0
[1.1.1]: https://github.com/bymaxone/nest-core/compare/v1.1.0...v1.1.1
[1.2.1]: https://github.com/bymaxone/nest-core/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/bymaxone/nest-core/compare/v1.1.1...v1.2.0
[Unreleased]: https://github.com/bymaxone/nest-core/compare/v1.2.1...HEAD
