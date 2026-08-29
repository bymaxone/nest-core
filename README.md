<p align="center">
  <img src="https://img.shields.io/badge/%40bymax--one-nest--core-000000?style=for-the-badge&logo=nestjs&logoColor=E0234E" alt="@bymax-one/nest-core" />
</p>

<h1 align="center">@bymax-one/nest-core</h1>

<p align="center">
  <strong>Zero-dependency application foundation kit for NestJS</strong><br />
  <sub>Error Envelope · Request Timing · Offset &amp; Cursor Pagination · Health Probes · Prometheus Metrics · Zero Runtime Dependencies</sub>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@bymax-one/nest-core"><img src="https://img.shields.io/npm/v/@bymax-one/nest-core?style=flat-square&colorA=000000&colorB=000000" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/@bymax-one/nest-core"><img src="https://img.shields.io/npm/dm/@bymax-one/nest-core?style=flat-square&colorA=000000&colorB=000000" alt="npm downloads" /></a>
  <a href="https://github.com/bymaxone/nest-core/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/bymaxone/nest-core/ci.yml?branch=main&style=flat-square&colorA=000000&label=CI" alt="CI status" /></a>
  <a href="https://github.com/bymaxone/nest-core/actions/workflows/ci.yml"><img src="https://img.shields.io/badge/coverage-100%25-brightgreen?style=flat-square&colorA=000000" alt="coverage" /></a>
  <a href="https://github.com/bymaxone/nest-core/blob/main/docs/mutation_testing_results.md"><img src="https://img.shields.io/badge/mutation-100%25-brightgreen?style=flat-square&colorA=000000" alt="mutation score" /></a>
  <a href="https://scorecard.dev/viewer/?uri=github.com/bymaxone/nest-core"><img src="https://api.scorecard.dev/projects/github.com/bymaxone/nest-core/badge?style=flat-square" alt="OpenSSF Scorecard" /></a>
  <a href="https://github.com/bymaxone/nest-core/blob/main/LICENSE"><img src="https://img.shields.io/github/license/bymaxone/nest-core?style=flat-square&colorA=000000&colorB=000000" alt="license" /></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-strict-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" /></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/Node.js-24%2B-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node.js" /></a>
</p>

<p align="center">
  <a href="https://github.com/bymaxone/nest-core">GitHub</a> ·
  <a href="https://github.com/bymaxone/nest-core/issues">Issues</a> ·
  <a href="#-quick-start">Quick Start</a> ·
  <a href="#-api-reference">API Reference</a> ·
  <a href="https://github.com/bymaxone/nest-core-example">Example App</a>
</p>

---

## ✨ Overview

`@bymax-one/nest-core` is the layer every service in a fleet ends up writing for itself: one
error shape, one timing sample, one pagination contract, one health probe, one metrics
endpoint. Writing it per service is how five services end up answering the same failure five
different ways, and how a client integration breaks because one of them changed its error
body.

It ships `"dependencies": {}`. Everything it touches — NestJS, `rxjs`, `reflect-metadata`, and
the three optional peers behind the features that need them (`prom-client`, `@nestjs/swagger`,
`@opentelemetry/api`) — is a peer whose version you already control. A feature you leave off
never loads its peer, which the release gate asserts against the packed tarball.

### Why nest-core?

- **One error shape, fleet-wide.** A versioned code catalog and a fixed envelope, so a client
  writes one error handler instead of one per service — and an unknown failure becomes a
  generic 500 rather than whatever the framework happened to serialize.
- **Features register only when enabled.** Turning metrics off does not leave a disabled
  provider in the container; it leaves no provider, and `prom-client` is never imported. That
  is what lets it stay an optional peer.
- **Pagination without a provider.** `./pagination` is pure functions on their own subpath —
  no module to import, nothing to inject, usable from a script or a test.
- **Health that cannot hang.** An indicator that rejects becomes a `down` entry from its
  top-level message alone, truncated; a slow one is converted by the aggregator rather than
  holding the probe open.

---

## 🔥 Features

### 🚨 Errors

- ✅ **Stable envelope** — one JSON shape for every error an application returns:
  `statusCode`, `code`, `message`, `details`, `correlationId`, `timestamp`, `path`
- ✅ **Versioned code catalog** — `BYMAX_NOT_FOUND`, `BYMAX_CONFLICT`, `BYMAX_BAD_GATEWAY`
  and the rest, exported as constants so a client maps a `code` rather than a message string
- ✅ **Internals stay internal** — an unknown error becomes a generic 500; its message and
  stack are captured for your logger, and reach the body only under `exposeInternals`
- ✅ **Correlation id** — resolved through `BYMAX_CORRELATION_PROVIDER`, so the id comes from
  wherever your request context already keeps it

### ⏱️ Observability

- ✅ **Request timing** — one sample per closed request, rejections included, handed to the sink you register;
  the library stores nothing itself
- ✅ **Slow-request flag** — samples above `slowRequestThresholdMs` are marked, so a sink can
  branch without re-deriving the threshold
- ✅ **Prometheus endpoint** — opt-in scrape route over `BYMAX_METRICS_REGISTRY`;
  `prom-client` is imported only when it is enabled
- ✅ **Contributed metrics** — a provider marked `@BymaxMetricsContributor()` publishes its
  own collectors on that same registry, so an imported library's metrics land in your scrape
- ✅ **Trace correlation** — reads the active OpenTelemetry span, so timing samples (and,
  when you opt in, error envelopes) carry the trace id; never creates a span or an SDK
- ✅ **OpenAPI document, development only** — one bootstrap call publishes an interactive
  UI carrying the schemas this package owns; in production it is never served, guarded twice

### 📄 Pagination & Health

- ✅ **Offset and cursor** — `normalizePageQuery` / `buildPageResult` and
  `normalizeCursorQuery` / `buildCursorResult`, pure functions with no NestJS involvement
- ✅ **Opaque cursors** — `encodeCursor` / `decodeCursor` round-trip a token a client carries
  back, treated as untrusted input on the way in
- ✅ **Liveness and readiness** — separate endpoints, so a slow dependency fails readiness
  without restarting the pod
- ✅ **Pluggable indicators** — implement `IHealthIndicator` against a client you already own
  and register it under the `BYMAX_HEALTH_INDICATORS` multi-token
- ✅ **Discovered indicators** — opt in, and any provider marked
  `@BymaxHealthIndicator()` joins readiness: a library you import brings its own check

### 🧩 Developer Experience

- ✅ **Zero runtime dependencies** — `@nestjs/*`, `rxjs` and `reflect-metadata` arrive as
  peers, so you pin the versions
- ✅ **Five subpaths** — the module, plus `./pagination`, `./health`, `./metrics` and
  `./openapi` that a package can import without pulling the module in
- ✅ **Dual-format output** — ESM + CJS with declarations for each format, verified against
  the packed tarball on every run
- ✅ **Independent features** — each is enabled on its own; the providers for the rest are
  never registered
- ✅ **Typed end to end** — TypeScript `strict` with `exactOptionalPropertyTypes` and
  `noUncheckedIndexedAccess`; zero `any`

---

## 📦 Subpath Exports

| Subpath        | Contents                                                                                                                                                                                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.`            | `BymaxCoreModule`, the error envelope and its code catalog, the request-timing middleware, the DI tokens, and every option type                                                                                                                                     |
| `./pagination` | `normalizePageQuery`, `buildPageResult`, `normalizeCursorQuery`, `buildCursorResult`, `encodeCursor`, `decodeCursor` and their types — pure functions, no NestJS provider involved                                                                                  |
| `./health`     | `IHealthIndicator`, `HealthResponse`, the indicator contracts and the `@BymaxHealthIndicator()` marker, so a package that only implements an indicator does not import the module                                                                                   |
| `./metrics`    | `IMetricsContributor` and the `@BymaxMetricsContributor()` marker, so a package that only publishes metrics imports neither the module nor its DI tokens. The one subpath whose types name `prom-client`, which anyone implementing the contract already depends on |
| `./openapi`    | `applyBymaxOpenApi`, the one bootstrap call that builds and mounts the OpenAPI document — separate so an application that never documents its API never loads the code that does                                                                                    |

Each subpath ships ESM and CommonJS with its own `.d.ts` and `.d.cts`, so
`require()` and `import` both resolve the declarations meant for them.

### Install

```bash
pnpm add @bymax-one/nest-core @nestjs/common @nestjs/core reflect-metadata rxjs
```

Add `prom-client` if you enable the metrics feature, `@nestjs/swagger` if you
enable the OpenAPI feature, and `@opentelemetry/api` if you enable trace
correlation. All three are optional peer dependencies: none is required, or ever
loaded, unless you turn its feature on.

```bash
pnpm add prom-client
pnpm add @opentelemetry/api
pnpm add -D @nestjs/swagger
```

`@nestjs/swagger` belongs in `devDependencies`: the document is never served in
production, so a production install has no reason to carry it.

## 🚀 Quick Start

```typescript
import { Module } from '@nestjs/common'
import { BymaxCoreModule } from '@bymax-one/nest-core'

@Module({
  imports: [BymaxCoreModule.forRoot()]
})
export class AppModule {}
```

With no options, `forRoot()` enables the error envelope, request timing, and
health endpoints, and leaves metrics off. Every documented default is listed
in the [configuration reference](#-configuration) below.

## 🏭 Production Wiring with `forRootAsync`

The standard pattern in real applications: resolve options from your own
configuration service, so behavior can vary by environment without a second
code path.

```typescript
import { Module } from '@nestjs/common'
import { BymaxCoreModule } from '@bymax-one/nest-core'

