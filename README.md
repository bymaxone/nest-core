# @bymax-one/nest-core

Zero-dependency application foundation kit for NestJS 11: a stable error
envelope, a request-timing interceptor with a pluggable sink, framework-neutral
pagination helpers, health endpoints with a pluggable indicator contract, and
an optional Prometheus metrics endpoint. Every dependency you see below is a
peer you already control the version of; the package itself ships
`"dependencies": {}`.

[![CI](https://img.shields.io/github/actions/workflow/status/bymaxone/nest-core/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/bymaxone/nest-core/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@bymax-one/nest-core?style=flat-square)](https://www.npmjs.com/package/@bymax-one/nest-core)
[![license](https://img.shields.io/github/license/bymaxone/nest-core?style=flat-square)](./LICENSE)
[![coverage](https://img.shields.io/badge/coverage-100%25-brightgreen?style=flat-square)](https://github.com/bymaxone/nest-core/actions/workflows/ci.yml)
[![mutation score](https://img.shields.io/badge/mutation-pending-lightgrey?style=flat-square)](./docs/technical_specification.md)

## Features

- **Error envelope.** One stable JSON shape for every error an application
  returns, with a versioned code catalog. Enabled by default.
- **Request timing.** One timing sample per completed request, delivered to a
  sink you plug in. Enabled by default.
- **Pagination.** Offset and cursor helpers on the `./pagination` subpath, pure
  functions with no NestJS provider involved.
- **Health.** Liveness and readiness endpoints backed by a pluggable indicator
  contract on the `./health` subpath. Enabled by default.
- **Metrics.** An optional Prometheus scrape endpoint. Opt-in; `prom-client` is
  never imported unless you enable it.

## Install

```bash
pnpm add @bymax-one/nest-core @nestjs/common @nestjs/core reflect-metadata rxjs
```

Add `prom-client` as well if you enable the metrics feature; it is an optional
peer dependency, so it is never required unless you turn metrics on:

```bash
pnpm add prom-client
```

## Quick start

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
in the [configuration reference](#configuration-reference) below.

## Production wiring with `forRootAsync`

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

## Configuration reference

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

| Option               | Type      | Default    | Description                                            |
| -------------------- | --------- | ---------- | ------------------------------------------------------ |
| `enabled`            | `boolean` | `true`     | Registers the health controller.                       |
| `path`               | `string`  | `'health'` | Route prefix: `GET /<path>/live`, `GET /<path>/ready`. |
| `indicatorTimeoutMs` | `number`  | `5000`     | Per-indicator timeout before a check reports down.     |

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

## DI tokens

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
[Integration with `@bymax-one/nest-logger`](#integration-with-bymax-onenest-logger)
below.

| Token                        | Provides                              | When you do not provide one                                                                       |
| ---------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `BYMAX_CORE_OPTIONS`         | The resolved `BymaxCoreModuleOptions` | always set by the module                                                                          |
| `BYMAX_CORRELATION_PROVIDER` | `ICorrelationIdProvider`              | internal no-op (omits `correlationId`)                                                            |
| `BYMAX_TIMING_SINK`          | `ITimingSink`                         | internal no-op, or the metrics bridge when timing and metrics are both enabled                    |
| `BYMAX_HEALTH_INDICATORS`    | `IHealthIndicator[]`                  | treated as an empty indicator set                                                                 |
| `BYMAX_METRICS_REGISTRY`     | the `prom-client` `Registry`          | bound when metrics are enabled; on `forRootAsync` always registered, guarded-placeholder when off |

## Error envelope

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

## Request timing

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

## Pagination

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

## Health

Liveness always replies `200` with an empty checks array; readiness runs
every registered indicator concurrently and replies `200` only when every
indicator reports `up`, `503` otherwise, naming every check either way.

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

## Metrics

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

## Integration with `@bymax-one/nest-logger`

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

## API reference

Every export of every subpath, for quick lookup; each is documented in detail
in the sections above.

### `.` (root)

| Export                                                                                                                       | Kind      | Description                                                            |
| ---------------------------------------------------------------------------------------------------------------------------- | --------- | ---------------------------------------------------------------------- |
| `BymaxCoreModule`                                                                                                            | class     | The dynamic module: `forRoot` and `forRootAsync`.                      |
| `BymaxCoreModuleOptions`, `EnvelopeOptions`, `TimingOptions`, `HealthOptions`, `MetricsOptions`, `ResolvedCoreOptions`       | types     | The options surface and its resolved shape.                            |
| `BYMAX_CORE_OPTIONS`, `BYMAX_CORRELATION_PROVIDER`, `BYMAX_TIMING_SINK`, `BYMAX_HEALTH_INDICATORS`, `BYMAX_METRICS_REGISTRY` | tokens    | The DI tokens; see the [token table](#di-tokens).                      |
| `ICorrelationIdProvider`                                                                                                     | type      | The correlation-provider contract.                                     |
| `BymaxExceptionFilter`                                                                                                       | class     | The envelope exception filter.                                         |
| `FilterErrorContext`                                                                                                         | type      | The neutral request context passed to the filter's observability seam. |
| `buildErrorEnvelope`                                                                                                         | function  | Pure builder assembling an `ErrorEnvelope`.                            |
| `ErrorEnvelope`, `ErrorDetails`, `BuildErrorEnvelopeInput`                                                                   | types     | The envelope contract and its builder input.                           |
| `TimingInterceptor`                                                                                                          | class     | The request-timing interceptor.                                        |
| `ITimingSink`, `RequestTimingSample`                                                                                         | types     | The timing-sink contract and its sample shape.                         |
| `BYMAX_BAD_GATEWAY` … `BYMAX_VALIDATION_FAILED`                                                                              | constants | The full error-code catalog (see [Error envelope](#error-envelope)).   |
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

## Compatibility

- Node.js `>= 24`
- NestJS `^11`
- Express and Fastify, through framework-agnostic accessors for path, method,
  and status. GraphQL and RPC execution contexts are out of scope for the
  error envelope and the timing interceptor in this release; both pass errors
  and requests through untouched.

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the development workflow and
quality gates, and [`SECURITY.md`](./SECURITY.md) to report a vulnerability.

## License

MIT, see [`LICENSE`](./LICENSE).
