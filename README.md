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
  <a href="https://github.com/bymaxone/nest-core/blob/main/docs/mutation_testing_results.md"><img src="https://img.shields.io/badge/mutation-97.86%25-brightgreen?style=flat-square&colorA=000000" alt="mutation score" /></a>
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
`prom-client` for the optional metrics endpoint — is a peer whose version you already control.

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

- ✅ **Request timing** — one sample per completed request, handed to the sink you register;
  the library stores nothing itself
- ✅ **Slow-request flag** — samples above `slowRequestThresholdMs` are marked, so a sink can
  branch without re-deriving the threshold
- ✅ **Prometheus endpoint** — opt-in scrape route over `BYMAX_METRICS_REGISTRY`;
  `prom-client` is imported only when it is enabled

### 📄 Pagination & Health

- ✅ **Offset and cursor** — `normalizePageQuery` / `buildPageResult` and
  `normalizeCursorQuery` / `buildCursorResult`, pure functions with no NestJS involvement
- ✅ **Opaque cursors** — `encodeCursor` / `decodeCursor` round-trip a token a client carries
  back, treated as untrusted input on the way in
- ✅ **Liveness and readiness** — separate endpoints, so a slow dependency fails readiness
  without restarting the pod
- ✅ **Pluggable indicators** — implement `IHealthIndicator` against a client you already own
  and register it under the `BYMAX_HEALTH_INDICATORS` multi-token

### 🧩 Developer Experience

- ✅ **Zero runtime dependencies** — `@nestjs/*`, `rxjs` and `reflect-metadata` arrive as
  peers, so you pin the versions
- ✅ **Three subpaths** — the module, plus `./pagination` and `./health` that a package can
  import without pulling the module in
- ✅ **Dual-format output** — ESM + CJS with declarations for each format, verified against
  the packed tarball on every run
- ✅ **Independent features** — each is enabled on its own; the providers for the rest are
  never registered
- ✅ **Typed end to end** — TypeScript `strict` with `exactOptionalPropertyTypes` and
  `noUncheckedIndexedAccess`; zero `any`

---

## 📦 Subpath Exports

| Subpath        | Contents                                                                                                                                                                           |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.`            | `BymaxCoreModule`, the error envelope and its code catalog, the timing interceptor, the DI tokens, and every option type                                                           |
| `./pagination` | `normalizePageQuery`, `buildPageResult`, `normalizeCursorQuery`, `buildCursorResult`, `encodeCursor`, `decodeCursor` and their types — pure functions, no NestJS provider involved |
| `./health`     | `IHealthIndicator`, `HealthResponse` and the indicator contracts, so a package that only implements an indicator does not import the module                                        |

Each subpath ships ESM and CommonJS with its own `.d.ts` and `.d.cts`, so
`require()` and `import` both resolve the declarations meant for them.

### Install

```bash
pnpm add @bymax-one/nest-core @nestjs/common @nestjs/core reflect-metadata rxjs
```

Add `prom-client` as well if you enable the metrics feature; it is an optional
peer dependency, so it is never required unless you turn metrics on:

```bash
pnpm add prom-client
```

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

### `envelope`

| Option            | Type      | Default | Description                                                                                    |
| ----------------- | --------- | ------- | ---------------------------------------------------------------------------------------------- |
| `enabled`         | `boolean` | `true`  | Registers the global exception filter.                                                         |
| `exposeInternals` | `boolean` | `false` | Includes the original message and stack of unknown errors. Development only, never production. |

### `timing`

| Option                   | Type      | Default | Description                                                                    |
| ------------------------ | --------- | ------- | ------------------------------------------------------------------------------ |
| `enabled`                | `boolean` | `true`  | Registers the request-timing interceptor.                                      |
| `slowRequestThresholdMs` | `number`  | unset   | Samples above this duration are flagged `slow: true`. Absent means never slow. |

### `health`

| Option                  | Type      | Default    | Description                                                                                                             |
| ----------------------- | --------- | ---------- | ----------------------------------------------------------------------------------------------------------------------- |
| `enabled`               | `boolean` | `true`     | Registers the health controller.                                                                                        |
| `path`                  | `string`  | `'health'` | Route prefix: `GET /<path>/live`, `GET /<path>/ready`.                                                                  |
| `indicatorTimeoutMs`    | `number`  | `5000`     | Per-indicator timeout before a check reports down.                                                                      |
| `exposeIndicatorErrors` | `boolean` | `false`    | Includes the failing indicator's message in the response under `details.error`. Never enable in production — see below. |

On `forRoot`, `enabled` and `path` are applied at module-definition time: a
disabled feature registers no controller, and a custom `path` mounts the routes.
On `forRootAsync`, options resolve after the module is defined, so the health
controller is always registered at the default path and enforces `enabled` and
the default path with a request-time guard; a disabled or custom-path async
configuration fails fast at the route rather than at boot.

### `metrics`

| Option                  | Type                     | Default     | Description                                                           |
| ----------------------- | ------------------------ | ----------- | --------------------------------------------------------------------- |
| `enabled`               | `boolean`                | `false`     | Registers the metrics controller and the registry.                    |
| `path`                  | `string`                 | `'metrics'` | Route serving the Prometheus scrape.                                  |
| `defaultLabels`         | `Record<string, string>` | `{}`        | Static labels attached to every metric.                               |
| `collectDefaultMetrics` | `boolean`                | `true`      | Collects `prom-client`'s process CPU, memory, and event-loop metrics. |

As with `health`, `enabled` and `path` register conditionally on `forRoot`. On
`forRootAsync` the metrics controller is always registered at the default path
and enforces `enabled` and the default path with a request-time guard, so a
disabled or custom-path async configuration fails fast at the route.

## 🔑 DI Tokens

Every token is a `Symbol`. `BYMAX_CORRELATION_PROVIDER` and
`BYMAX_HEALTH_INDICATORS` are consumed with `@Optional()` and are not bound by
the module: provide either from your own module to supply your own
implementation, otherwise the internal fallback in the last column applies.
`BYMAX_TIMING_SINK` and `BYMAX_METRICS_REGISTRY` behave differently on
`forRootAsync`, where options resolve after the module is defined: there the
module always binds and exports both (the timing sink as the metrics bridge or a
no-op, the registry as a guarded placeholder when metrics are off), so a
consumer `BYMAX_TIMING_SINK` override is honored on `forRoot` but shadowed on
`forRootAsync`. Follow the pattern in
[Integration with `@bymax-one/nest-logger`](#-integration-with-bymax-onenest-logger)
below.

| Token                        | Provides                              | When you do not provide one                                                                       |
| ---------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `BYMAX_CORE_OPTIONS`         | The resolved `BymaxCoreModuleOptions` | always set by the module                                                                          |
| `BYMAX_CORRELATION_PROVIDER` | `ICorrelationIdProvider`              | internal no-op (omits `correlationId`)                                                            |
| `BYMAX_TIMING_SINK`          | `ITimingSink`                         | internal no-op, or the metrics bridge when timing and metrics are both enabled                    |
| `BYMAX_HEALTH_INDICATORS`    | `IHealthIndicator[]`                  | treated as an empty indicator set                                                                 |
| `BYMAX_METRICS_REGISTRY`     | the `prom-client` `Registry`          | bound when metrics are enabled; on `forRootAsync` always registered, guarded-placeholder when off |

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

## ⏱️ Request Timing

One `RequestTimingSample` is delivered per completed request, success or
error, to whatever implements `ITimingSink`:

```typescript
export interface RequestTimingSample {
  method: string
  route: string
  statusCode: number
  durationMs: number
  slow: boolean
}
```

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
    const query = normalizePageQuery(raw, { maxLimit: 50 })
    const { rows, total } = await this.invoices.findPage(query)
    return buildPageResult(rows, total, query)
  }
}
```

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
APP_FILTER  APP_INTERCEPTOR  liveness +    pure functions  Prometheus
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