@Module({
  imports: [
    BymaxCoreModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        envelope: { exposeInternals: config.env === 'development' },
        timing: { slowRequestThresholdMs: 1_000 },
        metrics: { enabled: config.env === 'production' }
      })
    })
  ]
})
export class AppModule {}
```

`isGlobal` is a module extra, not part of the options object, defaulting to
`true`:

```typescript
BymaxCoreModule.forRoot({ isGlobal: false })
```

## ⚙️ Configuration

Every block is optional; an omitted block, or an omitted field within it,
falls back to the documented default. Pass only what you want to change.

### `environment`

The one top-level option rather than a block, because it describes the
deployment rather than a feature.

| Option        | Type     | Default | Description                                                                           |
| ------------- | -------- | ------- | ------------------------------------------------------------------------------------- |
| `environment` | `string` | unset   | The environment this deployment runs in, read only where `NODE_ENV` declares nothing. |

Set it when your application validates its own environment variable and does not
also set `NODE_ENV`. `NODE_ENV` wins whenever it says anything, so this can never
serve the OpenAPI document in a runtime that named itself production. Full rules
and the classification table: [Production is a closed door](#production-is-a-closed-door).

### `envelope`

| Option            | Type      | Default | Description                                                                                    |
| ----------------- | --------- | ------- | ---------------------------------------------------------------------------------------------- |
| `enabled`         | `boolean` | `true`  | Registers the global exception filter.                                                         |
| `exposeInternals` | `boolean` | `false` | Includes the original message and stack of unknown errors. Development only, never production. |

### `timing`

| Option                   | Type      | Default | Description                                                                    |
| ------------------------ | --------- | ------- | ------------------------------------------------------------------------------ |
| `enabled`                | `boolean` | `true`  | Applies the request-timing middleware to every route.                          |
| `slowRequestThresholdMs` | `number`  | unset   | Samples above this duration are flagged `slow: true`. Absent means never slow. |

### `health`

| Option                  | Type      | Default    | Description                                                                                                             |
| ----------------------- | --------- | ---------- | ----------------------------------------------------------------------------------------------------------------------- |
| `enabled`               | `boolean` | `true`     | Registers the health controller.                                                                                        |
| `path`                  | `string`  | `'health'` | Route prefix: `GET /<path>/live`, `GET /<path>/ready`.                                                                  |
| `indicatorTimeoutMs`    | `number`  | `5000`     | Per-indicator timeout before a check reports down.                                                                      |
| `exposeIndicatorErrors` | `boolean` | `false`    | Includes the failing indicator's message in the response under `details.error`. Never enable in production — see below. |
| `autoDiscover`          | `boolean` | `false`    | Also aggregates every provider marked `@BymaxHealthIndicator()`, anywhere in the application.                           |

On `forRoot`, `enabled` and `path` are applied at module-definition time: a
disabled feature registers no controller, and a custom `path` mounts the routes.
On `forRootAsync`, options resolve after the module is defined, so the health
controller is always registered at the default path and enforces `enabled` and
the default path with a request-time guard; a disabled or custom-path async
configuration fails fast at the route rather than at boot.

### `metrics`

| Option                  | Type                     | Default     | Description                                                                                      |
| ----------------------- | ------------------------ | ----------- | ------------------------------------------------------------------------------------------------ |
| `enabled`               | `boolean`                | `false`     | Registers the metrics controller and the registry.                                               |
| `path`                  | `string`                 | `'metrics'` | Route serving the Prometheus scrape.                                                             |
| `defaultLabels`         | `Record<string, string>` | `{}`        | Static labels attached to every metric.                                                          |
| `collectDefaultMetrics` | `boolean`                | `true`      | Collects `prom-client`'s process CPU, memory, and event-loop metrics.                            |
| `authToken`             | `string`                 | _(unset)_   | Bearer required to scrape. Unset leaves the endpoint open; empty/whitespace is rejected at boot. |

As with `health`, `enabled` and `path` register conditionally on `forRoot`. On
`forRootAsync` the metrics controller is always registered at the default path
and enforces `enabled` and the default path with a request-time guard, so a
disabled or custom-path async configuration fails fast at the route.

By default the scrape endpoint is **open** — the exposition publishes the route
inventory and, with `collectDefaultMetrics`, process internals to any caller. Set
`authToken` to require `Authorization: Bearer <token>` (the scheme is matched
case-insensitively; the token is compared in constant time), or protect the route at
your edge (network policy, ingress auth). A token configured empty or whitespace-only
is rejected at boot rather than silently ignored, so a mistyped secret fails loud
instead of leaving the endpoint open:

```ts
BymaxCoreModule.forRoot({
  metrics: { enabled: true, authToken: process.env.METRICS_TOKEN }
})
// Scrape: curl -H "Authorization: Bearer $METRICS_TOKEN" http://host/metrics
```

### `telemetry`

| Option          | Type      | Default | Description                                                                     |
| --------------- | --------- | ------- | ------------------------------------------------------------------------------- |
| `enabled`       | `boolean` | `false` | Reads the active span and carries its ids into timing samples and the log seam. |
| `exposeTraceId` | `boolean` | `false` | Also publishes `traceId` in the error-envelope body served to the client.       |

### `openapi`

| Option               | Type                                       | Default       | Description                                                                         |
| -------------------- | ------------------------------------------ | ------------- | ----------------------------------------------------------------------------------- |
| `enabled`            | `boolean`                                  | `false`       | Builds and serves the document. Ignored in production, where it is always off.      |
| `path`               | `string`                                   | `'docs'`      | Route serving the interactive UI.                                                   |
| `jsonPath`           | `string`                                   | `'docs-json'` | Route serving the raw JSON document.                                                |
| `title`              | `string`                                   | `'API'`       | Document title.                                                                     |
| `description`        | `string`                                   | `''`          | Document description.                                                               |
| `version`            | `string`                                   | `'1.0.0'`     | Document version, independent of the package version.                               |
| `servers`            | `{ url, description? }[]`                  | `[]`          | Servers advertised by the document.                                                 |
| `securitySchemes`    | `Record<string, object>`                   | `{}`          | Security schemes copied into the document's components.                             |
| `security`           | `SecurityRequirement[]`                    | `[]`          | The requirement every operation carries unless it says otherwise.                   |
| `operationSecurity`  | `OperationSecurityMap`                     | `{}`          | Per-operation overrides. An empty array marks that operation public.                |
| `operationIdFactory` | `(controller, method, version?) => string` | peer default  | Names the operations. Leave unset and nothing an existing client generated changes. |
| `includeCoreSchemas` | `boolean`                                  | `true`        | Contributes this package's own schemas and references them from the responses.      |

Unlike `health` and `metrics`, this block behaves identically on `forRoot` and
`forRootAsync`: the document is mounted from the bootstrap helper, after the
options have resolved, so a custom `path` is honored on both registration paths.

#### Documenting authentication

Set the default on the document and mark the exceptions. `security` names
schemes declared in `securitySchemes`; `operationSecurity` overrides it for one
operation, and an **empty array is how the specification says "public"** — which
matters more than it looks, because an operation with _absent_ security inherits
the document default, so a generated client would attach credentials to your
registration endpoint.

```ts
openapi: {
  enabled: true,
  securitySchemes: {
    cookieAuth: { type: 'apiKey', in: 'cookie', name: 'access_token' },
    refreshCookie: { type: 'apiKey', in: 'cookie', name: 'refresh_token' }
  },
  security: [{ cookieAuth: [] }],
  operationSecurity: {
    'POST /auth/login': [],
    'POST /auth/register': [],
    'POST /auth/refresh': [{ refreshCookie: [] }]
  }
}
```

An operation that already declares its own requirement — because you decorated
the handler — is never overwritten, on either path.

#### The operation key is a contract

Keys are `"<METHOD> <path>"`, and the format is documented rather than
incidental: a sibling library can ship a plain-data map of its own operations
keyed this way, so you spread it in instead of restating which of its routes are
public. Import `OperationSecurityMap` to have that map checked at the library's
own compile time — it is a type-only export, so nothing couples at runtime.

- The method is **uppercase**, separated by exactly one space.
- The path is written **exactly as it appears in the generated document**:
  leading slash, OpenAPI template braces (`/users/{id}`), no trailing slash, and
  **including any global prefix**. `@nestjs/swagger` puts
  `app.setGlobalPrefix('api')` into the documented paths, so the key becomes
  `'POST /api/auth/login'` in an application that sets one.

Because of that last point, a library shipping such a map should expose a
**function taking the prefix**, not a frozen constant — the call site is the only
place that knows it:

```ts
// in the library
export function authOperationSecurity(prefix = ''): OperationSecurityMap { /* … */ }

