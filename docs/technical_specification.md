# @bymax-one/nest-core: Complete Technical Specification

> **Version:** 1.0.0
> **Last updated:** 2026-07-06
> **Status:** Draft for implementation
> **Type:** Public npm package (`@bymax-one/nest-core`)

---

## Table of Contents

1. [Vision and Value Proposition](#1-vision-and-value-proposition)
2. [Architecture](#2-architecture)
3. [Package Structure](#3-package-structure)
4. [Configuration API](#4-configuration-api)
5. [Error Envelope](#5-error-envelope)
6. [Request Timing](#6-request-timing)
7. [Pagination](#7-pagination)
8. [Health](#8-health)
9. [Metrics](#9-metrics)
10. [Error Code Catalog](#10-error-code-catalog)
11. [What is NOT in the package](#11-what-is-not-in-the-package)
12. [Dependencies](#12-dependencies)
13. [Quality Gates and Repository Standard](#13-quality-gates-and-repository-standard)
14. [Known Limitations](#14-known-limitations)
15. [Example Integration](#15-example-integration)
16. [Implementation Phases](#16-implementation-phases)

---

## 1. Vision and Value Proposition

### 1.1 What it is

`@bymax-one/nest-core` is the application foundation kit for NestJS 11 services. It packages the cross-cutting concerns that every production HTTP service repeats: a global exception filter with a stable JSON error envelope, request timing, offset and cursor pagination primitives, liveness and readiness health endpoints, and an optional Prometheus metrics endpoint.

Each concern is an opt-in feature behind a single dynamic module. A disabled feature registers zero providers: it consumes neither memory nor space in the NestJS container.

### 1.2 Why it exists

Without a shared foundation, every service reimplements the same bootstrap layer: an ad-hoc exception filter with a slightly different error shape, hand-rolled pagination DTOs that drift between services, copy-pasted health controllers, and a metrics setup that is wired differently in each repository. The result is N slightly incompatible error contracts and N places to patch when one of them has a bug.

`@bymax-one/nest-core` centralizes that layer in a single audited package with a documented, versioned contract. Consumers configure it, they never reimplement it.

### 1.3 Who uses it

- **NestJS applications** that want a production-grade error contract, health endpoints, and pagination out of the box
- **`@bymax-one/nest-*` consumers** that already use the sibling libraries (`nest-auth`, `nest-logger`, `nest-cache`, `nest-queue`, `nest-storage`, `nest-notification`, `nest-realtime`) and want the same configuration-over-convention experience for application plumbing
- Any Node.js 24+ project with NestJS 11+ that values a stable, typed, ORM-agnostic foundation layer

### 1.4 Distribution Model

| Aspect         | Detail                                                                                                                                         |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Registry       | Public npm (`@bymax-one/nest-core`)                                                                                                            |
| License        | MIT                                                                                                                                            |
| Runtime        | Node.js 24+                                                                                                                                    |
| Framework      | NestJS 11+                                                                                                                                     |
| Subpaths       | `.` (module + envelope + timing + telemetry) + `./pagination` + `./health` + `./metrics` + `./openapi`                                         |
| Optional peers | `prom-client` (metrics), `@nestjs/swagger` (OpenAPI), `@opentelemetry/api` (trace correlation) — each loaded only while its feature is enabled |

### 1.5 Design Principles

1. **Configuration over convention.** Everything goes through `forRoot`/`forRootAsync`. Sensible defaults when applicable.
2. **Zero opinion on environment.** The lib does not read `process.env`; the app injects the options.
3. **Opt-in features.** Envelope, timing, health, and metrics are individually switchable. Disabled features add nothing to the container.
4. **Stable contracts.** The error envelope and the health response are versioned public contracts. Breaking either is a major release.
5. **Integration by contract.** Correlation ids, timing sinks, and health indicators are interfaces bound to Symbol tokens. Any implementation satisfying the interface plugs in; no hard dependency on any sibling library.
6. **ORM-agnostic.** Pagination helpers build shapes and cursors; the consumer's repository executes the query with the persistence technology of its choice.
7. **Production-safe by default.** Unknown errors collapse to a generic 500 in production; internals are exposed only when explicitly enabled for development.
8. **Zero runtime dependencies.** Only peer dependencies; `prom-client` is an optional peer loaded lazily.

---

## 2. Architecture

### 2.1 NestJS Dynamic Module Pattern

`@bymax-one/nest-core` is a global dynamic module (`isGlobal: true` by default) built on `ConfigurableModuleBuilder`. The app imports it once in `AppModule`; the enabled features attach themselves to the request pipeline via `APP_FILTER` and, for request timing, a middleware applied in `NestModule.configure`, and the health and metrics controllers register conditionally.

```
┌────────────────────────────────────────────────────────────────┐
│                   Host Application (NestJS)                    │
│                                                                │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │              @bymax-one/nest-core module                 │  │
│  │                                                          │  │
│  │  APP_FILTER ──► BymaxExceptionFilter ──► error envelope  │  │
│  │                        │                                 │  │
│  │                ICorrelationIdProvider (token)            │  │
│  │                                                          │  │
│  │  middleware ──► BymaxTimingMiddleware ──► ITimingSink    │  │
│  │                                      │                   │  │
│  │                                      └──► metrics bridge │  │
│  │                                                          │  │
│  │  HealthController ──► IHealthIndicator[] (token)         │  │
│  │  MetricsController ──► prom-client Registry (lazy)       │  │
│  │                                                          │  │
│  │  ./pagination ──► pure helpers, no providers             │  │
│  └──────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────┘
```

### 2.2 Conditional Registration

| Feature  | Default  | When enabled registers                            | When disabled                 |
| -------- | -------- | ------------------------------------------------- | ----------------------------- |
| Envelope | enabled  | `APP_FILTER` bound to `BymaxExceptionFilter`      | nothing                       |
| Timing   | enabled  | `BymaxTimingMiddleware` applied to every route    | nothing                       |
| Health   | enabled  | `HealthController` + aggregation service          | no controller, no route       |
| Metrics  | disabled | `MetricsController` + lazy `prom-client` registry | no controller, no peer needed |

Registration rules follow the established `@bymax-one` module pattern:

- **Sync path (`forRoot`).** Options are known at module-definition time, so disabled features are simply omitted from the providers and controllers arrays.
- **Async path (`forRootAsync`).** Resolved options are not known when the module definition is built, so the `APP_FILTER` slot is always registered and gates itself inside a factory: the real implementation when the feature is enabled, a transparent pass-through otherwise. Timing needs no such slot: the middleware provider is registered unconditionally and `configure()` reads the already-resolved options to decide whether to apply it. Controllers that cannot be registered conditionally on the async path throw a descriptive configuration error if reached while disabled, and the recommended pattern for fully dynamic setups is documented in the README.

### 2.3 Request Pipeline Placement

Nest runs middleware, then guards, then interceptors, then pipes, then the handler. The recorder is middleware because everything after that point is skippable: a request a guard rejects never reaches an interceptor, and a request matching no route never reaches a controller, so an interceptor-based recorder is blind to `401`, `403`, `429` and `404` — the exact statuses that describe an attack in progress. As middleware it also measures guard time and the time spent in any middleware registered after it, which an interceptor could not see. Pipe and handler time were already covered: an interceptor wraps `next.handle()`, and pipes run inside that. The exception filter is registered as the outermost filter and formats every error that escapes the handler, including errors thrown by other filters and by the framework itself.

---

## 3. Package Structure

### 3.1 Directory Tree

```
@bymax-one/nest-core/
├── package.json
├── tsconfig*.json
├── tsup.config.ts
├── eslint.config.mjs
├── jest*.config.ts
├── stryker.config.json
├── README.md / CHANGELOG.md / LICENSE / SECURITY.md
├── CONTRIBUTING.md / CODE_OF_CONDUCT.md / CLAUDE.md / AGENTS.md
├── docs/
│   ├── technical_specification.md
│   ├── development_plan.md
│   ├── mutation_testing_plan.md
│   └── mutation_testing_results.md
├── scripts/
│   ├── check-size.mjs
│   └── dogfood-smoke-test.mjs
└── src/
    ├── index.ts                    # public barrel for the "." subpath
    ├── core.module.ts              # BymaxCoreModule (ConfigurableModuleBuilder)
    ├── core.options.ts             # BymaxCoreModuleOptions and defaults
    ├── core.tokens.ts              # Symbol DI tokens
    ├── envelope/
    │   ├── exception.filter.ts     # BymaxExceptionFilter
    │   ├── error-envelope.ts       # envelope type + builder
    │   ├── error-codes.ts          # BYMAX_* catalog
    │   └── correlation.interfaces.ts
    ├── timing/
    │   ├── timing.middleware.ts    # the recorder, applied to every route
    │   ├── timing.interceptor.ts   # deprecated, superseded by the middleware
    │   ├── timing.sample.ts        # sample builder shared by both
    │   ├── request-info.accessor.ts # method + bounded route label
    │   ├── fastify-route.bridge.ts # carries the template past @fastify/middie
    │   └── timing.interfaces.ts    # ITimingSink, RequestTimingSample
    ├── pagination/
    │   ├── index.ts                # barrel for the "./pagination" subpath
    │   ├── offset.ts               # PageQuery, PageResult, buildPageResult
    │   └── cursor.ts               # cursor codec, CursorQuery, CursorResult
    ├── health/
    │   ├── index.ts                # barrel for the "./health" subpath
    │   ├── health.controller.ts
    │   ├── health.service.ts       # indicator aggregation with timeout
    │   └── health.interfaces.ts    # IHealthIndicator, HealthIndicatorResult
    └── metrics/
        ├── metrics.controller.ts
        └── metrics.registry.ts     # lazy prom-client loading
```

### 3.2 Subpath Exports

| Subpath        | Content                                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `.`            | `BymaxCoreModule`, exception filter, timing middleware, tokens, interfaces, error codes                                  |
| `./pagination` | Offset and cursor DTOs, result builders, cursor codec                                                                    |
| `./health`     | `IHealthIndicator`, `HealthIndicatorResult`, health response types, `@BymaxHealthIndicator()`                            |
| `./metrics`    | `IMetricsContributor`, `MetricsRegistry`, `@BymaxMetricsContributor()` — the only subpath whose types name `prom-client` |
| `./openapi`    | `applyBymaxOpenApi` and its result types — the bootstrap-time OpenAPI mount                                              |

All subpaths ship ESM + CJS + `.d.ts` via tsup. Deep imports into `dist` internals are not part of the public API and are blocked by the `exports` map.

---

## 4. Configuration API

### 4.1 Options

```typescript
export interface BymaxCoreModuleOptions {
  /** Global exception filter with the stable error envelope. Default: enabled. */
  envelope?: {
    enabled?: boolean
    /**
     * When true, unknown errors include the original message and stack in the
     * envelope details. Never enable in production.
     */
    exposeInternals?: boolean
  }

  /** Request timing middleware. Default: enabled. */
  timing?: {
    enabled?: boolean
    /** Samples above this threshold are flagged as slow. Optional. */
    slowRequestThresholdMs?: number
  }

  /** Liveness and readiness endpoints. Default: enabled. */
  health?: {
    enabled?: boolean
    /** Route prefix. Default: "health" (GET /health/live, GET /health/ready). */
    path?: string
    /** Per-indicator timeout before a check is reported as down. Default: 5000. */
    indicatorTimeoutMs?: number
  }

  /** Prometheus metrics endpoint. Default: disabled. */
  metrics?: {
    enabled?: boolean
    /** Route. Default: "metrics". */
    path?: string
    /** Static labels added to every metric. */
    defaultLabels?: Record<string, string>
    /** Collect prom-client default process metrics. Default: true when enabled. */
    collectDefaultMetrics?: boolean
    /**
     * Bearer required to scrape. Unset (the default) leaves the endpoint open, to
     * be protected at the edge. When set, a request must carry
     * `Authorization: Bearer <token>` (scheme matched case-insensitively, token
     * compared in constant time). Empty or whitespace-only is rejected at boot.
     */
    authToken?: string
  }
}
```

### 4.2 Registration

```typescript
// Sync
BymaxCoreModule.forRoot({
  envelope: { enabled: true },
  timing: { enabled: true, slowRequestThresholdMs: 1000 },
  health: { enabled: true },
  metrics: { enabled: false }
})

// Async (the standard pattern in real applications)
BymaxCoreModule.forRootAsync({
  inject: [APP_CONFIG],
  useFactory: (config: AppConfig): BymaxCoreModuleOptions => ({
    envelope: { exposeInternals: config.env === 'development' },
    metrics: { enabled: config.env === 'production' }
  })
})
```

`isGlobal` is a module extra (default `true`) mapped to `DynamicModule.global` through the builder's `setExtras`, following the NestJS 11 convention.

### 4.3 DI Tokens

All tokens are `Symbol`s. String tokens are not used anywhere in the package.

| Token                          | Provides                          | Default binding                    |
| ------------------------------ | --------------------------------- | ---------------------------------- |
| `BYMAX_CORE_OPTIONS`           | Resolved `BymaxCoreModuleOptions` | consumer configuration             |
| `BYMAX_CORRELATION_PROVIDER`   | `ICorrelationIdProvider`          | no-op (returns `undefined`)        |
| `BYMAX_TIMING_SINK`            | `ITimingSink`                     | no-op                              |
| `BYMAX_HEALTH_INDICATORS`      | `IHealthIndicator[]`              | empty array                        |
| `BYMAX_HEALTH_TRANSITION_SINK` | `IHealthTransitionSink`           | none; transitions go to the logger |
| `BYMAX_METRICS_REGISTRY`       | `prom-client` `Registry`          | lazy, only when enabled            |
| `BYMAX_TRACE_CONTEXT`          | `ITraceContextProvider`           | no-op when telemetry is off        |

Consumers override a default by providing the token in their own module:

```typescript
@Module({
  providers: [
    {
      provide: BYMAX_CORRELATION_PROVIDER,
      useExisting: LogContextService // from @bymax-one/nest-logger
    }
  ]
})
export class ObservabilityModule {}
```

---

## 5. Error Envelope

### 5.1 Contract

Every error that leaves the application has this exact shape. The contract is versioned with the package: adding an optional field is a minor release, changing or removing a field is a major release.

```json
{
  "statusCode": 404,
  "code": "BYMAX_NOT_FOUND",
  "message": "Invoice inv_123 was not found",
  "details": [{ "field": "id", "issue": "unknown identifier" }],
  "correlationId": "8f14e45f-ceea-4677-a9de-6ec3f1f0a1b2",
  "timestamp": "2026-07-06T12:00:00.000Z",
  "path": "/invoices/inv_123"
}
```

| Field           | Type              | Presence | Notes                                        |
| --------------- | ----------------- | -------- | -------------------------------------------- |
| `statusCode`    | number            | always   | HTTP status                                  |
| `code`          | string            | always   | Stable machine-readable code (see §10)       |
| `message`       | string            | always   | Human-readable, safe for end users           |
| `details`       | array or object   | optional | Structured context (validation issues, etc.) |
| `correlationId` | string            | optional | Present when a correlation provider is bound |
| `timestamp`     | string (ISO 8601) | always   | Time the error was formatted                 |
| `path`          | string            | always   | Request URL path                             |

### 5.2 Mapping Rules

1. **`HttpException` and subclasses.** Status and message are taken from the exception. If the exception response object carries a `code` property, it is passed through; otherwise the code is derived from the status (§10).
2. **Validation errors.** Exceptions carrying an array of constraint violations (the `BadRequestException` shape produced by validation pipes) are translated into `code: BYMAX_VALIDATION_FAILED` with one structured entry per violation in `details`.
3. **Unknown errors.** Anything else becomes `statusCode: 500`, `code: BYMAX_INTERNAL_ERROR`, and the fixed message `"Internal server error"`. The original error is never serialized into the response unless `envelope.exposeInternals` is true, which is intended for development only. The filter always hands the original error to the correlation-aware logging pipeline before collapsing it.

### 5.3 Correlation Id Integration

```typescript
export interface ICorrelationIdProvider {
  /** Returns the correlation id for the current execution context, if any. */
  getCorrelationId(): string | undefined
}
```

The filter resolves `BYMAX_CORRELATION_PROVIDER` and stamps the result into the envelope. The default binding is a no-op. The `LogContext` service of `@bymax-one/nest-logger` (AsyncLocalStorage-based) satisfies this interface out of the box, so pairing the two libraries yields correlated logs and error responses with one `useExisting` provider and no hard coupling.

---

## 6. Request Timing

### 6.1 Behavior

The middleware captures a monotonic start time before the rest of the chain runs and records a sample when the connection closes — `'close'` rather than `'finish'`, so a client that hangs up mid-response is counted rather than dropped:

```typescript
export interface RequestTimingSample {
  method: string // "GET"
  route: string // "/invoices/:id" (route template, not the raw URL)
  statusCode: number // final status, including error statuses
  durationMs: number // wall-clock duration, monotonic clock
  slow: boolean // true when above slowRequestThresholdMs
}

export interface ITimingSink {
  /** Receives one sample per closed request, however it ended. Should not fail. */
  record(sample: RequestTimingSample): void
}
```

Design decisions:

- The route template is used instead of the raw URL to keep cardinality bounded for downstream metric sinks. A request that matched no route records the fixed `UNMATCHED_ROUTE` label (`<unmatched>`): the raw path is attacker-controlled, and following it would let a scanner mint one time series per probe.
- One sample per request, and exactly one. The middleware replaced `TimingInterceptor` as the recorder rather than joining it, because two recorders double every rate an alert is tuned against — a silent failure worse than the under-counting being fixed.
- The trace lookup reads the live context at emit time first and falls back to a context captured with `AsyncResource.bind` when the live one holds nothing. Neither alone is enough, measured against a registered `AsyncLocalStorageContextManager`: the live read resolves a span opened by instrumentation registered as Nest middleware — which runs _after_ this middleware — but resolves nothing on an aborted request, where `'close'` is emitted from a socket whose async resource predates the request; the captured context is the mirror image, resolving an upstream span on both paths and a downstream one on neither. The `'close'` listener itself is therefore deliberately **not** bound; only the fallback reader is.
- The sink contract is fire-and-forget. A failing sink is caught and silenced by the recorder; timing must never break a request. Both ways it can fail are absorbed: a synchronous throw, and a rejection from an `async record()` — which compiles despite the `void` return type, because TypeScript accepts any return value in a void-returning position. An escaping rejection would be unhandled, able to kill the process under `--unhandled-rejections=strict`, which is the observer breaking what it observes. Delivery is one shared implementation rather than one per recorder: the guarantee is worth as much as its least careful copy.
- The default sink is a no-op. Documented example implementations: forwarding to a structured logger, and the built-in metrics bridge (§9.3).

---

## 7. Pagination

Pure, provider-free primitives exported from the `./pagination` subpath. No decorators from validation libraries are attached: the helpers normalize and clamp raw input, and consumers who validate with their preferred stack (Zod, class-validator) can layer that on top.

### 7.1 Offset Pagination

```typescript
export interface PageQuery {
  page: number // 1-based
  limit: number
}

/** Clamps raw input into a safe PageQuery: page >= 1, 1 <= limit <= maxLimit. */
export function normalizePageQuery(
  raw: { page?: unknown; limit?: unknown },
  options?: { defaultLimit?: number; maxLimit?: number }
): PageQuery

export interface PageMeta {
  page: number
  limit: number
  totalItems: number
  totalPages: number
}

export interface PageResult<T> {
  items: T[]
  meta: PageMeta
}

export function buildPageResult<T>(items: T[], totalItems: number, query: PageQuery): PageResult<T>
```

Defaults: `defaultLimit = 20`, `maxLimit = 100`. Both are per-call options, not module state.

### 7.2 Cursor Pagination

Cursors are opaque `base64url` strings encoding a JSON payload. Consumers never parse a cursor manually; the codec is the contract.

```typescript
/** Encodes an ordered key set into an opaque cursor. */
export function encodeCursor(payload: Record<string, string | number>): string

/**
 * Decodes a cursor produced by encodeCursor.
 * Throws a BYMAX_VALIDATION_FAILED HttpException on malformed input.
 */
export function decodeCursor<T extends Record<string, string | number>>(cursor: string): T

export interface CursorQuery {
  cursor?: string
  limit: number
}

export function normalizeCursorQuery(
  raw: { cursor?: unknown; limit?: unknown },
  options?: { defaultLimit?: number; maxLimit?: number }
): CursorQuery

export interface CursorResult<T> {
  items: T[]
  /** null when there is no further page. */
  nextCursor: string | null
}

export function buildCursorResult<T>(
  items: T[],
  limit: number,
  toCursor: (lastItem: T) => Record<string, string | number>
): CursorResult<T>
```

`buildCursorResult` implements the fetch-one-extra convention: the repository queries `limit + 1` rows; the helper trims the extra row and derives `nextCursor` from the last returned item.

### 7.3 ORM Neutrality

The package never generates SQL, never imports an ORM, and never assumes a specific store. The helpers shape queries and results; the consumer's repository translates `PageQuery`/`CursorQuery` into its own persistence calls.

---

## 8. Health

### 8.1 Endpoints

| Route               | Purpose                                                 | Success | Failure               |
| ------------------- | ------------------------------------------------------- | ------- | --------------------- |
| `GET /health/live`  | Liveness: the process is up and the event loop responds | 200     | (unreachable process) |
| `GET /health/ready` | Readiness: every registered indicator reports `up`      | 200     | 503                   |

Response contract (stable, versioned with the package):

```json
{
  "status": "ok",
  "checks": [
    { "name": "redis", "status": "up", "details": { "latencyMs": 2 } },
    { "name": "database", "status": "up" }
  ]
}
```

`status` is `"ok"` when all checks are `up`, `"error"` otherwise. Liveness returns `{ "status": "ok", "checks": [] }` and runs no indicators.

### 8.2 Indicator Contract

```typescript
export interface HealthIndicatorResult {
  status: 'up' | 'down'
  details?: Record<string, unknown>
}

export interface IHealthIndicator {
  /** Unique name reported in the checks array. */
  readonly name: string
  /** Performs the check. Rejections and timeouts are reported as down. */
  check(): Promise<HealthIndicatorResult>
}
```

Consumers register indicators by providing the multi-token:

```typescript
@Injectable()
export class RedisHealthIndicator implements IHealthIndicator {
  public readonly name = 'redis'

  public constructor(@Inject(BYMAX_CACHE_SERVICE) private readonly cache: CacheService) {}

  public async check(): Promise<HealthIndicatorResult> {
    const start = performance.now()
    await this.cache.ping()
    return { status: 'up', details: { latencyMs: Math.round(performance.now() - start) } }
  }
}
```

The aggregation service runs all indicators concurrently, applies `indicatorTimeoutMs` per indicator, and converts rejections and timeouts into `down` entries with a diagnostic detail. One failing indicator never hides the results of the others.

### 8.3 Transition Reporting

The aggregator holds the last state of every check and reports each **change** — never once per probe.

```typescript
export type HealthTransitionCause =
  | { readonly kind: 'rejected'; readonly message: string }
  | { readonly kind: 'reported-down' }
  | { readonly kind: 'timed-out'; readonly timeoutMs: number }

export type HealthTransition =
  | { readonly name: string; readonly isUp: true }
  | { readonly name: string; readonly isUp: false; readonly cause: HealthTransitionCause }

export interface IHealthTransitionSink {
  record(transition: HealthTransition): void
}
```

This exists because a readiness failure can otherwise leave no record an operator reads. Probe paths are the highest-volume request a backend serves, so they are typically excluded from the HTTP log surface, and a well-written indicator returns `{ status: 'down' }` rather than throwing — because readiness is usually unauthenticated and a driver's error carries hosts, ports and sometimes credentials. Of the three ways to be down, only a rejection was ever logged, and that one was logged on every probe.

Three decisions are load-bearing:

1. **The de-duplication rule lives in the aggregator, not in the sink.** A readiness check runs every few seconds, so a line per failing probe buries the one carrying the cause. Leaving the rule to each consumer means every backend re-deriving it slightly differently; a sink that never sees raw outcomes cannot get it wrong.
2. **`timed-out` is knowledge only the aggregator has.** An indicator it abandoned is never told, so it reports nothing, and a consumer racing its own timer beneath `indicatorTimeoutMs` still never learns the bound that applied. The obstacle for a consumer is information, not effort.
3. **The first observation is asymmetric.** Failing is reported — a process booting against a dependency already down would otherwise look healthy in the log forever — while healthy is not, since that would write a line per dependency on every boot.

Outcomes are ordered by the probe that started them, not by the one that finished first: readiness is reached concurrently, and a dependency hanging until the bound elapses is exactly what makes an earlier probe finish last. Comparing states alone would report the recovery and then re-report the outage behind it on stale evidence.

Binding a sink stands the aggregator's own logger line down, since both destinations are usually the same logger and two records of one transition is the noise the feature removes.

### 8.4 Why not @nestjs/terminus

Terminus is a capable library, but it brings its own indicator ecosystem and transitive surface. This package keeps the zero-dependency philosophy: the readiness aggregator is a small, fully tested implementation, and the `IHealthIndicator` contract is trivial to implement against any client the application already owns.

---

## 9. Metrics

### 9.1 Behavior

Disabled by default. When enabled, the module exposes a Prometheus text-format endpoint (default `GET /metrics`) backed by a dedicated `prom-client` `Registry` bound to `BYMAX_METRICS_REGISTRY`.

### 9.2 Optional Peer Loading

`prom-client` is declared as an **optional** peer dependency (`peerDependenciesMeta`). It is loaded lazily inside the registry factory, only when `metrics.enabled` is true:

- Consumers that never enable metrics do not install `prom-client` and pay zero cost.
- Enabling metrics without the peer installed fails fast at boot with a descriptive error naming the missing package and the install command.

### 9.3 Default HTTP Metrics

When metrics and timing are both enabled, the module binds an internal `ITimingSink` bridge that feeds two metrics with bounded label sets (`method`, `route`, `status_code`):

| Metric                          | Type      | Source                   |
| ------------------------------- | --------- | ------------------------ |
| `http_requests_total`           | counter   | one increment per sample |
| `http_request_duration_seconds` | histogram | `durationMs / 1000`      |

`collectDefaultMetrics` (process CPU, memory, event loop lag) is on by default when metrics are enabled. Applications register custom metrics against the injected registry.

---

## 10. Error Code Catalog

Codes are stable strings under the `BYMAX_` prefix. Derivation from HTTP status applies when the thrown exception does not carry an explicit `code`.

| HTTP status            | Code                           |
| ---------------------- | ------------------------------ |
| 400                    | `BYMAX_BAD_REQUEST`            |
| 400 (validation shape) | `BYMAX_VALIDATION_FAILED`      |
| 401                    | `BYMAX_UNAUTHORIZED`           |
| 403                    | `BYMAX_FORBIDDEN`              |
| 404                    | `BYMAX_NOT_FOUND`              |
| 409                    | `BYMAX_CONFLICT`               |
| 413                    | `BYMAX_PAYLOAD_TOO_LARGE`      |
| 415                    | `BYMAX_UNSUPPORTED_MEDIA_TYPE` |
| 422                    | `BYMAX_UNPROCESSABLE_ENTITY`   |
| 429                    | `BYMAX_TOO_MANY_REQUESTS`      |
| 500                    | `BYMAX_INTERNAL_ERROR`         |
| 501                    | `BYMAX_NOT_IMPLEMENTED`        |
| 502                    | `BYMAX_BAD_GATEWAY`            |
| 503                    | `BYMAX_SERVICE_UNAVAILABLE`    |
| 504                    | `BYMAX_GATEWAY_TIMEOUT`        |
| other 4xx              | `BYMAX_CLIENT_ERROR`           |
| other 5xx              | `BYMAX_INTERNAL_ERROR`         |

Domain-specific codes are the application's responsibility: throw an `HttpException` whose response object includes a `code` property and the filter passes it through verbatim. The `BYMAX_` prefix is reserved for codes emitted by this package.

---

## 11. What is NOT in the package

| Concern                                 | Where it belongs                        |
| --------------------------------------- | --------------------------------------- |
| Authentication, authorization, sessions | `@bymax-one/nest-auth`                  |
| Logging engine, transports, redaction   | `@bymax-one/nest-logger`                |
| Caching, Redis access                   | `@bymax-one/nest-cache`                 |
| Queues and background jobs              | `@bymax-one/nest-queue`                 |
| Rate limiting                           | application middleware or gateway       |
| Internationalization                    | application layer                       |
| ORM, repositories, persistence          | consumer application                    |
| Distributed tracing SDK                 | OpenTelemetry, wired by the application |

---

## 12. Dependencies

### 12.1 Peer Dependencies

```json
{
  "peerDependencies": {
    "@nestjs/common": "^11.0.16",
    "@nestjs/core": "^11.1.18",
    "reflect-metadata": "^0.2.0",
    "rxjs": "^7.0.0",
    "prom-client": "^15.0.0",
    "@nestjs/swagger": "^11.0.0",
    "@opentelemetry/api": "^1.9.0"
  },
  "peerDependenciesMeta": {
    "prom-client": { "optional": true },
    "@nestjs/swagger": { "optional": true },
    "@opentelemetry/api": { "optional": true }
  },
  "dependencies": {}
}
```

- `dependencies` stays empty. The consumer controls every version.
- The NestJS peers are required: package managers do not auto-install optional peers, and the server subpath cannot resolve without them.
- The same versions are mirrored in `devDependencies` so the package builds and tests in isolation.
- Both optional peers are reached exclusively through a lazy dynamic import inside a single loader each, so a consumer who leaves the corresponding feature disabled never resolves the module. `@nestjs/swagger` belongs in a consumer's `devDependencies`: the document is never served in production.

### 12.2 Engines

```json
{ "engines": { "node": ">=24.0.0" } }
```

### 12.3 Injection Discipline

Every provider constructor parameter and every factory `inject` entry uses an explicit `@Inject(token)` with a `Symbol` token. The published bundle is built without `emitDecoratorMetadata`, so implicit class-type injection is not part of the design at any layer.

---

## 13. Quality Gates and Repository Standard

### 13.1 Test Gates

| Gate                   | Tool                             | Threshold                                                            |
| ---------------------- | -------------------------------- | -------------------------------------------------------------------- |
| Coverage               | Jest                             | 100% line/branch/function/statement, enforced in both jest configs   |
| Mutation (pre-release) | Stryker                          | `high: 99, low: 95, break: 95`                                       |
| Bundle size            | `scripts/check-size.mjs`         | Budgets in KiB brotli per subpath, calibrated to the real artifact   |
| Packaging              | `scripts/dogfood-smoke-test.mjs` | Every subpath imports cleanly in ESM and CJS from the packed tarball |

Every `it()` carries a block comment stating the scenario and the rule it protects. Provisional bundle budgets at scaffold time: `.` 10 KiB, `./pagination` 3 KiB, `./health` 4 KiB (brotli), to be recalibrated once the first real artifact exists.

### 13.2 Repository Standard

- `README.md` with badges (CI, coverage, mutation score, npm version, license), `LICENSE` (MIT), `SECURITY.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1 by reference)
- `.github/workflows/`: `ci` (lint, typecheck, build, test, size), `codeql`, `scorecard`, `release` (npm publish with OIDC `--provenance`), plus `dependabot.yml` and issue templates
- CodeQL and OpenSSF Scorecard activate once the repository is public; the workflows ship conditionally enabled from day one
- Local governance: husky (`pre-commit` running lint-staged, `commit-msg` running commitlint), Conventional Commits enforced locally and in CI
- ESLint flat config with the shared restricted-import rules (bare `crypto`, `bcrypt`, `argon2`, `uuid`, `nanoid`, `crypto-js` are banned; `node:` builtins are the only cryptography and id source)

---

## 14. Known Limitations

1. **HTTP-first.** The exception filter and request timing target HTTP execution contexts. GraphQL and RPC contexts are pass-through in the initial release; dedicated mappers may arrive in a later minor.
2. **Express and Fastify.** Both official NestJS platforms are supported through framework-agnostic accessors, and both are covered end to end; anything beyond `path`, `method`, and status handling is out of scope. The two are not symmetric underneath, and the module absorbs the difference: Nest runs middleware on Fastify through `@fastify/middie`, which invokes it with the raw `IncomingMessage` carrying no route metadata, so an `onRequest` hook carries the resolved template across; and `forRoutes('/')` is a mount on Express but an exact match on Fastify, so the mount is selected from `httpAdapter.getType()`.
3. **No metric persistence.** The metrics endpoint exposes the in-process registry; aggregation across replicas is the scraper's job.
4. **Cursor payload discipline.** Cursors are opaque but not encrypted or signed. They must never contain sensitive data; they encode ordering keys only.
5. **Readiness is not a dependency graph.** Indicators run flat and concurrently; there is no cascading or dependency ordering between checks.
6. **Metrics contribution shares the metrics gate.** A contributor runs only when the metrics feature is enabled, and there is no separate flag for it: an application that wants the scrape endpoint wants what its libraries publish on it. Contributors run at bootstrap, sorted by class name, and a registration failure fails the boot with the contributor named.
7. **Discovery sees only instantiated, class-based providers.** A `useValue` or `useFactory` provider carries no class to mark, and a request-scoped provider has no instance at bootstrap; both cases keep using explicit registration under `BYMAX_HEALTH_INDICATORS`. On the asynchronous registration path `DiscoveryModule` is imported unconditionally, because imports cannot be decided after the module is defined; nothing runs unless the resolved options enable discovery.
8. **Trace correlation is read-only and HTTP-first.** This package reads the active span; it never starts one, configures an SDK, or registers an exporter. Identifiers reach the timing sample and the filter's observability seam whenever telemetry is enabled, and the response body only under `telemetry.exposeTraceId`. They are never used as metric labels: a trace id is unbounded.
9. **The OpenAPI document is development-only, and mounting it is order-sensitive.** It is refused outright whenever the runtime is not positively `development` or `test`, in two independent layers, with no override. `applyBymaxOpenApi` must run before `app.listen()`: mounting re-registers routes on the HTTP adapter, and doing that against an already-initialized Express 5 application replaces the router, so every other route stops resolving. Both layers classify from the same two inputs — `NODE_ENV`, and the `environment` the application declared — with `NODE_ENV` winning whenever it names anything, so no configured value serves the document in a runtime that identified itself as production. The declaration is read only where the process declares nothing, which was previously guessed as production. The full design lives in `docs/specs/optional-integrations.md`.
10. **Every route this package owns states its own security, including when it is open.** The health probes and an unprotected scrape endpoint both carry an explicit `security: []` wherever a document-level default exists, rather than inheriting it. An open route inheriting a default would be documented as requiring a credential it does not check — the failure that hides, since documenting a guarded route as open fails loudly at the first client that omits the credential, while documenting an open route as guarded fails nowhere and misinforms whoever reads the document to ask what is exposed.
11. **An operation left requiring nothing is reported, never refused.** When the served document declares no top-level `security`, at least one other operation does state a requirement, and the operation is not one this package registers, the build names it once in the boot log. An API that is public on purpose is a legitimate configuration, so this warns and never throws — and the trigger is narrow because a line that fires on every legitimate deployment is a line nobody reads. The shape it cannot report follows from the second condition and is permanent: with no requirement stated anywhere, the document is indistinguishable from a deliberately public one to anything reading only the rendered document. That limit belongs to document-only checks, not to the consumer, whose own suite knows the intent and can assert it.

---

## 15. Example Integration

```typescript
import { Controller, Get, Inject, Module, Query } from '@nestjs/common'
import { BymaxCoreModule, BYMAX_CORRELATION_PROVIDER } from '@bymax-one/nest-core'
import {
  buildPageResult,
  normalizePageQuery,
  type PageResult
} from '@bymax-one/nest-core/pagination'
import type { IHealthIndicator } from '@bymax-one/nest-core/health'

@Module({
  imports: [
    BymaxCoreModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        envelope: { exposeInternals: config.env === 'development' },
        timing: { slowRequestThresholdMs: 1_000 },
        health: { indicatorTimeoutMs: 3_000 },
        metrics: { enabled: config.env === 'production' }
      })
    })
  ],
  providers: [
    // Correlated error responses: reuse the logger's request context.
    { provide: BYMAX_CORRELATION_PROVIDER, useExisting: LogContextService },
    // Readiness: report Redis health through the shared indicator token.
    { provide: BYMAX_HEALTH_INDICATORS, useClass: RedisHealthIndicator, multi: true }
  ]
})
export class AppModule {}

@Controller('invoices')
export class InvoiceController {
  public constructor(@Inject(INVOICE_REPOSITORY) private readonly invoices: IInvoiceRepository) {}

  @Get()
  public async list(@Query() raw: Record<string, unknown>): Promise<PageResult<InvoiceDto>> {
    const query = normalizePageQuery(raw, { maxLimit: 50 })
    const { rows, total } = await this.invoices.findPage(query)
    return buildPageResult(rows, total, query)
  }
}
```

Result: every error from this application already follows the envelope contract, request durations flow to the configured sink, `/health/ready` reflects Redis, and production replicas expose `/metrics` for scraping. None of that logic lives in the application.

---

## 16. Implementation Phases

High-level build order (each stage lands fully tested before the next starts):

1. **Scaffolding**: package skeleton, tsup subpaths, jest configs, CI, repository standard files.
2. **Error envelope**: filter, envelope builder, code catalog, correlation contract.
3. **Request timing**: middleware, sink contract, slow-request flagging.
4. **Pagination**: offset and cursor primitives with the codec.
5. **Health**: indicator contract, aggregation service, controller.
6. **Metrics**: lazy registry, endpoint, timing bridge.
7. **Hardening and release**: mutation testing to threshold, bundle budget calibration, dogfood smoke test, first public release.