Each feature registers only when it is on. Turning metrics off does not leave a
disabled provider in the container — it leaves no provider, and `prom-client` is
never imported, which is why it can stay an optional peer.

Nothing here holds state across requests. The timing interceptor emits and forgets;
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

### Cursors are opaque, not secret

`encodeCursor` produces a token a client can round-trip; it is not encrypted and not
authenticated. Do not put anything in a cursor that the client is not allowed to read, and
do not treat a cursor as proof of anything.

### The metrics endpoint is a route like any other

It is off by default. When it is on, nothing in this library authenticates it — apply the
guard you would apply to any internal endpoint, or keep it off the public listener.

---

## 🛡️ Security Table

| Layer              | Implementation                                                                                                                                                                   |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Error responses    | One shape for everything; unknown errors become a generic 500                                                                                                                    |
| Internals          | Message and stack captured for logging, in the body only under `exposeInternals` (default `false`)                                                                               |
| Health output      | The response names which indicator is down and nothing more; the reason goes to the logger. `exposeIndicatorErrors` (default `false`) puts it back in the response for debugging |
| Slow indicators    | Converted to `down` by the aggregator, so a probe cannot hang on one                                                                                                             |
| Correlation        | Resolved through `BYMAX_CORRELATION_PROVIDER` — the app decides where the id comes from                                                                                          |
| Pagination cursors | Opaque, not authenticated; treated as client-supplied input on the way back in                                                                                                   |
| Metrics            | Opt-in; `prom-client` never imported while it is off                                                                                                                             |
| Supply chain       | `dependencies: {}`; third-party Actions pinned by commit SHA (org-internal reusables by tag); CodeQL and OpenSSF Scorecard                                                       |

> [!IMPORTANT]
> **`exposeInternals` is a debugging switch, not a verbosity setting.** With it on,
> the body of a 500 carries the original message and stack of whatever failed —
> including anything a driver, an SDK or a template put in them.

---

## 🧱 Tech Stack