// in the application
operationSecurity: { ...authOperationSecurity('api'), ...myOwnOverrides }
```

A requirement naming a scheme that is not declared **fails the document build**
too, listing the names that missed and the ones the document defines. A
requirement is a reference, and a reference to nothing yields a document whose
security cannot be resolved: a client generator looks the name up, finds
nothing, and either fails or emits an unauthenticated client.

A key matching no operation **fails the document build**, listing both the keys
that missed and the operations that exist. Silence would be worse: a route
renamed out from under a stale key would quietly inherit the document default
and be documented as authenticated when it is not, or the reverse. Failing is
safe here in a way it rarely is — the document is only ever built outside
production, so this can only stop a developer.

One consequence for conditionally-registered routes: the map is static wiring
while a route may not be. If an operation belongs to a feature you register per
environment — your own conditional module, or a library feature toggled off
somewhere — a key naming it fails the boot in whichever docs-enabled environment
lacks that route. That is the intended loud behavior, so build the map the same
way you build the modules: assemble it per feature and spread the fragments in,
rather than writing one flat literal that outlives the routes it names.

That last sentence cuts both ways, and the consequence is worth stating rather
than discovering. **These checks only run when the document is actually built.**
With `openapi.enabled` false, or in a production runtime where the feature is
forced off, nothing validates: a stale key, a renamed route, or a requirement
naming a scheme you deleted all sit there quietly until someone turns the
document on. That is deliberate — refusing to boot a production service over a
documentation setting it never serves would be the wrong trade — but it means
the errors surface on a developer's machine or in CI, **not** at the moment the
configuration went wrong. If you gate the document behind an environment flag,
make sure at least one environment that runs your tests has it on, or these
checks never fire.

#### When an operation ends up requiring nothing

The checks above catch a requirement that points at nothing. The opposite
mistake — an operation that ends up pointing at _no requirement at all_ — breaks
nothing, and that is what makes it dangerous. It is a valid document. No name
dangles. The runtime still answers `401`. A document test that asserts only the
operations you enumerated stays green. The only thing that changed is that a
client generated from the document now sends no credentials.

The edit that produces it is ordinary: a library starts describing its own
routes, its adoption note tells you to delete the entries you had written for
them, and the document-level `security` default is sitting in the same options
block and goes with them. Every route _you_ own then reads as public.

So the document build says so, once, naming the operations:

```
[BymaxCoreModule] a client generated from the OpenAPI document will send no
credentials to 2 operation(s): GET /examples, POST /orders. They state no
security requirement, the document declares no default, and other operations in
it do state one — so this is more often a missing openapi.security default than
a public API. Set openapi.security, or state the intent per operation with an
explicit [] in openapi.operationSecurity.
```

It is a **warning, not a failure**: an API that is public on purpose is a
legitimate configuration, and failing a boot over one would be worse than the
silence it replaces. The trigger is deliberately narrow, so the line stays worth
reading:

| Condition                                               | Why                                                                                                                    |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| The document declares no top-level `security`           | With a default present, a bare operation inherits it. An explicit `security: []` counts as an answer, not an omission. |
| At least one other operation _does_ state a requirement | Somebody described a posture on purpose, so the bare ones beside it are an omission rather than a public API.          |
| The operation is not one of this package's own          | A health probe carrying nothing is the correct description of a route an orchestrator polls without a credential.      |

The escape hatch is to say what you mean, in the document's own vocabulary
rather than by silencing output: `operationSecurity: { 'GET /examples': [] }`
marks the operation public, and it stops being reported. A library can do the
same for its own routes by contributing `security: []` in its fragment.

**There is one shape this warning cannot report.** If you remove _every_
requirement at once — no library describing anything, no decorator, no override,
no document default — the second condition above is never met: nothing states a
requirement, so there are no bare operations sitting _beside_ described ones.
That follows from the trigger and therefore holds in every version; it is not a
gap a later release closes, and a reader who expects one is exactly the reader
who stops checking.

The limit belongs to **anything reading only the rendered document**. Such a
document is indistinguishable from that of an API which is public on purpose —
both are a set of operations asking for nothing — and this package cannot tell
them apart without also warning at every genuinely public API, which is how a
warning earns the right to be ignored.

**Your own suite has no such handicap, because you know which one you are.**
Assert it, and the check runs on every commit rather than when somebody
remembers to look:

```ts
it('still requires a credential everywhere it should', () => {
  const document = buildYourDocument()

  // Assert the default you expect, not merely that one exists. `[]` is a
  // defined value that requires nothing, so a "toBeDefined" check passes for
  // a default that degraded to empty — which is the regression this test is
  // here to catch, wearing the shape of a pass.
  expect(document.security).toEqual([{ cookieAuth: [] }])

  // An explicit `[]` is how an operation says "public". The set of operations
  // saying it should be the set you meant — no more, no fewer.
  expect(publicOperationsOf(document)).toEqual(['POST /auth/login'])
})
```

Render-and-diff keeps a narrower job, and it is a good one: when you are
_changing_ something — adopting a library that describes its own routes, moving
a default — render with and without the change and compare the operations you
mount. It shows you what moved without your having to predict it. Then turn what
it showed you into an assertion, so the next change is caught rather than
inspected.

#### A contributed scheme's presence is part of the contributor's configuration

A library contributes security schemes, and **which** ones it contributes can
depend on how you configured it. Any of them, gated on any of its inputs, and
often on more than one — the scheme you have in mind may be the absent one, and
the setting you are thinking of may not be the only gate. The names are stable;
their presence is not.

That has one consequence worth stating as a rule, because getting it wrong
produces a failure at either end of the loudness scale:

> Derive a document-level default from **the same configuration the contributor
> reads**, never from the scheme names, and never from what the document
> happened to contain before you adopted the library.

Writing the name as a literal is correct only for the configuration you wrote it
against. Under a configuration that declares that scheme plus another, the
default still resolves but describes one of two credentials the route accepts —
**quietly incomplete**. Under one that declares it not at all, the name resolves
to nothing and the document build **fails** with the undeclared-scheme error
above. Guarding on whether the scheme exists is the tempting fix and it is the
wrong one: it clears the case that already announced itself and ships the one
that does not.

Note what a document-level default does not let you _say_. Its entries are
**alternatives** — any one of them satisfies an operation — and they apply to
every operation that states nothing. So a backend whose routes sit behind **two
different credential families** can certainly list both, and nothing rejects it:
the result is a document asserting that _either_ credential works for _every_
inheriting route. That is not an incomplete document, it is a false one, and it
is false in the permissive direction — it tells a client that a credential the
route will reject is one the route accepts.

Give the majority family the default and the minority explicit
`operationSecurity` entries. Those outrank the default, and an operation
carrying one is never named by the warning above, because it states a
requirement.

## 🔑 DI Tokens

Every token is a `Symbol`. `BYMAX_CORRELATION_PROVIDER`,
`BYMAX_HEALTH_INDICATORS` and `BYMAX_HEALTH_TRANSITION_SINK` are consumed with
`@Optional()` and are not bound by the module: provide either from your own module to supply your own
implementation, otherwise the internal fallback in the last column applies.
`BYMAX_TIMING_SINK` and `BYMAX_METRICS_REGISTRY` behave differently on
`forRootAsync`, where options resolve after the module is defined: there the
module always binds and exports both (the timing sink as the metrics bridge or a
no-op, the registry as a guarded placeholder when metrics are off), so a
consumer `BYMAX_TIMING_SINK` override is honored on `forRoot` but shadowed on
`forRootAsync`. Follow the pattern in
[Integration with `@bymax-one/nest-logger`](#-integration-with-bymax-onenest-logger)
below.

| Token                          | Provides                              | When you do not provide one                                                                                       |
| ------------------------------ | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `BYMAX_CORE_OPTIONS`           | The resolved `BymaxCoreModuleOptions` | always set by the module                                                                                          |
| `BYMAX_CORRELATION_PROVIDER`   | `ICorrelationIdProvider`              | internal no-op (omits `correlationId`)                                                                            |
| `BYMAX_TIMING_SINK`            | `ITimingSink`                         | internal no-op, or the metrics bridge when timing and metrics are both enabled                                    |
| `BYMAX_HEALTH_INDICATORS`      | `IHealthIndicator[]`                  | treated as an empty indicator set                                                                                 |
| `BYMAX_HEALTH_TRANSITION_SINK` | `IHealthTransitionSink`               | no sink; readiness transitions go to Nest's logger instead (binding one stands that line down)                    |
| `BYMAX_METRICS_REGISTRY`       | the `prom-client` `Registry`          | bound when metrics are enabled; on `forRootAsync` always registered, guarded-placeholder when off                 |
| `BYMAX_TRACE_CONTEXT`          | `ITraceContextProvider`               | bound on every path: the OpenTelemetry reader when telemetry is enabled, a no-op that resolves no trace otherwise |

## 🚨 Error Envelope

Every error that leaves an application registered with the envelope feature
follows this exact, versioned shape:

```json
{
  "statusCode": 404,
  "code": "BYMAX_NOT_FOUND",
  "message": "Invoice inv_123 was not found",
  "details": [{ "field": "id", "issue": "unknown identifier" }],
  "correlationId": "8f14e45f-ceea-4677-a9de-6ec3f1f0a1b2",
  "timestamp": "2026-07-16T12:00:00.000Z",
  "path": "/invoices/inv_123"
}
```

| Field           | Type              | Presence | Notes                                              |
| --------------- | ----------------- | -------- | -------------------------------------------------- |
| `statusCode`    | number            | always   | HTTP status.                                       |
| `code`          | string            | always   | Stable, machine-readable code.                     |
| `message`       | string            | always   | Human-readable, safe for end users.                |
| `details`       | array or object   | optional | Structured context, for example validation issues. |
| `correlationId` | string            | optional | Present when a correlation provider is bound.      |
| `timestamp`     | string (ISO 8601) | always   | Time the error was formatted.                      |
| `path`          | string            | always   | Request URL path.                                  |

Codes are stable strings under a reserved `BYMAX_` prefix, derived from the
HTTP status: `BYMAX_NOT_FOUND` for 404, `BYMAX_VALIDATION_FAILED` for the
shape a validation pipe produces, `BYMAX_INTERNAL_ERROR` for anything
unmapped, and so on. Throw an `HttpException` whose response object carries
your own `code` and the filter passes it through verbatim:

```typescript
import { BadRequestException } from '@nestjs/common'

throw new BadRequestException({ code: 'INVOICE_OVERDUE', message: 'Invoice is overdue' })
```

### What the filter classifies from, and what it cannot

An error raised before any handler ran — a malformed JSON body, a payload over
the size limit — still becomes a clean `4xx` envelope rather than a 500. The
filter recognizes those by **shape**, not by class: it honours an error that
marks itself `expose: true` with a `4xx` status, which is the `http-errors`
convention Node's body pipeline follows. Nothing in the application failed, so
it is not routed through the unexpected-error seam either.

**An error that carries no such marking is a 500, including when a client
caused it.** The clearest case is depth: a body of a few kilobytes nested
thousands of levels deep overflows the stack during validation and surfaces as
`RangeError: Maximum call stack size exceeded` — well under any size limit, and
answered `500 BYMAX_INTERNAL_ERROR`.

That is deliberate, and the alternative is worse. Mapping `RangeError` to a
`4xx` would make the filter infer causation from an error class, and it would be
wrong exactly where it matters: a genuine stack overflow in your own code is a
`500` that should page someone, and relabelling it as a client error would hide
the failure the `500` exists to surface. By the time the filter sees the error,
the body that caused it is gone.

**So body-shape limits are the application's floor, not the filter's.** Cap
nesting depth and the request is rejected as the `400` it is, instead of
becoming a `5xx` that pollutes your error rate and writes a stack per request.

**Position it after the body parser and before validation** — that window is the
only place the body exists in a form you can measure and nothing has walked it
yet. Earlier there is nothing to inspect; later the overflow has already
happened, which is the failure you are trying to prevent.

**Where that window is depends on the adapter, and the obvious answer is wrong
on Express.** Measured against a real Nest application:

| Registration point                       | `req.body` when it runs |
| ---------------------------------------- | ----------------------- |
| `app.use(...)` in `bootstrap.ts`         | **`undefined`**         |
| Module middleware, `configure(consumer)` | the parsed body         |

Nest registers its own parser during `app.init()`, so a middleware added with
`app.use()` before that is mounted _ahead_ of it — a depth guard there inspects
nothing and silently protects nothing. Register it as module middleware
instead. On Fastify the ordering differs again, since Nest middleware runs
through `@fastify/middie` ahead of body parsing; a `preValidation` hook is the
place to look, and it is worth measuring rather than assuming.

**Registering it in the right place is not enough — the route pattern silently
skips paths too.** This package hit the same trap with its own timing
middleware, and the measured behaviour is in `core.module.ts`:

| `forRoutes(...)` | Express        | Fastify          |
| ---------------- | -------------- | ---------------- |
| `'*splat'`       | skips the root | —                |
| `'{*splat}'`     | skips `/api`   | every path       |
| `'/'`            | every path     | matches `/` only |

So the named-wildcard form every migration guide reaches for leaves `POST /`
unguarded on Express. A consumer measured exactly that: with `'*path'`, a
2000-level body to the root returned `404` because the middleware never ran;
with `'{*path}'`, `400`. If your application mounts nothing at the root, both
forms answer `4xx` and the status alone cannot tell you which one you have.

**Verify by behaviour, not by wiring — this is the part worth insisting on.**
Checking where the middleware is registered is what the consumer above did; it
looked correct, they confirmed it to us, and the guard was inert. Send a body
nested past your ceiling and require your own rejection:

```ts
it('refuses a body nested past the ceiling', async () => {
  const deep = JSON.parse(`${'['.repeat(2000)}${']'.repeat(2000)}`)

  const res = await request(app.getHttpServer()).post('/anything').send({ name: deep })

  // Match your guard's own message, not the status: a validation pipe rejects
  // this shape with a 400 as well, so a status assertion passes with the floor
  // removed and proves nothing.
  expect(res.body.message).toBe('Request body is nested too deeply.')
})
```

Use a depth that actually overflows, and assert the guard's own message. A test
at a depth your DTO validation already rejects passes identically with the guard
deleted — which is a check that cannot produce a negative result, and the reason
this defect survived a green suite.

A depth ceiling well above anything a legitimate payload nests and well below
what exhausts the stack leaves a wide margin: one consumer runs `32`, against
the ~2000 levels that overflow. Walk the parsed body iteratively — a recursive
depth check on a hostile payload overflows the stack it was written to protect.

## ⏱️ Request Timing

One `RequestTimingSample` is delivered to whatever implements `ITimingSink` for
**every request the server closes** — not only the ones a handler answered:

```typescript
export interface RequestTimingSample {
  method: string
  route: string
  statusCode: number
  durationMs: number
  slow: boolean
}
```

### Rejected requests are counted too

The recorder is middleware (`BymaxTimingMiddleware`), applied to every route by
`BymaxCoreModule` when `timing.enabled` is `true`. That placement is the whole
point. Nest runs **middleware → guards → interceptors → pipes → handler**, so a
request rejected by a guard never reaches an interceptor, and a request matching
no route never reaches a controller. A recorder sitting in either place is blind
to exactly the traffic that matters during an incident:

| What happens                   | Status | Visible to an interceptor | Visible here |
| ------------------------------ | ------ | ------------------------- | ------------ |
| Handler answers                | `2xx`  | ✅                        | ✅           |
| Authentication guard rejects   | `401`  | ❌                        | ✅           |
| Authorization guard rejects    | `403`  | ❌                        | ✅           |
| Rate limiter sheds the request | `429`  | ❌                        | ✅           |
| No route matches               | `404`  | ❌                        | ✅           |
| Client hangs up mid-request    | —      | ❌                        | ✅           |

A credential-stuffing run is a flood of `401`s, route enumeration is a flood of
`404`s, and a throttler doing its job is a flood of `429`s. All three used to
leave the error graph flat.

Requests that matched no route are recorded under the fixed label
`UNMATCHED_ROUTE` (`<unmatched>`), never the path that was requested. The raw
path is attacker-controlled, and a metrics label that follows it lets anyone
mint one time series per probe until the process runs out of memory.

The sample is emitted when the connection closes, so a client that hangs up
before the response finishes is still counted — that is what a scanner does, and
`durationMs` covers guards and middleware as well as the handler.

An aborted request keeps whatever status the response held, which is `200` in
Node unless something settled another one. No sentinel status is introduced:
that would change the value of `status_code="200"` series that already exist in
your dashboards, without any change in traffic.

**Express and Fastify behave identically here**, and that is asserted end to
end on both. It needs saying because the two platforms disagree underneath: Nest
runs middleware on Fastify through `@fastify/middie`, which hands it the raw
`IncomingMessage` carrying no route metadata, and `forRoutes('/')` is a mount on
Express but an exact match on Fastify. The module resolves both for you.

> **One gap remains, and it is Nest's scoping rule, not a setting.** Module
> middleware is scoped to the global prefix, so with `setGlobalPrefix('api')` a
> request to `/nope` — outside the prefix entirely — reaches no middleware and
> is not recorded. Requests to `/api/nope` are recorded normally, under
> `<unmatched>`, so a scan that probes below your prefix is still visible; only
> one that probes above it is not. Covering that too is not supported yet: the
> module has no way to register the recorder outside its own scope, and
> `BymaxTimingMiddleware` is only provided when `timing` is enabled — at which
> point the module already applies it, so resolving and re-registering it would
> double-count. If you need it, open an issue rather than wiring it by hand.

Bind your own sink by providing `BYMAX_TIMING_SINK` from your own module, the
same override pattern shown below for the correlation provider. This applies on
the `forRoot` path; on `forRootAsync` the module owns `BYMAX_TIMING_SINK` (the
metrics bridge or a no-op) so a consumer binding is shadowed there:

```typescript
import { Global, Module } from '@nestjs/common'
import { BYMAX_TIMING_SINK, type ITimingSink } from '@bymax-one/nest-core'

class LoggerTimingSink implements ITimingSink {
  record(sample: import('@bymax-one/nest-core').RequestTimingSample): void {
    // forward to your own logger or telemetry pipeline
  }
}

@Global()
@Module({
  providers: [{ provide: BYMAX_TIMING_SINK, useClass: LoggerTimingSink }],
  exports: [BYMAX_TIMING_SINK]
})
export class ObservabilityModule {}
```

A sink that fails cannot reach the request: both a synchronous throw and a
rejection from an `async record()` are absorbed. Write it `async` if the backend
behind it is async — the `void` return type accepts it, and the rejection is
caught. The failure is swallowed rather than logged, unlike a health transition
sink, because this runs on every request and a systematically failing sink would
otherwise become a second flood beside the first.

## 📄 Pagination

Framework-neutral, pure functions on the `./pagination` subpath: no NestJS
provider, no ORM awareness. Your repository translates the normalized query
into its own persistence call.

### Offset pagination

```typescript
import { Controller, Get, Query } from '@nestjs/common'
import {
  buildPageResult,
  normalizePageQuery,
  type PageResult
} from '@bymax-one/nest-core/pagination'

@Controller('invoices')
export class InvoiceController {
  constructor(private readonly invoices: InvoiceRepository) {}

  @Get()
  async list(@Query() raw: Record<string, unknown>): Promise<PageResult<Invoice>> {
    const query = normalizePageQuery(raw, { maxLimit: 50, maxOffset: 100_000 })
    const { rows, total } = await this.invoices.findPage(query)
    return buildPageResult(rows, total, query)
  }
}
```

#### Bound the offset, not just the page size

`maxLimit` caps how many rows a request reads. `maxOffset` caps how far in it
starts — and on an offset-paginated database that is the half that costs:

```
GET /invoices?page=1000000000&limit=20     →  OFFSET 19999999980
```

Twenty bytes of query, and Postgres walks the table to reach a page that does
not exist. The page index has a floor of `1` and an arithmetic guard that keeps
`(page - 1) * limit` an exact integer, but nothing bounds the product itself
unless you say so.

`maxOffset` is **absent by default and deliberately so**: legitimate deep paging
exists, and a silent ceiling would change the rows a working query returns. Set
it wherever the page index reaches SQL and your dataset has a knowable ceiling.
`0` is a valid bound and means "the first page only".

Clamping matches how `maxLimit` already behaves — the resolved values come back
in `meta`, so a caller that cares can compare what it asked for against what it
got.

### Cursor pagination

```typescript
import { Controller, Get, Query } from '@nestjs/common'
import {
  buildCursorResult,
  decodeCursor,
  normalizeCursorQuery,
  type CursorResult
} from '@bymax-one/nest-core/pagination'

@Controller('invoices')
export class InvoiceCursorController {
  constructor(private readonly invoices: InvoiceRepository) {}

  @Get('cursor')
  async list(@Query() raw: Record<string, unknown>): Promise<CursorResult<Invoice>> {
    const query = normalizeCursorQuery(raw, { maxLimit: 50 })
    const after = query.cursor ? decodeCursor<{ id: string }>(query.cursor) : undefined
    // fetch limit + 1 rows ordered after `after`, the fetch-one-extra convention
    const rows = await this.invoices.findAfter(after, query.limit + 1)
    return buildCursorResult(rows, query.limit, (last) => ({ id: last.id }))
  }
}
```

A malformed or tampered cursor rejects with `BYMAX_VALIDATION_FAILED`. Cursors
are opaque `base64url` strings but are neither encrypted nor signed: encode
ordering keys only, never sensitive data.

## ❤️ Health

Liveness always replies `200` with an empty checks array; readiness runs
every registered indicator concurrently and replies `200` only when every
indicator reports `up`, `503` otherwise, naming every check either way.

A failing indicator is named but not quoted: the response says which check is
down, and the reason goes to the logger. See
[the security model](#-security-model) for why, and
`health.exposeIndicatorErrors` if you want the message in the response while
debugging locally.

```json
{ "status": "ok", "checks": [{ "name": "redis", "status": "up" }] }
```

Implement `IHealthIndicator` against a client you already own:

```typescript
import { Injectable } from '@nestjs/common'
import type { HealthIndicatorResult, IHealthIndicator } from '@bymax-one/nest-core/health'

@Injectable()
export class RedisHealthIndicator implements IHealthIndicator {
  readonly name = 'redis'

  constructor(private readonly redis: RedisClient) {}

  async check(): Promise<HealthIndicatorResult> {
    await this.redis.ping()
    return { status: 'up' }
  }
}
```

Register it under the shared `BYMAX_HEALTH_INDICATORS` token from your own
module, the same override pattern used throughout this README:

```typescript
import { Global, Module } from '@nestjs/common'
import { BYMAX_HEALTH_INDICATORS } from '@bymax-one/nest-core'

@Global()
@Module({
  providers: [
    RedisHealthIndicator,
    {
      provide: BYMAX_HEALTH_INDICATORS,
      useFactory: (r: RedisHealthIndicator) => [r],
      inject: [RedisHealthIndicator]
    }
  ],
  exports: [BYMAX_HEALTH_INDICATORS]
})
export class HealthIndicatorsModule {}
```

A rejecting, throwing, or slow indicator (past `indicatorTimeoutMs`) is
converted to a `down` entry with a safe, bounded diagnostic detail; it never
hides the results of the other registered indicators.

### A failing check leaves a record

A readiness failure that nothing records is a `503` an orchestrator acts on with
an empty log behind it, and diagnosing it means reproducing it. That is easy to
arrive at without deciding to: probe paths are the highest-volume request a
backend serves, so they are usually excluded from the HTTP log surface, and a
well-written indicator returns `{ status: 'down' }` rather than throwing —
because readiness is typically unauthenticated and a driver's error carries
hosts, ports and sometimes credentials.

So the aggregator records it. It holds the last state of every check and reports
each **change** — never once per probe — to its own logger, and to a sink you
bind:

```typescript
import { Injectable } from '@nestjs/common'
import type { HealthTransition, IHealthTransitionSink } from '@bymax-one/nest-core/health'