- **Runtime:** Node.js 24+
- **Framework:** NestJS 11 (`ConfigurableModuleBuilder`, `APP_FILTER`, `APP_INTERCEPTOR`)
- **Peers:** `@nestjs/common ^11`, `@nestjs/core ^11`, `rxjs ^7`, `reflect-metadata ^0.2`
- **Optional peer:** `prom-client ^15` — required only when metrics are enabled
- **Build:** tsup — ESM + CJS per subpath, with `.d.ts` _and_ `.d.cts` declarations
- **Tests:** Jest (unit + e2e over a real Nest application) + Stryker (mutation)
- **TypeScript:** 5.x strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), zero `any`

---

## 🧪 Testing & Quality

This library sits in the path of every request and every failure of every service that
installs it, so the suite is held to a bar beyond "the tests pass".

- ✅ **100% line coverage** — statements, branches, functions and lines, enforced as a gate
- ✅ **97.86% mutation score** — verified with [Stryker](https://stryker-mutator.io/) at
  `break: 95`; every killable survivor was killed by a strengthened test, with no production
  change ([report](./docs/mutation_testing_results.md))
- ✅ **End-to-end against a real application** — the filter, the interceptor and the health
  routes are exercised through a booted Nest app, not against mocks of it
- ✅ **Published-artifact gates** — `check:exports` resolves the types the way each module
  system does, `check:runtime` loads every subpath from the packed tarball in ESM and
  CommonJS, and `check:published` compiles this README's snippets against `dist/`
- ✅ **Zero suppressions** — no coverage or mutation directives in the production source

```bash
pnpm test          # unit suite
pnpm test:cov      # unit suite with the 100% coverage gate
pnpm test:e2e      # end-to-end against a real Nest application
pnpm mutation      # Stryker mutation testing (break: 95)
pnpm typecheck     # tsc strict check
pnpm lint          # ESLint
```

---

## 📖 API Reference

Every export of every subpath, for quick lookup; each is documented in detail
in the sections above.

### `.` (root)

| Export                                                                                                                       | Kind      | Description                                                            |
| ---------------------------------------------------------------------------------------------------------------------------- | --------- | ---------------------------------------------------------------------- |
| `BymaxCoreModule`                                                                                                            | class     | The dynamic module: `forRoot` and `forRootAsync`.                      |
| `BymaxCoreModuleOptions`, `EnvelopeOptions`, `TimingOptions`, `HealthOptions`, `MetricsOptions`, `ResolvedCoreOptions`       | types     | The options surface and its resolved shape.                            |
| `BYMAX_CORE_OPTIONS`, `BYMAX_CORRELATION_PROVIDER`, `BYMAX_TIMING_SINK`, `BYMAX_HEALTH_INDICATORS`, `BYMAX_METRICS_REGISTRY` | tokens    | The DI tokens; see the [token table](#-di-tokens).                     |
| `ICorrelationIdProvider`                                                                                                     | type      | The correlation-provider contract.                                     |
| `BymaxExceptionFilter`                                                                                                       | class     | The envelope exception filter.                                         |
| `FilterErrorContext`                                                                                                         | type      | The neutral request context passed to the filter's observability seam. |
| `buildErrorEnvelope`                                                                                                         | function  | Pure builder assembling an `ErrorEnvelope`.                            |
| `ErrorEnvelope`, `ErrorDetails`, `BuildErrorEnvelopeInput`                                                                   | types     | The envelope contract and its builder input.                           |
| `TimingInterceptor`                                                                                                          | class     | The request-timing interceptor.                                        |
| `ITimingSink`, `RequestTimingSample`                                                                                         | types     | The timing-sink contract and its sample shape.                         |
| `BYMAX_BAD_GATEWAY` … `BYMAX_VALIDATION_FAILED`                                                                              | constants | The full error-code catalog (see [Error envelope](#-error-envelope)).  |
| `codeForStatus`                                                                                                              | function  | Derives a catalog code from an HTTP status.                            |

### `./pagination`

| Export                                                                      | Kind     | Description                                          |
| --------------------------------------------------------------------------- | -------- | ---------------------------------------------------- |
| `normalizePageQuery`, `buildPageResult`                                     | function | Offset pagination: clamp input, shape a page.        |
| `PageQuery`, `PageMeta`, `PageResult`                                       | types    | The offset query, its metadata, and the page shape.  |
| `normalizeCursorQuery`, `encodeCursor`, `decodeCursor`, `buildCursorResult` | function | Cursor pagination: clamp input, codec, shape a page. |
| `CursorQuery`, `CursorResult`                                               | types    | The cursor query and the page shape.                 |

### `./health`

| Export                  | Kind | Description                                         |
| ----------------------- | ---- | --------------------------------------------------- |
| `IHealthIndicator`      | type | The pluggable indicator contract.                   |
| `HealthIndicatorResult` | type | The outcome of a single indicator check.            |
| `HealthCheckEntry`      | type | One named entry in a `HealthResponse.checks` array. |
| `HealthResponse`        | type | The stable liveness and readiness response shape.   |

## 🧩 Compatibility

- Node.js `>= 24`
- NestJS `^11`
- Express and Fastify, through framework-agnostic accessors for path, method,
  and status. GraphQL and RPC execution contexts are out of scope for the
  error envelope and the timing interceptor in this release; both pass errors
  and requests through untouched.

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