@Injectable()
export class HealthTransitionLogger implements IHealthTransitionSink {
  constructor(private readonly logger: MyStructuredLogger) {}

  record(transition: HealthTransition): void {
    if (transition.isUp) {
      this.logger.info('HEALTH_CHECK_RECOVERED', { check: transition.name })
      return
    }
    this.logger.warn('HEALTH_CHECK_DEGRADED', {
      check: transition.name,
      cause: transition.cause.kind
    })
  }
}
```

Bind it under `BYMAX_HEALTH_TRANSITION_SINK` from your own `@Global()` module,
the same override pattern as the indicator token above.

Binding nothing is supported, and is not the silent case: the transitions reach
Nest's logger instead, so a readiness failure always leaves a record. **Binding a
sink stands that line down** — both destinations are usually the same logger, so
keeping it would put two records of one transition side by side, which is the
noise this feature exists to remove. Your sink receives the cause as structured
data, strictly more than the line renders, so what reaches the log after that is
your decision rather than this package's.

`transition.cause` distinguishes the three ways a check can be down, which the
`up`/`down` response body cannot:

| `cause.kind`    | Meaning                                            | Carries     |
| --------------- | -------------------------------------------------- | ----------- |
| `reported-down` | The indicator answered, and reported it down.      | —           |
| `rejected`      | The indicator rejected or threw.                   | `message`   |
| `timed-out`     | The aggregator gave up after `indicatorTimeoutMs`. | `timeoutMs` |

`timed-out` is the one that cannot be observed anywhere else. An indicator the
aggregator abandoned is never told, so it reports nothing — and a hung
dependency is the common shape, not a refused one: a database under load, a
network partition and a paused container all hang, while a refusal comes back
immediately and would have been reported. That is why the rule lives in the
aggregator rather than in each backend: the obstacle is information, not effort.

Two details worth knowing before you rely on it. A first observation that is
**failing** is reported, while a first observation that is healthy is not — a
process that boots against a dependency already down would otherwise look
healthy in the log forever, whereas announcing every healthy check would write a
line per dependency on every boot. And the cause is the one seen **at the
transition**: a dependency that stays down while its failure mode changes
underneath keeps the first cause, which is the cost of one line per outage
instead of one per probe.

The sink is called synchronously on the readiness path, so keep it cheap. A
throw is caught and logged rather than failing the probe — readiness answering
`500` because its own logging broke would take a healthy deployment out of
rotation — but do not use that as flow control.

### Discovered indicators

Registering every indicator by hand stops scaling once the libraries an
application imports have their own health to report. Mark a provider instead,
and turn discovery on:

```typescript
// in a library, or anywhere in your application
import { Injectable } from '@nestjs/common'
import { BymaxHealthIndicator } from '@bymax-one/nest-core/health'
import type { HealthIndicatorResult, IHealthIndicator } from '@bymax-one/nest-core/health'

@BymaxHealthIndicator()
@Injectable()
export class RedisHealthIndicator implements IHealthIndicator {
  readonly name = 'redis'

  async check(): Promise<HealthIndicatorResult> {
    await this.redis.ping()
    return { status: 'up' }
  }
}
```

```typescript
BymaxCoreModule.forRoot({ health: { autoDiscover: true } })
```

Readiness now includes `redis` with nothing registered anywhere. The rules:

| Rule                        | Behavior                                                                                                                                              |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Marked, not shaped          | Only providers carrying the marker are collected. A provider that merely has `name` and `check` is ignored.                                           |
| Explicit wins               | An indicator registered under `BYMAX_HEALTH_INDICATORS` keeps its name and its position; a discovered one with the same name is dropped.              |
| Stable order                | Discovered indicators are sorted by name, so the `checks` array does not reshuffle between restarts.                                                  |
| Marked but incomplete fails | A marked provider that does not implement `IHealthIndicator` fails the boot, naming the class. Skipping it would hide a check you believe is running. |
| Scanned once                | The provider graph is walked at bootstrap, not per probe.                                                                                             |

It is off by default because it changes which failures can take an application
out of rotation: with it on, a library you merely import gains the ability to
fail your readiness probe. That is the point — the dependency understands its own
health better than you do — but it is your decision, not something you inherit.

`@BymaxHealthIndicator()` lives in `./health`, alongside the contract, so a
library that only ships an indicator never imports the module.

## 📈 Metrics

Disabled by default. Enabling it registers `GET /metrics`, serving Prometheus
text format from a dedicated `prom-client` registry:

```typescript
BymaxCoreModule.forRoot({ metrics: { enabled: true } })
```

`prom-client` is an optional peer, loaded lazily only when `metrics.enabled`
is `true`. If you enable metrics without installing it, the module fails fast
at boot with a descriptive error naming the missing package and the install
command, rather than a cryptic resolution failure at the first scrape.

When timing and metrics are both enabled, an internal bridge feeds two
default HTTP metrics with a bounded label set:

| Metric                          | Type      | Labels                           |
| ------------------------------- | --------- | -------------------------------- |
| `http_requests_total`           | counter   | `method`, `route`, `status_code` |
| `http_request_duration_seconds` | histogram | `method`, `route`, `status_code` |

Inject `BYMAX_METRICS_REGISTRY` to register your own application metrics
against the same registry the endpoint scrapes.

### Contributed metrics

Injecting the token works for your own code, but it makes a library depend on
this package's DI tokens — and therefore on the module. A library declares its
metrics instead:

```typescript
// in a library
import { Injectable } from '@nestjs/common'
import { BymaxMetricsContributor } from '@bymax-one/nest-core/metrics'
import type { IMetricsContributor, MetricsRegistry } from '@bymax-one/nest-core/metrics'
import { Gauge } from 'prom-client'

@BymaxMetricsContributor()
@Injectable()
export class QueueMetrics implements IMetricsContributor {
  registerMetrics(registry: MetricsRegistry): void {
    new Gauge({ name: 'bymax_queue_depth', help: 'Jobs waiting', registers: [registry] })
  }
}
```

Enable metrics and the contributor runs — there is no second flag:

```typescript
BymaxCoreModule.forRoot({ metrics: { enabled: true } })
```

| Rule               | Behavior                                                                                                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Marked, not shaped | Only providers carrying the marker are called. A provider that merely has `registerMetrics` is never touched.                                                                         |
| Called once        | At bootstrap, with the registry the scrape endpoint serves. Never per request, never per scrape.                                                                                      |
| Stable order       | Contributors run sorted by class name, so a collision fails the same way on every boot.                                                                                               |
| Named failures     | A registration failure — usually a metric name another library already claimed — fails the boot naming the contributor. `prom-client` names the metric; this names who registered it. |
| Off with metrics   | With the metrics feature disabled, no contributor runs and `prom-client` is never loaded.                                                                                             |

**Naming and labels.** Contributors share one registry and one namespace, so the
conventions are part of the contract:

- Prefix every metric with `bymax_<library>_` (`bymax_queue_depth`,
  `bymax_cache_hits_total`). An application's own metrics need no prefix — they
  have no one to collide with but themselves.
- Follow Prometheus naming: `_total` for counters, `_seconds` for durations, base
  units, no units in the middle of a name.
- Keep labels bounded. Route templates, never raw paths; status codes, never
  messages. **Never** a tenant, user, or request id — one unbounded label is
  enough to make a scrape endpoint the most expensive route in a service.
  `tenantId` deserves naming twice: every library in this family is
  tenant-aware, so it is the first label anyone reaches for and it is unbounded
  by construction.
- **Publish the list.** A library that contributes metrics documents them in its
  own README — name, type, labels. This package deliberately keeps no central
  catalogue: a list of everyone else's metrics rots the moment a library ships a
  new one. What it does require is that the list exists somewhere an operator
  can find it.

**Why these rules live here.** A Prometheus registry is a flat namespace, and
`prom-client` rejects a duplicate metric name. If two libraries independently
pick `bymax_operations_total`, the collision surfaces at the **consumer's** boot
— in an application neither library's CI ever assembles, as a hard failure, in
front of whoever wired the app. Neither library can test for it. A namespace
rule is the only thing that prevents it, and it can only be arbitrated by the
dependency they share, which is this package.

The rules are documentation, not enforcement. This package could inspect the
registry around each contributor and reject an unprefixed name, but that would
need a per-contributor prefix on the contract, and it would wrongly reject the
case that matters most — an **application's own** contributor, which has no
business being pushed into a `bymax_` namespace.

## 📘 OpenAPI

Disabled by default, and **never served in production**. Enabling it and calling
one helper during bootstrap publishes an interactive UI at `GET /docs` and the
raw document at `GET /docs-json`:

```typescript
// app.module.ts — configuration lives with every other feature
BymaxCoreModule.forRoot({ openapi: { enabled: true, title: 'Invoices API' } })
```

```typescript
// main.ts — the one call that needs the application instance
import { NestFactory } from '@nestjs/core'
import { applyBymaxOpenApi } from '@bymax-one/nest-core/openapi'
import { AppModule } from './app.module'

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule)
  await applyBymaxOpenApi(app)
  await app.listen(3000)
}

void bootstrap()
```

> [!IMPORTANT]
> Call `applyBymaxOpenApi` **before** `app.listen()`. Mounting the document
> re-registers routes on the HTTP adapter, and doing that against an
> already-initialized Express 5 application replaces the router: the document
> appears and every other route in the application — yours and this package's
> health endpoints alike — starts returning 404.

The call is safe to make unconditionally. It returns what it did, so a template
can emit it once and never branch:

| Result                                     | Meaning                                                 |
| ------------------------------------------ | ------------------------------------------------------- |
| `{ mounted: true, path }`                  | The UI and the document are served at `path`.           |
| `{ mounted: false, reason: 'disabled' }`   | `openapi.enabled` is off.                               |
| `{ mounted: false, reason: 'production' }` | The runtime is production. Nothing was built or served. |

### Production is a closed door

`NODE_ENV` decides, and the decision is fail-closed: only `development` and
`test` are non-production. Any other value is production, and in production the
document is never built and never mounted, whatever the configuration says. The
guard runs twice, independently: the option resolver forces the feature off, and
the bootstrap helper classifies the runtime again without trusting that
resolution.

**`NODE_ENV` cannot be overridden.** With it set to anything, no option serves
the document in a runtime it named production.

Enabling it in production is not an error, it is a no-op with a warning naming
the option that was ignored, so a single configuration can be shared across
environments.

#### When your application validates its own environment variable

Plenty of applications parse an `APP_ENV` through a config schema and never set
`NODE_ENV` at all. Those deployments used to be classified as production —
absence was the only evidence available — so the document was refused in an
environment that never asked for the refusal, with no way to answer back.

Declare the environment and it is used **where the process declares nothing**:

```typescript
BymaxCoreModule.forRootAsync({
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    // Your validated value, not a second copy of NODE_ENV.
    environment: config.get('APP_ENV'),
    openapi: { enabled: true }
  })
})
```

| `NODE_ENV`      | `environment` | Classified as  |
| --------------- | ------------- | -------------- |
| `production`    | `development` | **production** |
| `development`   | (anything)    | development    |
| unset, or blank | `development` | development    |
| unset, or blank | `staging`     | **production** |
| unset, or blank | unset         | **production** |

Two properties are worth reading off that table. A declaration never overrules a
process that named its own environment — the first row is the one that matters,
and it is asserted in both guards rather than in one. And the declaration enters
the same fail-closed classification, so an unrecognized name is production like
any other; this is a second **source** for the value, never a second set of
rules.

The narrowing is deliberate and worth naming rather than burying: in the one
case where the process declares nothing, the configuration a consumer bound does
decide the answer, because there is nothing else to decide it with. Replacing a
guess with a declaration is not the same as allowing an override — but it is a
real change to what the second guard depends on, and you should know it before
relying on either.

### Testing the enabled path under Jest

`applyBymaxOpenApi` loads `@nestjs/swagger` through a dynamic `import()` — that
is what keeps the peer optional for everyone who never enables the document —
and Jest's module registry cannot service a dynamic import without a flag:

```jsonc
// package.json
"scripts": {
  "test:e2e": "NODE_OPTIONS=--experimental-vm-modules jest --config jest.e2e.config.ts"
}
```

Without it, only the **enabled** case fails, with `dynamic import callback
invoked without --experimental-vm-modules`. The disabled and production cases
never reach the loader and pass either way, which is what makes the omission
confusing when you meet it.

### What the library contributes

With `includeCoreSchemas` on, the document carries the contracts this package
already serves, so an operation can `$ref` them instead of redeclaring them:

| Component                                                             | Describes                               |
| --------------------------------------------------------------------- | --------------------------------------- |
| `BymaxErrorEnvelope`, `BymaxErrorDetails`, `BymaxErrorCode`           | The error contract and its code catalog |
| `BymaxHealthResponse`, `BymaxHealthCheckEntry`                        | The liveness and readiness bodies       |
| `BymaxPageResult`, `BymaxPageMeta`, `BymaxCursorResult`               | The offset and cursor page shapes       |
| `BymaxPageQueryPage`, `BymaxPageQueryLimit`, `BymaxCursorQueryCursor` | The pagination query parameters         |

They are contributed as plain specification objects, not as decorated classes.
That is what keeps `@nestjs/swagger` genuinely optional: a decorator runs when
its class is defined, so describing these contracts with `@ApiProperty` would
load the peer in every application that imports this package, including the ones
that never enable the feature.

A contributed entry never overwrites one the document already has: if you
document your own `BymaxErrorEnvelope`, yours wins.

Contributing the schemas is only half of it — the operations **reference** them,
which is what a generated client actually reads:

- every operation gains a `default` response pointing at `BymaxErrorEnvelope`,
  because every error path in this package answers with that envelope. It is
  attached as `default` rather than guessed per status code: this package knows
  what an error looks like and does not know which statuses your handler emits.
  It follows the feature: with `envelope.enabled` off, errors are shaped by Nest
  or by your own handler, so nothing is documented;
- the health endpoints gain an explicit `200` pointing at `BymaxHealthResponse`,
  which this package _does_ know precisely, having registered them itself.

`@nestjs/swagger` emits a placeholder response for every handler — a `200` with
a description and no content — so "already documented" is judged on whether a
response declares a **shape**: one carrying `content` — or written as a bare
`$ref`, which points at a shape declared elsewhere — is yours and is left alone,
one without either gets filled in while keeping any description you wrote.

Both halves are the same switch. Referencing a schema that was not contributed
would leave a dangling `$ref`, and a document that resolves nowhere is worse
than one that says less — so `includeCoreSchemas: false` opts out of both.

### A library can describe its own routes

A library that ships controllers cannot document them itself. Decorating them
with `@nestjs/swagger` would load that peer in every application importing the
library, including the ones that never build a document — and a consumer-side
map keyed by path does not work either, because a library mounted through
`RouterModule.register` does not know its own final paths: the same route is
`/auth/login` in one deployment and `/api/v2/identity/login` in another, from one
build.

So a library marks a provider and returns fragments keyed by **handler
identity**, which survives every prefix, version and mount point:

```ts
import { BymaxOpenApiContributor } from '@bymax-one/nest-core/openapi'
import type { IOpenApiContributor, OpenApiFragment } from '@bymax-one/nest-core/openapi'

@BymaxOpenApiContributor()
@Injectable()
export class AuthOpenApi implements IOpenApiContributor {
  constructor(private readonly options: ResolvedAuthOptions) {}

  contributeOpenApi(): OpenApiFragment {
    return {
      // Required, and declared rather than inferred: a fragment crosses a
      // boundary between independently released packages, where each side
      // type-checked against its own copy.
      contractVersion: 1,
      components: {
        securitySchemes: {
          // Derived from resolved options — which is why this cannot be a
          // static map a consumer writes by hand.
          authCookie: { type: 'apiKey', in: 'cookie', name: this.options.cookies.accessTokenName },
          // Declared because the refresh operation below requires it: a
          // requirement naming an undeclared scheme fails the document build.
          refreshCookie: {
            type: 'apiKey',
            in: 'cookie',
            name: this.options.cookies.refreshTokenName
          }
        }
      },
      operations: {
        'AuthController.login': { security: [] },
        'AuthController.refresh': { security: [{ refreshCookie: [] }] }
      }
    }
  }
}
```

Nothing is wired by the application: enabling the document runs the scan, and a
library that is never imported contributes nothing.

#### What the merge guarantees

| Rule                  | Behavior                                                                                                                                                                     |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Marked, not shaped    | Only providers carrying the marker are called. A class that merely exposes `contributeOpenApi` is never touched.                                                             |
| Called once           | While the document is built, after options resolve — so a contributor may derive its contribution from its own configuration.                                                |
| Stable order          | Contributors run sorted by class name, so two libraries describing the same operation resolve the same way on every boot.                                                    |
| Data, not mutation    | A contributor returns fragments; this package decides what to write. That is what makes precedence enforceable.                                                              |
| Named failures        | A marked class that cannot contribute, one that throws, or a fragment addressing a handler the application does not have all fail the document build naming the contributor. |
| Off with the document | With `openapi.enabled` false, no contributor runs.                                                                                                                           |

**Precedence, weakest first:** what this package infers about its own routes,
then what a library contributed, then what the consumer configured, and above
all of them whatever the operation already declared — a decorated handler is the
consumer speaking directly and is never overwritten. So a deployment can always
overrule a dependency's description of its own routes through
`operationSecurity`.

**Operation ids are untouched.** This package installs an operation-id factory
to learn which handler produced which operation, and delegates the id string —
to `openapi.operationIdFactory` when you set one, to the format `@nestjs/swagger`
itself produces otherwise. A client generated from your document before adopting
this keeps working after.

**The fragment shape is translatable to an OpenAPI Overlay, deliberately.** The
[Overlay Specification](https://spec.openapis.org/overlay/v1.0.0.html) is the
OpenAPI Initiative's format for describing changes to a document, and a
contributor's fragments are that in all but notation: a handler key resolves to
an operation id, which resolves to a JSONPath target, which is what an overlay
action addresses. Overlays are not used as the mechanism — their targets are
paths, which is the one thing a library mounted through `RouterModule.register`
cannot write, and a JSONPath engine would be a runtime dependency this package
does not have. But the translation is mechanical, so a tool that emits a
library's contribution as a standalone overlay can exist the day a pipeline
wants one. No such tool ships here, and none is promised.

**Deriving the fragments is the library's business, not this package's.** A
library that wants its schemas to track its own validation decorators should
generate them in its own build or test suite, where that dependency already
exists, and commit the result — with a test asserting generated matches
committed, so drift fails in the repository that caused it. This package takes
no dependency on any validation library and merges what it is given. An
application's own DTOs need none of this: `@nestjs/swagger`'s CLI plugin already
derives them, which is a route a precompiled library does not have.

### The document describes _this_ deployment

A feature you turned off has its routes removed from the document. With
`metrics: { enabled: false }` the runtime answers `GET /metrics` with a 404
envelope — on `forRootAsync` the controller is mounted unconditionally and
guards each request, because route metadata is fixed before the async options
resolve — so a document still listing the route would describe something this
deployment does not serve. The filter reads the same resolved snapshot the
runtime guard reads, which is what keeps the two from drifting.

Your own routes are safe from it. `@nestjs/swagger` documents paths including
`app.setGlobalPrefix()`, so the match cannot be on equality — but a bare tail
match would treat `/tenants/{id}/health/live` as this package's probe and delete
it from your document. What separates the two is that a global prefix prefixes
_everything_: a tail match counts only when whatever precedes it also precedes
every other path in the document. `/api/v2` qualifies; `/tenants/{id}` does not,
because it does not prefix `/invoices`.

This package also documents the security of the three routes it owns, without
being asked:

| Route                               | Documented as                                           |
| ----------------------------------- | ------------------------------------------------------- |
| `GET /health/live`, `/health/ready` | Public (`security: []`), when a document default exists |
| `GET /metrics`, token set           | Bearer-protected                                        |
| `GET /metrics`, no token            | Public (`security: []`), when a document default exists |

The probes are polled by an orchestrator holding no credential, and the scrape
endpoint is protected exactly when you configured a token — this package owns
both the route and the option, so you should not have to restate either. Your
own `operationSecurity` entry still wins.

The last row matters more than it looks. Without a token the scrape endpoint
answers anyone, which is the deliberate "protected at the edge" arrangement — and
an open route must **say** it is open rather than inherit your document default.
Of the two ways to describe a route wrongly, this is the direction that hides:
documenting a guarded route as open fails loudly at the first generated client
that omits the credential and gets a `401`, while documenting an open route as
guarded fails nowhere at all, and hands the wrong answer to whoever opened the
document to ask what is exposed.

## 🧵 Trace correlation

Off by default. Enabled, it reads the span your instrumentation already opened
and carries its identifiers into the signals this package produces:

```typescript
BymaxCoreModule.forRoot({ telemetry: { enabled: true } })
```

| Where it lands                            | When                                                                                                                  |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `RequestTimingSample.traceId` / `.spanId` | Whenever a span is recording. Your sink forwards them to logs or wherever samples go.                                 |
| `FilterErrorContext.traceId`              | Always available to the `onUnexpectedError` seam, so a logging pipeline can record it.                                |
| The error-envelope body                   | Only with `exposeTraceId` on.                                                                                         |
| Metric labels                             | Never. A trace id is unbounded; as a label it would make the scrape endpoint the most expensive route in the service. |

This package **reads**; it never traces. It starts no span, configures no SDK,
registers no exporter, and installs no instrumentation — all of which your
collector setup already does, and doing it twice produces two spans per request.
`@opentelemetry/api` is an optional peer, loaded once at bootstrap and only when
the feature is on.

A request with nothing recording, or an all-zero span context, resolves to no
trace at all: the fields are absent rather than set to a sentinel, so a sink
never has to recognize a string of zeros.

### Publishing the id is a separate decision

`exposeTraceId` is off by default. A trace id is not a secret, but in a response
body it tells a caller that a tracing backend exists and hands them the
identifier that ties their request to everything else in that trace. Support
teams often want exactly that, which is why the option exists; it is opt-in so it
is a decision rather than a side effect. With it off, the identifiers still reach
your samples and your logs.

## 🔗 Integration with `@bymax-one/nest-logger`

Pairing this package with `@bymax-one/nest-logger` yields correlated logs and
error responses with one binding and no hard coupling: `LogContextService`
satisfies `ICorrelationIdProvider` out of the box, so `useExisting` aliases it
onto the shared token. Bind it from a `@Global()` module of your own so the
binding is visible outside the module that declares it:

```typescript
import { Global, Module } from '@nestjs/common'
import { BYMAX_CORRELATION_PROVIDER } from '@bymax-one/nest-core'
import { LogContextService, NestLoggerModule } from '@bymax-one/nest-logger'

@Global()
@Module({
  imports: [NestLoggerModule.forRoot()],
  providers: [{ provide: BYMAX_CORRELATION_PROVIDER, useExisting: LogContextService }],
  exports: [BYMAX_CORRELATION_PROVIDER]
})
export class ObservabilityModule {}
```

Every error envelope now carries the same correlation id your logs do. The
same `@Global()`-module pattern is how every pluggable token in this package
is overridden: `BYMAX_TIMING_SINK` and `BYMAX_HEALTH_INDICATORS` follow it
identically.

## 🏗️ Architecture

```
              BymaxCoreModule.forRoot / forRootAsync
                                │
                    each feature registers only if enabled
                    (off means no provider, not a disabled one)
                                │
    ┌───────────┬───────────────┼───────────────┬───────────┐
    │           │               │               │           │
 envelope/    timing/        health/       pagination/   metrics/
    │           │               │               │           │
APP_FILTER  middleware       liveness +    pure functions  Prometheus
    │           │            readiness     on their own    scrape route
    │           │               │           subpath        (opt-in)
    ▼           ▼               ▼               │             │
one JSON    one sample     BYMAX_HEALTH_        │             ▼
shape for   per request    INDICATORS           │      BYMAX_METRICS_
every       → your sink    (multi-token)        │        REGISTRY
error           │               │               │             │
    │           │               ▼               │      prom-client is
versioned   library      a rejecting or         │      imported ONLY
code        stores       slow indicator         │      while enabled
catalog     nothing      → `down`, bounded      │
    │                                           │
    ▼                                    no provider,
BYMAX_CORRELATION_PROVIDER               no module,
(the app decides where the id            usable from a
 comes from)                             script or a test
```

Four opt-in integrations attach to that spine rather than adding columns to it:

```
health/     + @BymaxHealthIndicator()   → a marked provider joins readiness
metrics/    + @BymaxMetricsContributor() → a marked provider publishes on the registry
envelope/   + telemetry                  → the active trace id reaches the envelope and the seam
timing/     + telemetry                  → the sample carries traceId and spanId
./openapi                                → one bootstrap call serves the document, in development
```

Each feature registers only when it is on. Turning metrics off does not leave a
disabled provider in the container — it leaves no provider, and `prom-client` is
never imported, which is why it can stay an optional peer. The same holds for
`@nestjs/swagger` and `@opentelemetry/api`: the release gate loads the packed
tarball and fails if any of the three is reachable with its feature off.

Nothing here holds state across requests. The timing middleware emits and forgets;
the health service runs the indicators the app registered and folds their results;
the pagination helpers are functions of their arguments.

### Design Principles

| Principle                          | Description                                                                                                                                                               |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🎭 **One shape for every failure** | The filter's job is to make a client's error handling independent of which service failed and how. An unknown error becomes a generic 500 with a code, not a leaked stack |
| 🔌 **Enabled means registered**    | A feature that is off registers no provider at all, which is what lets `prom-client` remain an optional peer instead of an always-installed one                           |
| 🧮 **Pure where it can be**        | Pagination is functions on their own subpath — no provider, no module, no container. A script can use it                                                                  |
| 🧊 **Zero runtime dependencies**   | `dependencies` is `{}`. Every version you install is one you chose                                                                                                        |
| 🩺 **A probe cannot hang**         | The aggregator converts a rejecting or slow indicator to `down` itself, so an indicator implementation never needs to guard its own timeout                               |
| 🧬 **Explicit DI tokens**          | Tokens are `Symbol()`, so no string token can collide with them, and every injectable constructor parameter is decorated explicitly                                       |

---

## 🔐 Security Model

This library writes the response a client sees when something fails, and exposes the
endpoints an operator scrapes. Its security contract is about what those two surfaces
disclose.

### An error envelope is an exfiltration surface

The filter's job is to make every failure look the same to a client, so an unknown error
becomes a generic 500 whose body carries the code, the correlation id and nothing else. The
original message and stack are captured for your logger, not for the response.
`envelope.exposeInternals` puts them in the body and exists for local debugging — its own
documentation says never to enable it in production, and it defaults to `false`.

### The readiness response names the failure, it does not describe it

A failing indicator produces `{ name, status: 'down' }` and nothing else. The reason goes
to the logger.

That split is deliberate. Readiness is usually unauthenticated and reachable by whatever
probes it, and an indicator rarely authors its own failure text — it writes
`await this.redis.ping()` and lets the driver's error propagate. Driver errors carry hosts,
ports, and in the case of a connection string, credentials. Putting that text in the
response publishes it to everyone who can reach the endpoint; putting it in the log keeps
it where access is already controlled, without losing the diagnostic.

`health.exposeIndicatorErrors` puts the message back in the response for local debugging.
It defaults to `false`, and its documentation says the same thing `envelope.exposeInternals`
does: never enable it in production. The two options are the same decision, made the same
way, about the same risk.

What reaches the log is bounded the same way it always was: the top-level `Error#message`
only — never the raw error, its stack, or a nested cause — truncated at 300 characters.
A slow indicator is converted to `down` by the aggregator rather than hanging the probe,
and its `timedOutAfterMs` stays in the response either way, because that number is one this
library chose rather than text an indicator produced.

### A metric an attack cannot be seen in is not a control

Request timing is counted as a security signal, not a performance one. A
credential-stuffing run is a flood of `401`s, a privilege probe a flood of
`403`s, route enumeration a flood of `404`s, and a rate limiter doing its job a
flood of `429`s. None of those reaches a handler, so a recorder placed after the
guards sees none of them — and an operator watching a flat error graph concludes
nothing is happening. The recorder is middleware for that reason, and every
closed request is counted whatever ended it.

### A route label is attacker-controlled input

The label on a timing sample comes from the matched route **template**, and a
request that matched nothing is recorded under the single constant
`UNMATCHED_ROUTE` (`<unmatched>`) rather than the path that was asked for.
Following the path would let anyone mint one Prometheus time series per probe:
a scan would grow the registry without bound, make the scrape endpoint the most
expensive route in the service, and end as an out-of-memory kill. The bound is
why the unmatched case is a fixed string and not a fallback to the URL.

### Cursors are opaque, not secret

`encodeCursor` produces a token a client can round-trip; it is not encrypted and not
authenticated. Do not put anything in a cursor that the client is not allowed to read, and
do not treat a cursor as proof of anything.

### The metrics endpoint is a route like any other

It is off by default. When it is on, nothing in this library authenticates it — apply the
guard you would apply to any internal endpoint, or keep it off the public listener.

### The OpenAPI document does not exist in production

A published document is a map of every route, parameter and error shape an application has —
useful to a developer, and just as useful to anyone probing the service. So unlike the metrics
endpoint, it is not left to a guard: it is refused outright whenever the runtime is not
positively `development` or `test`, in two independent layers. **`NODE_ENV` cannot be
overridden** — with it set to anything, no option serves the document in a runtime it named
production. A runtime that declares nothing is classified from the application's own
[`environment`](#environment) when it supplied one, and counts as production otherwise, because
the deployment nobody configured is the one most likely to be exposed.

---

## 🛡️ Security Table

| Layer               | Implementation                                                                                                                                                                   |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Error responses     | One shape for everything; unknown errors become a generic 500                                                                                                                    |
| Internals           | Message and stack captured for logging, in the body only under `exposeInternals` (default `false`)                                                                               |
| Health output       | The response names which indicator is down and nothing more; the reason goes to the logger. `exposeIndicatorErrors` (default `false`) puts it back in the response for debugging |
| Slow indicators     | Converted to `down` by the aggregator, so a probe cannot hang on one                                                                                                             |
| Correlation         | Resolved through `BYMAX_CORRELATION_PROVIDER` — the app decides where the id comes from                                                                                          |
| Request accounting  | Every closed request is counted, including the ones a guard rejected (`401`/`403`/`429`) and the ones that matched no route (`404`), so an attack in progress moves the graph    |
| Route labels        | Taken from the matched template; an unmatched request records the constant `<unmatched>`, never the requested path, so a scan cannot grow the metric registry without bound      |
| Pagination cursors  | Opaque, not authenticated; treated as client-supplied input on the way back in                                                                                                   |
| Metrics             | Opt-in; `prom-client` never imported while it is off                                                                                                                             |
| OpenAPI             | Opt-in and development-only; refused in production by two independent guards, `@nestjs/swagger` never imported while it is off                                                   |
| Discovered checks   | Matched by an explicit marker, never by shape; off by default, because it lets an imported library fail your readiness probe                                                     |
| Contributed metrics | Called only when marked; a name collision fails the boot naming the contributor rather than half-populating a scrape                                                             |
| Trace ids           | Read-only, never used as a metric label; published in a response body only under `telemetry.exposeTraceId` (default off)                                                         |
| Supply chain        | `dependencies: {}`; third-party Actions pinned by commit SHA (org-internal reusables by tag); CodeQL and OpenSSF Scorecard                                                       |

> [!IMPORTANT]
> **`exposeInternals` is a debugging switch, not a verbosity setting.** With it on,
> the body of a 500 carries the original message and stack of whatever failed —
> including anything a driver, an SDK or a template put in them.

---

## 🧱 Tech Stack

- **Runtime:** Node.js 24+
- **Framework:** NestJS 11 (`ConfigurableModuleBuilder`, `APP_FILTER`, `NestModule.configure`)
- **Peers:** `@nestjs/common ^11`, `@nestjs/core ^11`, `rxjs ^7`, `reflect-metadata ^0.2`
- **Optional peers:** `prom-client ^15` when metrics are enabled, `@nestjs/swagger ^11` when
  OpenAPI is enabled, `@opentelemetry/api ^1.9` when trace correlation is enabled — none is
  imported while its feature is off
- **Build:** tsup — ESM + CJS per subpath, with `.d.ts` _and_ `.d.cts` declarations
- **Tests:** Jest (unit + e2e over real Nest applications, Express **and** Fastify) + Stryker (mutation)
- **TypeScript:** 5.x strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), zero `any`

---

## 🧪 Testing & Quality

This library sits in the path of every request and every failure of every service that
installs it, so the suite is held to a bar beyond "the tests pass".

- ✅ **100% line coverage** — statements, branches, functions and lines, enforced as a gate
- ✅ **100% mutation score** — verified with [Stryker](https://stryker-mutator.io/) at
  `break: 95`; every killable survivor was killed by a strengthened test, with no production
  change, and the nine equivalents that no test can kill each carry their reason on the line
  they apply to ([report](./docs/mutation_testing_results.md))
- ✅ **End-to-end against real applications, on both platforms** — the filter, the middleware,
  the health and metrics routes, the served OpenAPI document, discovered indicators,
  contributed metrics and trace correlation are all exercised through a booted Nest app, not
  against mocks of it. Timing is asserted on **Express and Fastify**, because the two differ
  underneath in ways that make a passing Express suite say nothing about Fastify
- ✅ **Published-artifact gates** — `check:exports` resolves the types the way each module
  system does, `check:runtime` loads every subpath from the packed tarball in ESM and
  CommonJS, and `check:published` compiles this README's snippets against `dist/`
- ✅ **Every suppression carries its reason** — no coverage directives anywhere; each
  `// Stryker disable` in the production source names, after the `:` Stryker reads it from,
  why the mutant it silences is behaviour-preserving, and `check:mutants` proves those reasons
  parse so they reach the mutation report rather than the `Ignored using a comment` fallback

```bash
pnpm test          # unit suite
pnpm test:cov      # unit suite with the 100% coverage gate
pnpm test:e2e      # end-to-end against real Nest applications (Express and Fastify)
pnpm mutation      # Stryker mutation testing (break: 95)
pnpm typecheck     # tsc strict check
pnpm lint          # ESLint
```

---

## 📖 API Reference

Every export of every subpath, for quick lookup; each is documented in detail
in the sections above.

### `.` (root)

| Export                                                                                                                                                                                                           | Kind      | Description                                                                        |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---------------------------------------------------------------------------------- |
| `BymaxCoreModule`                                                                                                                                                                                                | class     | The dynamic module: `forRoot` and `forRootAsync`.                                  |
| `BymaxCoreModuleOptions`, `EnvelopeOptions`, `TimingOptions`, `HealthOptions`, `MetricsOptions`, `TelemetryOptions`, `OpenApiOptions`, `OpenApiServerDescriptor`, `OpenApiSecurityScheme`, `ResolvedCoreOptions` | types     | The options surface and its resolved shape.                                        |
| `OpenApiSecurityRequirement`, `OpenApiHttpMethod`, `OpenApiOperationKey`, `OperationSecurityMap`                                                                                                                 | types     | The operation-key contract a sibling library targets to ship its own security map. |
| `OpenApiOperationIdFactory`                                                                                                                                                                                      | type      | Names the operations in the generated document.                                    |
| `BYMAX_CORE_OPTIONS`, `BYMAX_CORRELATION_PROVIDER`, `BYMAX_TIMING_SINK`, `BYMAX_HEALTH_INDICATORS`, `BYMAX_HEALTH_TRANSITION_SINK`, `BYMAX_METRICS_REGISTRY`, `BYMAX_TRACE_CONTEXT`                              | tokens    | The DI tokens; see the [token table](#-di-tokens).                                 |
| `IHealthTransitionSink`, `HealthTransition`, `HealthTransitionCause`                                                                                                                                             | types     | The readiness-transition contract; also on `./health`.                             |
| `ICorrelationIdProvider`                                                                                                                                                                                         | type      | The correlation-provider contract.                                                 |
| `ITraceContextProvider`, `TraceContext`                                                                                                                                                                          | types     | The trace-context contract and the identifiers it resolves.                        |
| `BymaxExceptionFilter`                                                                                                                                                                                           | class     | The envelope exception filter.                                                     |
| `FilterErrorContext`                                                                                                                                                                                             | type      | The neutral request context passed to the filter's observability seam.             |
| `buildErrorEnvelope`                                                                                                                                                                                             | function  | Pure builder assembling an `ErrorEnvelope`.                                        |
| `ErrorEnvelope`, `ErrorDetails`, `BuildErrorEnvelopeInput`                                                                                                                                                       | types     | The envelope contract and its builder input.                                       |
| `BymaxTimingMiddleware`                                                                                                                                                                                          | class     | The request-timing middleware, applied to every route when timing is enabled.      |
| `UNMATCHED_ROUTE`                                                                                                                                                                                                | constant  | The bounded label recorded when a request matched no route (`<unmatched>`).        |
| `TimingInterceptor`                                                                                                                                                                                              | class     | Deprecated: superseded by `BymaxTimingMiddleware`, which the module registers.     |
| `ITimingSink`, `RequestTimingSample`                                                                                                                                                                             | types     | The timing-sink contract and its sample shape.                                     |
| `BYMAX_BAD_GATEWAY` … `BYMAX_VALIDATION_FAILED`                                                                                                                                                                  | constants | The full error-code catalog (see [Error envelope](#-error-envelope)).              |
| `codeForStatus`                                                                                                                                                                                                  | function  | Derives a catalog code from an HTTP status.                                        |

### `./pagination`

| Export                                                                      | Kind     | Description                                          |
| --------------------------------------------------------------------------- | -------- | ---------------------------------------------------- |
| `normalizePageQuery`, `buildPageResult`                                     | function | Offset pagination: clamp input, shape a page.        |
| `PageQuery`, `PageMeta`, `PageResult`                                       | types    | The offset query, its metadata, and the page shape.  |
| `normalizeCursorQuery`, `encodeCursor`, `decodeCursor`, `buildCursorResult` | function | Cursor pagination: clamp input, codec, shape a page. |
| `CursorQuery`, `CursorResult`                                               | types    | The cursor query and the page shape.                 |

### `./health`

| Export                            | Kind     | Description                                         |
| --------------------------------- | -------- | --------------------------------------------------- |
| `IHealthIndicator`                | type     | The pluggable indicator contract.                   |
| `HealthIndicatorResult`           | type     | The outcome of a single indicator check.            |
| `HealthCheckEntry`                | type     | One named entry in a `HealthResponse.checks` array. |
| `HealthResponse`                  | type     | The stable liveness and readiness response shape.   |
| `IHealthTransitionSink`           | type     | Receives one event per change of readiness state.   |
| `HealthTransition`                | type     | One change of state, for one check.                 |
| `HealthTransitionCause`           | type     | Why a check went down, as the aggregator sees it.   |
| `BymaxHealthIndicator`            | function | Class decorator marking a provider as discoverable. |
| `BYMAX_HEALTH_INDICATOR_METADATA` | constant | The metadata key the marker writes.                 |

### `./metrics`

| Export                               | Kind     | Description                                                  |
| ------------------------------------ | -------- | ------------------------------------------------------------ |
| `BymaxMetricsContributor`            | function | Class decorator marking a provider as a metrics contributor. |
| `BYMAX_METRICS_CONTRIBUTOR_METADATA` | constant | The metadata key the marker writes.                          |
| `IMetricsContributor`                | type     | The contract: `registerMetrics(registry)`.                   |
| `MetricsRegistry`                    | type     | The `prom-client` registry the scrape endpoint serves.       |

### `./openapi`

| Export                                                                                 | Kind                | Description                                                                    |
| -------------------------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------ |
| `applyBymaxOpenApi`                                                                    | function            | Builds and mounts the document; call it before `app.listen()`.                 |
| `OpenApiMountOutcome`                                                                  | type                | What the helper did: mounted at a path, or skipped with a reason.              |
| `OpenApiSkipReason`                                                                    | type                | Why it was skipped: `'disabled'` or `'production'`.                            |
| `BymaxOpenApiContributor`, `BYMAX_OPENAPI_CONTRIBUTOR_METADATA`                        | decorator, constant | Marks a provider as describing its own routes, and the metadata key behind it. |
| `IOpenApiContributor`, `OpenApiFragment`, `OpenApiFragmentObject`, `OpenApiHandlerKey` | types               | The contributor contract and the shape of what it returns.                     |

## 🧩 Compatibility

- Node.js `>= 24`
- NestJS `^11`
- Express and Fastify, both covered end to end. The accessors are
  framework-agnostic for path, method and status, and the module absorbs the
  two places the platforms genuinely differ: the route mount, and the fact that
  Nest runs middleware on Fastify through `@fastify/middie`, which strips the
  route metadata off the object the middleware receives.
- GraphQL and RPC execution contexts are out of scope for the error envelope and
  the request timing in this release; both pass errors and requests through
  untouched.

## 🤝 Contributing

Pull requests are welcome. Please open an issue first for significant changes.

- Read [`docs/technical_specification.md`](./docs/technical_specification.md) for architecture decisions.
- Run the full gate listed in [`CONTRIBUTING.md`](./CONTRIBUTING.md) before opening a PR.
- Conventional Commits are enforced by `commitlint.config.cjs`.

---

## 🔒 Security Policy

If you discover a security vulnerability, please **do not** open a public
issue. Instead, email us at **support@bymax.one** with details. We take
security seriously and will respond promptly. See
[`SECURITY.md`](./SECURITY.md) for the full policy.

---

## 📄 License

[MIT](./LICENSE) © [Bymax One](https://github.com/bymaxone)

---

<p align="center">
  <sub>Built with ❤️ by <a href="https://github.com/bymaxone">Bymax One</a></sub>
</p>
