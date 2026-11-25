<p align="center">
  <img src="https://img.shields.io/badge/%40bymax--one-nest--core-000000?style=for-the-badge&logo=nestjs&logoColor=E0234E" alt="@bymax-one/nest-core" />
</p>

<h1 align="center">@bymax-one/nest-core</h1>

<p align="center">
  <strong>Zero-dependency application foundation kit for NestJS</strong><br />
  <sub>Error Envelope · Request Timing · Offset &amp; Cursor Pagination · Health Probes · Prometheus Metrics · HTTP Floors · Zero Runtime Dependencies</sub>
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

`@bymax-one/nest-core` is the layer every NestJS service ends up writing for itself: one error
shape, one timing sample, one pagination contract, one health probe, one metrics endpoint.
Writing it per service is how services end up answering the same failure differently, and how a
client integration breaks when one of them changes its error body.

It ships `"dependencies": {}`. Everything it touches — NestJS, `rxjs`, `reflect-metadata`, and
the optional peers behind the features that need them (`prom-client`, `@nestjs/swagger`,
`@opentelemetry/api`, `helmet`) — is a peer whose version you already control. A feature you
leave off never loads its peer, which the release gate asserts against the packed tarball.

### Why nest-core?

- **One error shape.** A versioned code catalog and a fixed envelope, so a client writes one
  error handler — and an unknown failure becomes a generic 500 rather than whatever the
  framework happened to serialize.
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
  stack go to the `BYMAX_UNEXPECTED_ERROR_SINK` seam when you bind one, and reach the body
  only under `exposeInternals`. A 5xx never carries `details` either, whichever library threw
  it, unless `exposeInternals` is on
- ✅ **Correlation id** — resolved through `BYMAX_CORRELATION_PROVIDER`, so the id comes from
  wherever your request context already keeps it

### 🛡️ Request floors

- ✅ **Body-depth guard** — opt-in `bodyDepth` answers a request body nested too deeply with a
  `400` through the envelope, before a recursive validator overflows the stack into a `500`
- ✅ **HTTP floors** — `applyHttpFloors` from `./http` sets security headers without HSTS,
  refuses compressed request bodies with `415`, and bounds header and request time

### ⏱️ Observability

- ✅ **Request timing** — one sample per closed request, rejections included, handed to the
  sink you register; the library stores nothing itself
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

- ✅ **Subpaths** — each feature a package can import without pulling the module in
- ✅ **Dual-format output** — ESM + CJS with declarations for each format, verified against
  the packed tarball on every run
- ✅ **Independent features** — each is enabled on its own; the providers for the rest are
  never registered
- ✅ **Typed end to end** — TypeScript `strict` with `exactOptionalPropertyTypes` and
  `noUncheckedIndexedAccess`; zero `any`

---

## 📦 Subpath Exports

| Subpath         | Contents                                                                                                                                                                                                                                                            |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.`             | `BymaxCoreModule`, the error envelope and its code catalog, the request-timing middleware, the DI tokens, and every option type                                                                                                                                     |
| `./pagination`  | `normalizePageQuery`, `buildPageResult`, `normalizeCursorQuery`, `buildCursorResult`, `encodeCursor`, `decodeCursor` and their types — pure functions, no NestJS provider involved                                                                                  |
| `./health`      | `IHealthIndicator`, `HealthResponse`, the indicator contracts and the `@BymaxHealthIndicator()` marker, so a package that only implements an indicator does not import the module                                                                                   |
| `./metrics`     | `IMetricsContributor` and the `@BymaxMetricsContributor()` marker, so a package that only publishes metrics imports neither the module nor its DI tokens. The one subpath whose types name `prom-client`, which anyone implementing the contract already depends on |
| `./http`        | `applyHttpFloors`, the one bootstrap call for the HTTP-level floors: security headers, compressed request bodies refused, and the header and request timeouts — separate so an application that never calls it never loads `helmet`                                 |
| `./idempotency` | `@Idempotent()`, the interceptor, the `IIdempotencyStore` port, `InMemoryIdempotencyStore` and the `BYMAX_IDEMPOTENCY_*` codes                                                                                                                                      |
| `./openapi`     | `applyBymaxOpenApi`, the one bootstrap call that builds and mounts the OpenAPI document — separate so an application that never documents its API never loads the code that does                                                                                    |

Each subpath ships ESM and CommonJS with its own `.d.ts` and `.d.cts`, so
`require()` and `import` both resolve the declarations meant for them.

### Install

```bash
pnpm add @bymax-one/nest-core @nestjs/common @nestjs/core reflect-metadata rxjs
```

Add `prom-client` if you enable the metrics feature, `@nestjs/swagger` if you
enable the OpenAPI feature, `@opentelemetry/api` if you enable trace
correlation, and `helmet` if you call `applyHttpFloors`. Each is an optional peer
dependency: none is required, or ever loaded, unless you turn its feature on.

```bash
pnpm add prom-client
pnpm add @opentelemetry/api
pnpm add helmet
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

Options are checked at boot, and a refusal names the option and the _type_ of what it got, never the
value (a value may be a secret, and a message reaches logs); a number is the one exception. A
boolean must be `true` or `false`, so `'false'` is refused and not read as truthy. A block, and the
options object itself, refuses a key it does not document, so a misspelt option fails instead of doing
nothing. A block must be a plain object: a `Date`, `Map`, `Set` or `RegExp` is refused. An option, or a whole block, given as `undefined` or `null` reads as unset and takes its
default; the one exception is an option of `helmet`, where `null` is refused.

**`Object.prototype` must be the standard one.** These guards are best-effort protection against accidents and pollution by a dependency; code that runs in the host process is trusted, and `SECURITY.md` states the threat model and the known limit. `BymaxCoreModule.forRoot`, `applyBymaxOpenApi` (only when it goes on to mount the document) and `applyHttpFloors` refuse to boot while `Object.prototype` of the realm holds a string key outside the ones it has by default, or one of those has been replaced: every plain object a dependency reads a name from would inherit it, and no option can shadow it. A host that extends `Object.prototype` cannot boot this package. `zone.js` is one such host: it replaces `Object.prototype.toString`, so a process that loads it, before or after this package, is refused. The error reports a count only (`count`). The guard runs again after the last `await` of `applyBymaxOpenApi` and `applyHttpFloors`, and the metrics scrape answers `503` while the guard refuses (after the bearer check, so a caller without the token learns nothing). Only the default metrics this package creates have their writes contained: a metric your own code registers on the registry is not wrapped, and a write of it that `prom-client` refuses throws where you made it. A name planted after boot does not reach the OpenAPI document, even an enumerable one: the guard refuses it before `@nestjs/swagger` scans, and the document is built at boot and served from its own keys. The guard runs when this package is asked, so it cannot stop a name planted later: a `value` or `writable` planted on `Object.prototype` after boot ends the process inside Node's own `perf_hooks` when the next garbage collection is observed. A bare Node process with only a GC `PerformanceObserver` dies the same way, and no frame of this package or of `prom-client` is on the stack, so this limit is Node's. Freeze `Object.prototype` before anything else runs (`Object.freeze(Object.prototype)`), or set `collectDefaultMetrics: false`; the first also covers a name such as `timeout`, which Node's own `http` module reads from plain objects, so a bare `http.get` throws with it planted and no code of this package involved.

**Replaced built-ins.** The same guard refuses to boot while a built-in that the CORS, deadline and scrape decisions call was replaced after the package loaded (collection, string, regular-expression and iterator methods; the table is in `src/object-prototype.ts`). What it watches is what `src/object-prototype.ts` captures and nothing wider: the reading of the options at boot calls built-ins it does not watch. Where a request reaches such a decision, the answer fails closed and does not follow the replacement: the CORS delegate offers no origin (`origin: false`), the request deadline stays armed and no path is excluded from it, and the scrape endpoint answers `503` once its bearer check has passed. The scrape bearer check (`crypto.hash` and `timingSafeEqual`) and the timestamp of the `504` body (`Date`) use what was captured when the package loaded, so replacing them afterwards decides nothing there. The guard does not watch what a host replaces by design: `Date` (the fake timers of `jest` and `sinon` replace it), `Promise` and its `then`, `catch` and `finally` (APM context managers wrap them), timers, `EventEmitter`, `http` and `fetch`. A test suite with fake timers, or an APM agent, therefore boots and serves without a refusal.

What is handed over is read once, and the limits are fixed. A list an option holds is read by index and is
refused, never cut short, past `1000` items, and so is a map an option holds (`metrics.defaultLabels`,
`openapi.operationSecurity`, `openapi.securitySchemes`) past `1000` keys; a list inside what is copied (an OpenAPI contributor's operation,
a nested value) is refused past `100000` items, and when its length is not an integer or it has a hole. One
copy does at most `1000000` units of work (list items and keys), and a map read by name (the `directives` of
`helmet`'s policy) answers to at most `1000` names. The OpenAPI options `servers`, `securitySchemes`,
`security` and `operationSecurity` must hold plain data: a class instance, a `Map`, an object with a method, a
proxy, whatever it lists or answers, are refused at boot: `servers` with
`openapi.servers must hold only plain data`, the others with `the options could not be read` and the option in the
`option` property of the `cause`.

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

| Option                | Type      | Default | Description                                                                                                                                                                       |
| --------------------- | --------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `enabled`             | `boolean` | `true`  | Registers the global exception filter.                                                                                                                                            |
| `exposeInternals`     | `boolean` | `false` | Includes the original message and stack of unknown errors, and the `details` of a 5xx. Development only, never production.                                                        |
| `serverErrorWindowMs` | `number`  | `60000` | How long repeats of the same `5xx` `HttpException` are counted and summarised instead of each being reported to the unexpected-error sink. A positive integer up to `2147483647`. |

### `timing`

| Option                   | Type      | Default | Description                                                                                                       |
| ------------------------ | --------- | ------- | ----------------------------------------------------------------------------------------------------------------- |
| `enabled`                | `boolean` | `true`  | Applies the request-timing middleware to every route.                                                             |
| `slowRequestThresholdMs` | `number`  | unset   | Samples above this duration are flagged `slow: true`. Absent means never slow; a positive integer, or boot fails. |

### `bodyDepth`

| Option     | Type      | Default | Description                                                                                        |
| ---------- | --------- | ------- | -------------------------------------------------------------------------------------------------- |
| `enabled`  | `boolean` | `false` | Refuses a request body nested deeper than `maxDepth` with a `400` through the envelope. See below. |
| `maxDepth` | `number`  | `32`    | The deepest nesting a body may have. A flat object or array is depth 1. A positive safe integer.   |

**Off by default, and worth turning on.** Enabling it rejects bodies that are accepted without
it, so it is a decision rather than a side effect. Turn it on: a body of about 2,000 nested
arrays is only 4 KB, and the recursion in a validator or transformer (`class-validator`,
`class-transformer`) overflows the stack on it, so the filter answers `500` for a request that
was only malformed — no credential needed. This package ships no validation of its own, so the
limit sits in front of yours: the check runs before routing, on the body Nest's parsers already
produced, and answers `400 BYMAX_BAD_REQUEST` ("Request body is nested too deeply"), so it
protects every route, this package's own included.

It covers the Express adapter. It does nothing when the application disables Nest's body
parsers or parses bodies after module middleware has run, and it is not mounted on Fastify,
whose middleware runs before the body is parsed.

### `health`

| Option                  | Type      | Default    | Description                                                                                                                                        |
| ----------------------- | --------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `enabled`               | `boolean` | `true`     | Registers the health controller.                                                                                                                   |
| `path`                  | `string`  | `'health'` | Route prefix: `GET /<path>/live`, `GET /<path>/ready`.                                                                                             |
| `indicatorTimeoutMs`    | `number`  | `5000`     | Per-indicator timeout before a check reports down; a positive integer up to `2147483647`, or boot fails.                                           |
| `readinessCacheMs`      | `number`  | `1000`     | How long a finished readiness answer is reused; `0` turns the cache off. Probes already in flight always share one run.                            |
| `exposeIndicatorErrors` | `boolean` | `false`    | Serves what an indicator returned in `details`, and the failing indicator's message under `details.error`. Never enable in production — see below. |
| `autoDiscover`          | `boolean` | `false`    | Also aggregates every provider marked `@BymaxHealthIndicator()`, anywhere in the application.                                                      |

On `forRoot`, `enabled` and `path` are applied at module-definition time: a
disabled feature registers no controller, and a custom `path` mounts the routes.
On `forRootAsync`, options resolve after the module is defined, so the health
controller is always registered at the default path and enforces `enabled` and
the default path with a request-time guard; a disabled or custom-path async
configuration fails fast at the route rather than at boot.

### `metrics`

| Option                  | Type                     | Default     | Description                                                                                                                                                                                        |
| ----------------------- | ------------------------ | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `enabled`               | `boolean`                | `false`     | Registers the metrics controller and the registry.                                                                                                                                                 |
| `path`                  | `string`                 | `'metrics'` | Route serving the Prometheus scrape.                                                                                                                                                               |
| `defaultLabels`         | `Record<string, string>` | `{}`        | Static labels attached to every metric. A name must be a Prometheus label name and not a reserved one (`__` prefix, `le`, `quantile`, `method`, `route`, `status_code`); a value must be a string. |     |
| `collectDefaultMetrics` | `boolean`                | `true`      | Collects `prom-client`'s process CPU, memory, and event-loop metrics.                                                                                                                              |
| `authToken`             | `string`                 | _(unset)_   | Bearer required to scrape. Unset leaves the endpoint open, which production refuses unless `edgeProtected` is set; empty/whitespace is rejected at boot.                                           |
| `edgeProtected`         | `boolean`                | _(unset)_   | States that the scrape route is protected at the edge; unset is `false`. Enabling metrics in production with neither `authToken` nor this flag is refused at boot.                                 |
| `scrapeTimeoutMs`       | `number`                 | `5000`      | How long a scrape waits for the collection; past it every scrape answers `503` until it settles. A positive integer up to `2147483647`.                                                            |

As with `health`, `enabled` and `path` register conditionally on `forRoot`. On
`forRootAsync` the metrics controller is always registered at the default path
and enforces `enabled` and the default path with a request-time guard, so a
disabled or custom-path async configuration fails fast at the route.

Outside production the scrape endpoint is **open** unless you set `authToken` — the
exposition publishes the route inventory and, with `collectDefaultMetrics`, process
internals to any caller. In production, `enabled: true` with no `authToken` is refused at
boot, unless `edgeProtected: true` states that the route is protected at your edge
(network policy, ingress auth); the flag protects nothing, it records that something
does. `NODE_ENV` decides production, and an unset `NODE_ENV` is production unless the module's `environment` option declares development or
test. Set `authToken` to require `Authorization: Bearer <token>` (the scheme is matched
case-insensitively; the token is compared in constant time). A token configured empty or
whitespace-only is rejected at boot rather than silently ignored, so a mistyped secret
fails loud instead of leaving the endpoint open:

```ts
const token = process.env.METRICS_TOKEN
BymaxCoreModule.forRoot({
  metrics: { enabled: true, ...(token === undefined ? {} : { authToken: token }) }
})
// Scrape: curl -H "Authorization: Bearer $METRICS_TOKEN" http://host/metrics
```

### `handlerTimeout`

The options are typed `HandlerTimeoutOptions`.

| Option         | Type       | Default | Description                                                                                                                                                                  |
| -------------- | ---------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `enabled`      | `boolean`  | `false` | Bounds the handler of every request. Off by default: a default bound would cut an upload, a long poll or a long report; turn it on and exclude those routes.                 |
| `timeoutMs`    | `number`   | `30000` | How long a handler may run before the request is answered `504` in the error envelope. A positive integer up to `2147483647`, or boot fails.                                 |
| `excludePaths` | `string[]` | `[]`    | Path prefixes that are not bounded, each starting with `/` (`'/uploads'` covers `/uploads` and what lies under it, not `/uploads-old`). The path includes the global prefix. |

Node's `requestTimeout` and `headersTimeout` bound only the receiving of the request, so a handler that
stalls, or a client that reads the response slowly, holds the connection and whatever the handler holds
with it. This bounds the handler itself. A route opts out with `@NoHandlerTimeout()` (a method or a
controller), an `@Sse()` route is never bounded, and a path prefix in `excludePaths` opts out a whole area.

**What it does not do.** The `504` frees the client and the connection. It cannot cancel a handler that
returns a promise, which is every `async` method: measured with one that takes 400 ms against a 100 ms
bound, the client got the `504` at about 100 ms and the handler ran on to its end. A handler that returns
an `Observable` is unsubscribed one more `timeoutMs` after the `504`, so its teardown runs, and at once
when the client goes away before the `504`; until then an error either kind of handler throws is logged with its own message (handler data, not configuration), and after that it
is not. That hold does not keep the process alive, so the log of a late error is best effort: a process that closes its application right after a `504`, with nothing else holding it open, can exit before the error is logged. The longest this holds a handler is therefore twice `timeoutMs`: the bound, then the one more. The bound is the handler's whole duration, so an `Observable` that emits and never completes is
answered `504` too. A promise handler stops early, and releases what it holds, only if it takes the
signal and acts on it: `@HandlerSignal()` gives it an `AbortSignal` that is aborted when the bound
expires and when the client goes away, to pass to a driver, a `fetch` or an `await` that accepts one. The
signal is `undefined` when neither the bound nor a request deadline applies to the route. The bound is the handler's own
promise or observable: a handler that takes the response with `@Res()`, returns, and writes later has
finished as far as this can see, and one that has already sent its headers when the bound expires has its
connection cut, because a `504` can no longer be sent.

**It bounds every route the interceptor sees, the health and metrics endpoints included.** A `timeoutMs`
below `health.indicatorTimeoutMs` or `metrics.scrapeTimeoutMs` makes a slow probe or scrape answer `504`
instead of its own `503`: keep it above them, or list `/health` and `/metrics` in `excludePaths`.

### `shutdown`

The options are typed `ShutdownOptions`.

| Option       | Type     | Default   | Description                                                                                                                                      |
| ------------ | -------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `deadlineMs` | `number` | _(unset)_ | The longest the shutdown may take once the deadline is armed (below). A positive integer up to `2147483647`, or boot fails. Unset adds no bound. |

A handle nothing closes keeps the process alive. With `deadlineMs` set, a shutdown that has not finished by then
logs one error line and ends the process with exit code `1`, so an orchestrator sees a failed stop and not a
hung one. The timer is unreferenced: a shutdown that finishes lets the process end on its own and the
deadline never fires. Measured on Node 24 against the built package: with a handle nothing closes and a
300 ms deadline the process logged the line and exited with code `1`; with a clean close and a 10 s
deadline it exited with code `0` at once. Shutdown starts when Nest's shutdown hooks run (`app.close()`, or a signal after
`app.enableShutdownHooks()`); without them nothing starts it.

**When it is armed.** By the first of: a `SIGTERM` or `SIGINT` that the application already handles
(call `app.enableShutdownHooks()` before `app.init()`), or this module's own shutdown hooks. Nest runs all
`onModuleDestroy` hooks, then all `beforeApplicationShutdown`, then all `onApplicationShutdown`; within a
phase the root module's providers first and then the other modules, and a global module, as this one is by
default, after every other. So a never-settling `beforeApplicationShutdown` or `onApplicationShutdown`
anywhere is covered on a signal and on `app.close()`, and a never-settling `onModuleDestroy`, in any
module or in a provider of the root module, is covered on a `SIGTERM` or `SIGINT` the application handles
and nowhere else: on a programmatic `app.close()`, or on any other signal (`SIGHUP`, `SIGQUIT`,
`SIGUSR2`), it is reached before this module's hook and the deadline is not armed, so give that call its
own timeout. A
signal that nothing handles keeps Node's default of ending the process, and no listener is added for it.

Two consequences to know. With `deadlineMs` set, any `SIGTERM` or `SIGINT` that reaches a process that already
handles it arms the deadline, even one the application handles for something other than shutdown (a CLI that
cancels a task on Ctrl-C and keeps running): that process exits with code `1` after `deadlineMs`. And the timer
outlives `app.close()` on purpose, which is how it catches a handle that leaks, so a process that keeps running
after `app.close()`, typically a Jest end-to-end suite that closes the application and runs more tests, exits
with code `1` `deadlineMs` later. Leave `deadlineMs` unset in test processes.

### `telemetry`

| Option          | Type      | Default | Description                                                                     |
| --------------- | --------- | ------- | ------------------------------------------------------------------------------- |
| `enabled`       | `boolean` | `false` | Reads the active span and carries its ids into timing samples and the log seam. |
| `exposeTraceId` | `boolean` | `false` | Also publishes `traceId` in the error-envelope body served to the client.       |

### `openapi`

| Option               | Type                                       | Default       | Description                                                                                                                                                                                              |
| -------------------- | ------------------------------------------ | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `enabled`            | `boolean`                                  | `false`       | Builds and serves the document. Ignored in production, where it is always off.                                                                                                                           |
| `path`               | `string`                                   | `'docs'`      | Route serving the interactive UI.                                                                                                                                                                        |
| `jsonPath`           | `string`                                   | `'docs-json'` | Route serving the raw JSON document.                                                                                                                                                                     |
| `title`              | `string`                                   | `'API'`       | Document title.                                                                                                                                                                                          |
| `description`        | `string`                                   | `''`          | Document description.                                                                                                                                                                                    |
| `version`            | `string`                                   | `'1.0.0'`     | Document version, independent of the package version.                                                                                                                                                    |
| `servers`            | `{ url, description? }[]`                  | `[]`          | Servers advertised by the document.                                                                                                                                                                      |
| `securitySchemes`    | `Record<string, object>`                   | `{}`          | Security schemes copied into the document's components. `oauth2` needs `flows`, `openIdConnect` an `openIdConnectUrl`, `http` a `scheme`, `apiKey` an `in` and a `name`; `mutualTLS` needs nothing more. |
| `security`           | `SecurityRequirement[]`                    | `[]`          | The requirement every operation carries unless it says otherwise.                                                                                                                                        |
| `operationSecurity`  | `OperationSecurityMap`                     | `{}`          | Per-operation overrides. An empty array marks that operation public.                                                                                                                                     |
| `operationIdFactory` | `(controller, method, version?) => string` | peer default  | Names the operations. Leave unset and nothing an existing client generated changes.                                                                                                                      |
| `includeCoreSchemas` | `boolean`                                  | `true`        | Contributes this package's own schemas and references them from the responses.                                                                                                                           |

Unlike `health` and `metrics`, this block behaves identically on `forRoot` and `forRootAsync`:
the document is mounted from the bootstrap helper, after the options have resolved. How to
document authentication and the rest of the feature: [OpenAPI](#-openapi).

## 🔑 DI Tokens

Every token is a `Symbol`. `BYMAX_CORRELATION_PROVIDER`, `BYMAX_HEALTH_INDICATORS`,
`BYMAX_HEALTH_TRANSITION_SINK` and `BYMAX_UNEXPECTED_ERROR_SINK` are consumed with `@Optional()`
and are not bound by the module: provide any of them from your own module, otherwise the
internal fallback in the last column applies. `BYMAX_TIMING_SINK` and `BYMAX_METRICS_REGISTRY`
behave differently on `forRootAsync`, where options resolve after the module is defined: the
module always binds and exports both (the timing sink as the metrics bridge or a no-op, the
registry as a guarded placeholder when metrics are off), so a consumer `BYMAX_TIMING_SINK`
override is honored on `forRoot` but shadowed on `forRootAsync`. Follow the pattern in
[Integration with `@bymax-one/nest-logger`](#-integration-with-bymax-onenest-logger).

| Token                          | Provides                                      | When you do not provide one                                                                                       |
| ------------------------------ | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `BYMAX_CORE_OPTIONS`           | The resolved `BymaxCoreModuleOptions`         | always set by the module                                                                                          |
| `BYMAX_CORRELATION_PROVIDER`   | `ICorrelationIdProvider`                      | internal no-op (omits `correlationId`)                                                                            |
| `BYMAX_TIMING_SINK`            | `ITimingSink`                                 | internal no-op, or the metrics bridge when timing and metrics are both enabled                                    |
| `BYMAX_HEALTH_INDICATORS`      | `IHealthIndicator[]`                          | treated as an empty indicator set                                                                                 |
| `BYMAX_HEALTH_TRANSITION_SINK` | `IHealthTransitionSink`                       | no sink; readiness transitions go to Nest's logger instead (binding one stands that line down)                    |
| `BYMAX_UNEXPECTED_ERROR_SINK`  | `IUnexpectedErrorSink`                        | no sink; the cause of a `500 BYMAX_INTERNAL_ERROR` is not recorded anywhere                                       |
| `BYMAX_METRICS_REGISTRY`       | the `prom-client` `Registry`                  | bound when metrics are enabled; on `forRootAsync` always registered, guarded-placeholder when off                 |
| `BYMAX_TRACE_CONTEXT`          | `ITraceContextProvider` (`getTraceContext()`) | bound on every path: the OpenTelemetry reader when telemetry is enabled, a no-op that resolves no trace otherwise |

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

| Field           | Type              | Presence | Notes                                                                                              |
| --------------- | ----------------- | -------- | -------------------------------------------------------------------------------------------------- |
| `statusCode`    | number            | always   | HTTP status.                                                                                       |
| `code`          | string            | always   | Stable, machine-readable code.                                                                     |
| `message`       | string            | always   | Human-readable, safe for end users.                                                                |
| `details`       | array or object   | optional | Structured context, for example validation issues. Absent on a 5xx unless `exposeInternals` is on. |
| `correlationId` | string            | optional | Present when a correlation provider is bound.                                                      |
| `timestamp`     | string (ISO 8601) | always   | Time the error was formatted.                                                                      |
| `path`          | string            | always   | Request URL path, never the query string. The router's own 404 `message` names the same path.      |

**This package mints no request id.** `correlationId` is whatever the bound
`ICorrelationIdProvider` (`BYMAX_CORRELATION_PROVIDER`) returns: the filter only
reads it, and with no provider bound the field is absent. The id has to come from
something you bind. With `@bymax-one/nest-logger` that is its request-id
middleware; see
[Integration with `@bymax-one/nest-logger`](#-integration-with-bymax-onenest-logger).

**A server error carries no `details` by default.** For a status of 500 or above the filter
omits `details`, whichever library threw the `HttpException` and whether it wrote them flat or
under `error`; `code` and `message` stay, because the thrower chose them for the caller.
`envelope.exposeInternals` keeps the details, for local debugging only. The filter owns no
logger, so whatever throws such an error should log that context server side and must not
interpolate internal data into its `message`. Client errors are unchanged: their details are the
contract. This follows the OWASP
[Error Handling Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Error_Handling_Cheat_Sheet.html)
and RFC 9457 [sections 3.1.4 and 5](https://www.rfc-editor.org/rfc/rfc9457.html).

Codes are stable strings under a reserved `BYMAX_` prefix, derived from the
HTTP status: `BYMAX_NOT_FOUND` for 404, `BYMAX_VALIDATION_FAILED` for the
shape a validation pipe produces, `BYMAX_INTERNAL_ERROR` for anything
unmapped, and so on. Throw an `HttpException` whose response object carries
your own `code` and the filter passes it through verbatim:

```typescript
import { BadRequestException } from '@nestjs/common'

throw new BadRequestException({ code: 'INVOICE_OVERDUE', message: 'Invoice is overdue' })
```

Every code the package assigns is exported from `@bymax-one/nest-core` as a constant:

| Code                           | Status    | When                                                     |
| ------------------------------ | --------- | -------------------------------------------------------- |
| `BYMAX_BAD_REQUEST`            | 400       | A bad request that is not a validation failure.          |
| `BYMAX_VALIDATION_FAILED`      | 400       | The shape a validation pipe produces.                    |
| `BYMAX_UNAUTHORIZED`           | 401       | No or invalid credentials.                               |
| `BYMAX_FORBIDDEN`              | 403       | Authenticated, but not allowed.                          |
| `BYMAX_NOT_FOUND`              | 404       | Unknown resource, including a route no handler matched.  |
| `BYMAX_CONFLICT`               | 409       | A state conflict.                                        |
| `BYMAX_PAYLOAD_TOO_LARGE`      | 413       | A body over the size limit.                              |
| `BYMAX_UNSUPPORTED_MEDIA_TYPE` | 415       | A content type the route does not accept.                |
| `BYMAX_UNPROCESSABLE_ENTITY`   | 422       | A well-formed body that is semantically invalid.         |
| `BYMAX_TOO_MANY_REQUESTS`      | 429       | A rate limit.                                            |
| `BYMAX_CLIENT_ERROR`           | other 4xx | A client error with no code of its own.                  |
| `BYMAX_INTERNAL_ERROR`         | 500       | An unknown error, and any non-4xx status without a code. |
| `BYMAX_NOT_IMPLEMENTED`        | 501       | A handler that is not implemented.                       |
| `BYMAX_BAD_GATEWAY`            | 502       | A failure of an upstream service.                        |
| `BYMAX_SERVICE_UNAVAILABLE`    | 503       | Temporary unavailability.                                |
| `BYMAX_GATEWAY_TIMEOUT`        | 504       | An upstream service that did not answer in time.         |

`codeForStatus(status)` returns the code for a status.

### What the filter classifies from, and what it cannot

An error raised before any handler ran — a malformed JSON body, a payload over the size limit —
still becomes a clean `4xx` envelope rather than a 500. The filter recognizes those by **shape**,
not by class: it honours an error that marks itself `expose: true` with a `4xx` status, the
`http-errors` convention Node's body pipeline follows. Nothing in the application failed, so it
is not routed through the unexpected-error seam either.

The message of such a refusal is fixed per status — `Malformed request` (400),
`Request entity too large` (413), `Unsupported media type` (415) — because the parser's own text
quotes the request: a JSON excerpt, a header value, the path. A `BadRequestException` a
middleware throws before routing gets the same 400 message; throw it with a `code` to keep its
own. Fastify is not covered.

**An error that carries no such marking is a 500, including when a client caused it.** A body of
a few kilobytes nested thousands of levels deep overflows the stack during validation and
surfaces as `RangeError: Maximum call stack size exceeded`, answered
`500 BYMAX_INTERNAL_ERROR`. Mapping `RangeError` to a `4xx` would infer causation from an error
class and hide a genuine stack overflow in your own code, which is a `500` that should page
someone. The floor for that case is the opt-in [`bodyDepth`](#bodydepth) guard, which refuses
the body as the `400` it is before validation runs.

### Recording the cause of a 500

An error the filter does not recognise collapses to a fixed `500 BYMAX_INTERNAL_ERROR`, so the
client learns nothing about your internals, and the thrown value is gone once the response is
written. Bind an `IUnexpectedErrorSink` and the filter hands it the original value first:

```typescript
import { Global, Logger, Module } from '@nestjs/common'
import { BYMAX_UNEXPECTED_ERROR_SINK } from '@bymax-one/nest-core'
import type { IUnexpectedErrorSink, UnexpectedErrorReport } from '@bymax-one/nest-core'

export class UnexpectedErrorLogger implements IUnexpectedErrorSink {
  private readonly logger = new Logger('UnexpectedError')

  record({ error, method, route, correlationId }: UnexpectedErrorReport): void {
    this.logger.error(
      `${method} ${route} failed (correlationId=${correlationId ?? '-'})`,
      error instanceof Error ? error.stack : String(error)
    )
  }
}

@Global()
@Module({
  providers: [{ provide: BYMAX_UNEXPECTED_ERROR_SINK, useClass: UnexpectedErrorLogger }],
  exports: [BYMAX_UNEXPECTED_ERROR_SINK]
})
export class ErrorReportingModule {}
```

The sink is called, on both registration paths, for every unexpected error that collapses to a
`500`, once each, and for a `5xx` `HttpException`. A library's `503`
for a dependency that is down, say, is reported with the exception as thrown, so the sink can write
its `cause`, which the response never carries; an `HttpException` below `500` is a deliberate answer
and an exposed `4xx` from the body pipeline is a client mistake, and neither is reported.

While a dependency is down every request fails the same way, and a line with a stack per request
would be a storm of its own. A `5xx` `HttpException` is therefore reported once per status and code
in each `envelope.serverErrorWindowMs` window, and the repeats are counted. When
the window ends, one more report carries the number withheld in `repeated` and the latest exception;
a shutdown reports the summaries still due. The
response is the same whether or not it is reported.

What the sink receives can carry a host and a port, because a driver puts them in its message: redact
in your logger. The report carries the thrown value as it was thrown, the method, the route **template**
(`/invoices/:id`, or `<unmatched>` for an error raised before routing), and the correlation and
trace ids when they resolve; no raw URL, query string, headers or body. The value is passed uncut
whatever `envelope.exposeInternals` says, since that option governs the response body, so send the
report where access is already controlled.

The response never depends on the sink: a sink that throws, or an `async record()` that rejects,
is absorbed, and it runs synchronously before the reply, so hand the report off and return.
`IUnexpectedErrorSink` is matched by shape, so a library can ship a compatible class without
importing this package. Subclassing `BymaxExceptionFilter` and overriding `onUnexpectedError`
still works and runs alongside the sink.

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
  traceId?: string
  spanId?: string
}
```

`TimingInterceptor` is still exported and is **deprecated**: nothing registers it, and
registering it alongside the middleware records a second sample for every request that reaches
a handler, so leave it out.

### Rejected requests are counted too

The recorder is middleware (`BymaxTimingMiddleware`), applied to every route by `BymaxCoreModule`
when `timing.enabled` is `true`. Nest runs **middleware → guards → interceptors → pipes →
handler**, so a request rejected by a guard never reaches an interceptor, and a request matching
no route never reaches a controller. A recorder in either place is blind to exactly the traffic
that matters during an incident:

| What happens                   | Status | Visible to an interceptor | Visible here |
| ------------------------------ | ------ | ------------------------- | ------------ |
| Handler answers                | `2xx`  | ✅                        | ✅           |
| Authentication guard rejects   | `401`  | ❌                        | ✅           |
| Authorization guard rejects    | `403`  | ❌                        | ✅           |
| Rate limiter sheds the request | `429`  | ❌                        | ✅           |
| No route matches               | `404`  | ❌                        | ✅           |
| Client hangs up mid-request    | —      | ❌                        | ✅           |

A credential-stuffing run is a flood of `401`s, route enumeration a flood of `404`s, and a
throttler doing its job a flood of `429`s.

Requests that matched no route are recorded under the fixed label `UNMATCHED_ROUTE`
(`<unmatched>`), never the requested path: the raw path is attacker-controlled, and a metrics
label that follows it lets anyone mint one time series per probe.

The sample is emitted when the connection closes, so a client that hangs up before the response
finishes is still counted, and `durationMs` covers guards and middleware as well as the handler.
An aborted request keeps whatever status the response held, `200` in Node unless something
settled another one; no sentinel status is introduced.

Express and Fastify behave identically here, and that is asserted end to end on both. The module
resolves the two platform differences for you: Fastify runs middleware through `@fastify/middie`,
which hands it the raw `IncomingMessage` without route metadata, and `forRoutes('/')` is a mount
on Express but an exact match on Fastify.

> **One gap is Nest's scoping rule, not a setting.** Module middleware is scoped to the global
> prefix, so with `setGlobalPrefix('api')` a request to `/nope` — outside the prefix — reaches no
> middleware and is not recorded. `/api/nope` is recorded under `<unmatched>`. The module cannot
> register the recorder outside its own scope; open an issue rather than wiring it by hand,
> which would double-count.

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

A sink that fails cannot reach the request: a synchronous throw and a rejection from an `async
record()` are both absorbed. The failure is swallowed rather than logged, unlike a health
transition sink, because this runs on every request and a failing sink would otherwise become a
second flood beside the first.

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

A result is `{ items, meta }`, and `meta` is `{ page, limit, totalItems, totalPages }`: the page
the query resolved to, the page size it resolved to, the count across every page, and the number of
pages (`0` when there are no items).

`defaultLimit` (default `20`) is the page size when the request sends no usable `limit`, and `maxLimit` (default `100`) caps every size, the default included: a `defaultLimit` above `maxLimit` resolves to `maxLimit`. Both are per call. A value is used when it is a number, or a string holding one, that is finite and at least `1`, and a fraction is rounded down; anything else (`0`, a negative, `NaN`, `Infinity`, another type) is replaced by its default.

#### Bound the offset, not just the page size

`maxLimit` caps how many rows a request reads; `maxOffset` caps how far in it starts, which is
the half that costs on an offset-paginated database: `GET /invoices?page=1000000000&limit=20`
becomes `OFFSET 19999999980`, and Postgres walks the table to reach a page that does not exist.
The page index has a floor of `1` and an arithmetic guard that keeps `(page - 1) * limit` an
exact integer, but nothing bounds the product unless you say so.

`maxOffset` is **absent by default**, because legitimate deep paging exists and a silent ceiling
would change the rows a working query returns. Set it wherever the page index reaches SQL and
your dataset has a knowable ceiling; `0` means "the first page only". Values are clamped the way
`maxLimit` is, and the resolved values come back in `meta`.

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

A result is `{ items, nextCursor }`, where `nextCursor` is `null` on the last page.

A malformed or tampered cursor rejects with `BYMAX_VALIDATION_FAILED`. Cursors
are opaque `base64url` strings but are neither encrypted nor signed: encode
ordering keys only, never sensitive data.

## ❤️ Health

Liveness always replies `200` with an empty checks array; readiness runs
every registered indicator concurrently and replies `200` only when every
indicator reports `up`, `503` otherwise, naming every check either way.

A check is named but not quoted: the response carries each indicator's name and
status, never the `details` it returned, and a failing indicator's reason goes to
the logger. See
[the security model](#-security-model) for why, and
`health.exposeIndicatorErrors` if you want the details and the message in the
response while debugging locally.

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
converted to a `down` entry; it never hides the results of the other registered
indicators.

Readiness is usually reachable without credentials, so probe volume does not set dependency
volume: probes that arrive while a run is in progress share it, and its answer is reused for
`readinessCacheMs`. `check()` receives an `AbortSignal` that is aborted when the indicator times
out, so an indicator that can cancel its query should pass the signal on.

When shutdown begins, readiness answers `503` at once, without running an indicator and whatever
is cached, so a load balancer stops routing to an instance that is draining. Nest only runs
`beforeApplicationShutdown` on `app.close()` or, for a signal, after `app.enableShutdownHooks()`.

### A failing check leaves a record

Probe paths are usually excluded from the HTTP log, and a well-written indicator returns
`{ status: 'down' }` rather than throwing, because a driver's error carries hosts, ports and
sometimes credentials. So a readiness `503` could leave nothing behind. The aggregator therefore
holds the last state of every check and reports each **change** — never once per probe — to its
own logger and to a sink you bind:

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

Bind it under `BYMAX_HEALTH_TRANSITION_SINK` from your own `@Global()` module. With nothing
bound, transitions reach Nest's logger; **binding a sink stands that line down**, so one
transition is not recorded twice. The sink receives the cause as structured data:

| `cause.kind`    | Meaning                                            | Carries     |
| --------------- | -------------------------------------------------- | ----------- |
| `reported-down` | The indicator answered, and reported it down.      | —           |
| `rejected`      | The indicator rejected or threw.                   | `message`   |
| `timed-out`     | The aggregator gave up after `indicatorTimeoutMs`. | `timeoutMs` |

`timed-out` cannot be observed anywhere else: an abandoned indicator is never told, and a hung
dependency is the common shape. A first observation that is **failing** is reported and a first
healthy one is not, so a process that boots against a dependency already down does not look
healthy in the log forever. The cause is the one seen **at the transition**, so a dependency that
stays down while its failure mode changes keeps the first cause. The sink runs synchronously on
the readiness path, so keep it cheap; a throw is caught and logged rather than failing the probe.

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

## 🧾 Log events

Every operational line this package writes through Nest's `Logger` is an object message:
`{ event: 'CORE_<EVENT>', message: '<short text>', ...fields }`, where the fields are numbers or names
the application chose. `@bymax-one/nest-logger` 1.4.23 or later writes the object as structured fields,
so an alert matches on `event`; with another logger the object reaches it as it is. Match on `event`,
not on the text. `message` is this package's own text: what code of yours threw goes under `err`, for your logger to treat as your data, and never inside `message`. Something that is not an `Error` (a string, an object) is carried as a `NonErrorThrownError` with the value as its `cause`; a string is also its message (your text, cut at 500 characters), and any other value gives a message that names only its type (a number as itself). The exception is `CORE_HEALTH_DOWN`, whose `err` is a new `Error` that carries only the indicator's summarized text and has no `cause`. `routes` and `entries` list what a warning is about (operation keys such as `GET /users/{id}`, contributed components), with the rest elided as `, and <n> more`. Each listed item is written for a log line: a control, format, lone-surrogate, line-separator or paragraph-separator character (the Unicode categories `Cc`, `Cf`, `Cs`, `Zl` and `Zp`) is written as `\uXXXX`, or `\u{X}` beyond the Basic Multilingual Plane, and an item over 200 characters is cut and ends with `…`. Every line this package writes goes through your logger and a logger that throws is absorbed, so a failing logger never changes what a probe, the shutdown deadline or a boot does; a rejection of an `async` logger method is not caught here: Nest's `Logger` does not await it, so it is an unhandled rejection that ends the process unless your application handles `unhandledRejection`, and the logger you install should not be `async`.

A boot error about something you declared has a message that is this package's own text, with what you declared as properties of the error. A string property, or each string of a list, is written out and cut, and a list keeps its first ten items and ends with `and <n> more`. Match on those, not on the message; what your contributor threw is its `cause`.

| Property               | On the error about                                                                     | Holds                                         |
| ---------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------- |
| `contributor`          | an OpenAPI or metrics contributor that failed or does not fit the contract             | its class name                                |
| `provider`             | a provider marked as a health indicator that does not implement it                     | its class name or token                       |
| `handlerKey`           | two route handlers that answer to one key                                              | the key, `<ControllerClassName>.<methodName>` |
| `handlerKeys`          | a fragment that addresses handlers the application does not have                       | the keys it addressed                         |
| `knownHandlers`        | the same error                                                                         | the keys the application has                  |
| `duplicates`           | OpenAPI contributors that share a class name                                           | the names                                     |
| `schemes`              | a security requirement that names a scheme the document does not define                | the scheme names                              |
| `declaredSchemes`      | the same error                                                                         | the schemes the document defines              |
| `operations`           | an `openapi.operationSecurity` key that addresses no documented operation              | the keys                                      |
| `documentedOperations` | the same error                                                                         | the operations the document contains          |
| `option`               | an option block with a key it does not document                                        | the key, cut at 40 characters                 |
| `label`                | a `metrics.defaultLabels` value that is not a string                                   | the label name                                |
| `count`                | `Object.prototype` holding a name outside the standard ones, or a changed standard one | how many names or changes                     |

| `event`                           | Level | When                                                                                                                                                                                            | Fields                               |
| --------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `CORE_HEALTH_DOWN`                | warn  | A health check changed from up to down, or was first seen down; `cause` says why (`rejected`, `timed-out` or `reported-down`). Not written when a `BYMAX_HEALTH_TRANSITION_SINK` is bound.      | `check`, `cause`, `timeoutMs`, `err` |
| `CORE_HEALTH_RUNTIME_ALTERED`     | warn  | A promise built-in was replaced or given a `then` after load, so readiness answers not ready with a `runtime` check down. Written once until a probe answers normally again, whatever the sink. | `check`                              |
| `CORE_HEALTH_RECOVERED`           | log   | A health check that had been down is reachable again. Not written when a `BYMAX_HEALTH_TRANSITION_SINK` is bound.                                                                               | `check`                              |
| `CORE_HEALTH_SINK_FAILED`         | warn  | The bound health transition sink threw or rejected; the probe is unaffected. `err` is a new `Error` whose `cause` is what the sink threw (a `NonErrorThrownError` when it is not an `Error`).   | `err`                                |
| `CORE_HANDLER_LATE_ERROR`         | error | A handler threw after its request was answered `504`; the handler's own error is `err`, or a `NonErrorThrownError` holding what it threw as `cause`.                                            | `err`                                |
| `CORE_SHUTDOWN_DEADLINE`          | error | Shutdown did not finish within `shutdown.deadlineMs`; the process exits with code `1`.                                                                                                          | `deadlineMs`                         |
| `CORE_METRICS_RUNTIME_ALTERED`    | warn  | A built-in was replaced or given a `then` after load, so scrapes answer `503`. Written once until a scrape passes again.                                                                        | (none)                               |
| `CORE_METRICS_SCRAPE_SLOW`        | warn  | A metrics collection is past `metrics.scrapeTimeoutMs`; scrapes answer `503` until it ends.                                                                                                     | `timeoutMs`                          |
| `CORE_METRICS_CONTRIBUTORS`       | log   | Contributors registered their metrics at boot; their labels follow.                                                                                                                             | `contributors`, `labels`             |
| `CORE_OPENAPI_SERVED`             | log   | The OpenAPI document was mounted.                                                                                                                                                               | `path`, `jsonPath`                   |
| `CORE_OPENAPI_PRODUCTION_REFUSED` | warn  | The OpenAPI document was requested in production and is never served there.                                                                                                                     |                                      |
| `CORE_OPENAPI_UNSECURED`          | warn  | Operations state no security requirement while others in the document do.                                                                                                                       | `operations`, `routes`               |
| `CORE_OPENAPI_COMPONENT_CONFLICT` | warn  | A library contributed a component the document already defines; the contributed one is not served.                                                                                              | `components`, `entries`              |

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

npm marks `prom-client` 15.x deprecated in favour of `@prometheus-io/client`. This library stays on
`prom-client` `^15`: the collectors you register and the `MetricsRegistry` must come from one package.

`prom-client`'s default collectors keep a garbage-collection observer and an event-loop histogram for
the life of the process, and it offers no way to stop them. Neither keeps the process alive, so
`app.close()` still lets it exit. It matters only to a host that creates many applications in one
process, a test runner or a hot reload, where each application leaves a small observer behind.

The metrics this package registers, besides the default collectors:

| Metric                          | Type      | Labels                           | Meaning                                                                                             | When                       |
| ------------------------------- | --------- | -------------------------------- | --------------------------------------------------------------------------------------------------- | -------------------------- |
| `http_requests_total`           | counter   | `method`, `route`, `status_code` | Completed HTTP requests; `route` is the route template, or `<unmatched>`, never the requested path. | timing and metrics enabled |
| `http_request_duration_seconds` | histogram | `method`, `route`, `status_code` | HTTP request duration in seconds.                                                                   | timing and metrics enabled |
| `bymax_core_health_status`      | gauge     | `indicator`                      | Readiness state of each health check: `1` while its dependency is up, `0` while it is down.         | health and metrics enabled |

`bymax_core_health_status` has one series per health check, named as the indicator declares it, so its
cardinality is the number of indicators. A series appears when the check is first probed (readiness is
probed on a request to the readiness route), reads `1` from that first probe if the dependency is up,
and follows every later probe. The label is the indicator's own name, never anything a request carries.
Name the metric in an alert as `bymax_core_health_status{indicator="database"} == 0`.

Inject `BYMAX_METRICS_REGISTRY` to register your own application metrics
against the same registry the endpoint scrapes.

Every scrape recomputes the registry, which costs about 0.4 ms with the default collectors, so an open
endpoint is cheap but not free: set `metrics.authToken` or restrict the route at the edge.

Scrapes that arrive while a collection runs share it, and a scrape waits at most
`metrics.scrapeTimeoutMs`. A collection still
running after that is left to finish, because `prom-client` cannot cancel a collector, and every scrape
answers `503` at once until it settles; no second collection starts meanwhile, and a line in the log
says so once. A contributor whose `collect()` never settles therefore makes `/metrics` answer `503`
for ever, which is visible rather than a scrape held open. The deadline starts after the
token check, so a caller without the token still gets `401`. Bound your collectors anyway: the
deadline protects the endpoint, not the dependency.

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

**Naming and labels.** Contributors share one registry and one flat namespace, and `prom-client`
rejects a duplicate name, so a collision between two libraries surfaces at the **consumer's**
boot, in an application neither library's CI assembles. The conventions are therefore part of
the contract:

- Prefix every library metric with `bymax_<library>_` (`bymax_queue_depth`). An application's own
  metrics need no prefix.
- Follow Prometheus naming: `_total` for counters, `_seconds` for durations, base units.
- Keep labels bounded: route templates, never raw paths; status codes, never messages. **Never**
  a tenant, user or request id: one unbounded label makes the scrape endpoint the most expensive
  route in a service.
- **Publish the list.** A library that contributes metrics documents name, type and labels in its
  own README; this package keeps no central catalogue.

These rules are documentation, not enforcement: rejecting an unprefixed name would need a
per-contributor prefix on the contract and would wrongly reject an application's own contributor.

## 📘 OpenAPI

Disabled by default, and **never served in production**. Enabling it and calling one helper
during bootstrap publishes an interactive UI at `GET /docs` and the raw document at
`GET /docs-json`:

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
> Call `applyBymaxOpenApi` **before** `app.listen()`. Mounting the document re-registers routes
> on the HTTP adapter, and doing that against an already-initialized Express 5 application
> replaces the router: the document appears and every other route starts returning 404.

The call is safe to make unconditionally. It returns what it did:

| Result                                     | Meaning                                                 |
| ------------------------------------------ | ------------------------------------------------------- |
| `{ mounted: true, path, discarded }`       | The UI and the document are served at `path`.           |
| `{ mounted: false, reason: 'disabled' }`   | `openapi.enabled` is off.                               |
| `{ mounted: false, reason: 'production' }` | The runtime is production. Nothing was built or served. |

`discarded` lists each component a library contributed that the document already defined with a
shape of its own (a `DiscardedComponent` naming the contributor, the member and the name); the
boot log reports the same entries. A collision is not an error: the merge keeps whatever holds
the name, which is usually your own declaration but may be a core schema or an earlier
contributor's entry. A schema that is only `{"type":"object","properties":{}}` — what
`@nestjs/swagger` emits for every DTO in a package built without its plugin — is not a
declaration, so it is filled from the contribution; `{"type":"object"}` and `{}` are kept.

### Production is a closed door

`NODE_ENV` decides, and the decision is fail-closed: only `development` and `test` are
non-production. Any other value is production, and in production the document is never built or
mounted, whatever the configuration says. The guard runs twice, independently: the option
resolver forces the feature off, and the bootstrap helper classifies the runtime again.
Enabling it in production is a no-op with a warning naming the ignored option, so one
configuration can be shared across environments. `NODE_ENV` cannot be overridden.

An application that validates its own `APP_ENV` and never sets `NODE_ENV` declares it, and the
declaration is used **only where the process declares nothing**:

```typescript
BymaxCoreModule.forRootAsync({
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    // Your validated value, not a second copy of NODE_ENV.
    environment: config.getOrThrow<string>('APP_ENV'),
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

A declaration never overrules a process that named its own environment, and it goes through the
same fail-closed classification: an unrecognized name is production.

### Testing the enabled path under Jest

`applyBymaxOpenApi` loads `@nestjs/swagger` through a dynamic `import()`, which Jest's module
registry cannot service without a flag:

```jsonc
// package.json
"scripts": {
  "test:e2e": "NODE_OPTIONS=--experimental-vm-modules jest --config jest.e2e.config.ts"
}
```

Without it only the **enabled** case fails, with `dynamic import callback invoked without
--experimental-vm-modules`; the disabled and production cases never reach the loader.

### Documenting authentication

Set the default on the document and mark the exceptions. `security` names schemes declared in
`securitySchemes`; `operationSecurity` overrides it for one operation, and an **empty array is
how the specification says "public"**: an operation with _absent_ security inherits the document
default, so a generated client would attach credentials to your registration endpoint.

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

An operation that already declares its own requirement, because you decorated the handler, is
never overwritten.

**The operation key is a contract.** Keys are `"<METHOD> <path>"`: the method uppercase, one
space, and the path exactly as it appears in the generated document — leading slash, template
braces (`/users/{id}`), no trailing slash, **including any global prefix**
(`'POST /api/auth/login'` when the application sets `setGlobalPrefix('api')`). A library that
ships such a map should expose a **function taking the prefix**, because only the call site
knows it; `OperationSecurityMap` is a type-only export for checking that map:

```ts
// in the library
export function authOperationSecurity(prefix = ''): OperationSecurityMap {
  return {} /* … */
}

// in the application
BymaxCoreModule.forRoot({
  openapi: { operationSecurity: { ...authOperationSecurity('api'), ...myOwnOverrides } }
})
```

**What fails the document build.** A requirement naming an undeclared scheme, and a key matching
no operation, each fail the build and list what missed and what exists: a stale key would
otherwise quietly document a route as authenticated, or the reverse. These checks run **only
when the document is built**: with `openapi.enabled` false, or in production, a stale key or a
deleted scheme sits there until someone turns the document on. Keep at least one environment
that runs your tests with the document enabled. A key naming a route that exists only in some
environments fails the boot in a docs-enabled environment that lacks it, so assemble the map per
feature the way you assemble the modules.

**An operation that ends up requiring nothing** is a valid document, so nothing else catches it,
and a client generated from it sends no credentials. When the document declares no top-level
`security`, at least one other operation states a requirement, and the bare operation is not one
of this package's own, the build logs a warning naming the operations:

```
[BymaxCoreModule] a client generated from the OpenAPI document will send no
credentials to 2 operation(s): GET /examples, POST /orders. They state no
security requirement, the document declares no default, and other operations in
it do state one — so this is more often a missing openapi.security default than
a public API. Set openapi.security, or state the intent per operation with an
explicit [] in openapi.operationSecurity.
```

It is a warning because a public API is a legitimate configuration; `operationSecurity: {
'GET /examples': [] }` states the intent and silences it. It cannot report the case where
_every_ requirement is removed at once, since a document with no described operations is
indistinguishable from a public API. Your own suite knows which one you are, so assert the
default you expect (`expect(document.security).toEqual([{ cookieAuth: [] }])`, not
`toBeDefined`, since `[]` is defined) and the set of operations that say `[]`.

**A contributed scheme's presence belongs to the contributor's configuration.** A library
decides which schemes it contributes from its own options. Derive a document-level default from
the **same configuration the contributor reads**, never from a scheme name written as a literal:
a literal is right only for the configuration you wrote it against, and under another it either
describes one of two accepted credentials or fails the build as undeclared. The default's entries
are **alternatives** — any one satisfies an operation — and apply to every operation that states
nothing, so listing two credential families asserts that _either_ works for _every_ inheriting
route, which is false. Give the majority family the default and the minority explicit
`operationSecurity` entries, which outrank it.

### What the library contributes

With `includeCoreSchemas` on, the document carries the contracts this package serves, so an
operation can `$ref` them:

| Component                                                             | Describes                               |
| --------------------------------------------------------------------- | --------------------------------------- |
| `BymaxErrorEnvelope`, `BymaxErrorDetails`, `BymaxErrorCode`           | The error contract and its code catalog |
| `BymaxHealthResponse`, `BymaxHealthCheckEntry`                        | The liveness and readiness bodies       |
| `BymaxPageResult`, `BymaxPageMeta`, `BymaxCursorResult`               | The offset and cursor page shapes       |
| `BymaxPageQueryPage`, `BymaxPageQueryLimit`, `BymaxCursorQueryCursor` | The pagination query parameters         |

They are plain specification objects, not decorated classes: a decorator runs when its class is
defined, so `@ApiProperty` would load `@nestjs/swagger` in every application that imports this
package. A contributed entry never overwrites one the document already has.

The operations **reference** them: every operation gains a `default` response pointing at
`BymaxErrorEnvelope` (only while `envelope.enabled`, since otherwise errors are shaped by Nest or
your handler), and the health endpoints gain an explicit `200` pointing at `BymaxHealthResponse`.
A response is "already documented" when it declares a **shape** — `content`, or a bare `$ref` —
and is left alone; the placeholder `@nestjs/swagger` emits is filled in, keeping any description
you wrote. Both halves are one switch: `includeCoreSchemas: false` opts out of both, because a
reference to a schema that was not contributed would dangle.

### A library can describe its own routes

A library that ships controllers cannot document them itself: decorating them with
`@nestjs/swagger` would load that peer in every importing application, and a consumer-side map
keyed by path fails because a library mounted through `RouterModule.register` does not know its
final paths. So a library marks a provider and returns fragments keyed by **handler identity**,
which survives every prefix, version and mount point:

```ts
import { Injectable } from '@nestjs/common'
import {
  BymaxOpenApiContributor,
  BYMAX_OPENAPI_CONTRACT_VERSION
} from '@bymax-one/nest-core/openapi'
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
      contractVersion: BYMAX_OPENAPI_CONTRACT_VERSION,
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

Nothing is wired by the application: enabling the document runs the scan, and a library that is
never imported contributes nothing.

| Rule                  | Behavior                                                                                                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Marked, not shaped    | Only providers carrying the marker are called. A class that merely exposes `contributeOpenApi` is never touched.                                                               |
| Called once           | While the document is built, after options resolve — so a contributor may derive its contribution from its own configuration.                                                  |
| Stable order          | Contributors run sorted by class name, so two libraries describing the same operation resolve the same way on every boot.                                                      |
| Data, not mutation    | A contributor returns fragments; this package decides what to write. That is what makes precedence enforceable.                                                                |
| Named failures        | A marked class that cannot contribute, one that throws, or a fragment addressing a handler the application does not have all fail the document build naming the contributor.   |
| Versioned contract    | A fragment declares `contractVersion` as `BYMAX_OPENAPI_CONTRACT_VERSION`, currently `1`. A fragment declaring another version fails the document build, naming both versions. |
| Off with the document | With `openapi.enabled` false, no contributor runs.                                                                                                                             |

**Precedence, weakest first:** what this package infers about its own routes, then what a library
contributed, then what the consumer configured, and above all of them whatever the operation
already declared. So a deployment can always overrule a dependency's description of its own
routes through `operationSecurity`. **Operation ids are untouched:** this package installs an
operation-id factory to learn which handler produced which operation and delegates the id string
to `openapi.operationIdFactory`, or to the format `@nestjs/swagger` produces, so a client
generated before adopting this keeps working. A library that wants its schemas to track its own
validation decorators derives them in its own build and commits the result, with a test that
generated matches committed; this package takes no dependency on a validation library.

### The document describes _this_ deployment

A feature you turned off has its routes removed from the document: with
`metrics: { enabled: false }` the runtime answers `GET /metrics` with a 404 envelope, so a
document still listing it would describe something this deployment does not serve. Your own
routes are safe from the filter: it matches this package's paths including a global prefix, but
a tail match counts only when whatever precedes it also precedes every other path in the
document, so `/tenants/{id}/health/live` is never mistaken for the probe.

This package also documents the security of the routes it owns, without being asked:

| Route                               | Documented as                                           |
| ----------------------------------- | ------------------------------------------------------- |
| `GET /health/live`, `/health/ready` | Public (`security: []`), when a document default exists |
| `GET /metrics`, token set           | Bearer-protected                                        |
| `GET /metrics`, no token            | Public (`security: []`), when a document default exists |

The probes are polled by an orchestrator holding no credential, and the scrape endpoint is
protected exactly when you configured a token. An open route must **say** it is open rather than
inherit your document default: documenting a guarded route as open fails at the first client
that omits the credential, while documenting an open route as guarded fails nowhere. Your own
`operationSecurity` entry still wins.

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

A request with nothing recording, or an all-zero span context, resolves to no trace at all: the
fields are absent rather than set to a sentinel.

`exposeTraceId` is off by default: a trace id is not a secret, but in a response body it tells a
caller that a tracing backend exists and hands them the identifier that ties their request to
everything else in that trace. With it off, the identifiers still reach your samples and logs.

## 🔗 Integration with `@bymax-one/nest-logger`

Pairing this package with `@bymax-one/nest-logger` gives correlated logs and error responses
without either package importing the other. nest-logger's request-id middleware stores the id
under the `requestId` key of `LogContextService`, which has no `getCorrelationId()`, so adapt it
with a factory (`useExisting` would bind an object without that method, and the filter would read
no id). Bind both tokens from a `@Global()` module of your own:

```typescript
import { Global, Module } from '@nestjs/common'
import { BYMAX_CORRELATION_PROVIDER, BYMAX_UNEXPECTED_ERROR_SINK } from '@bymax-one/nest-core'
import type { ICorrelationIdProvider } from '@bymax-one/nest-core'
import {
  BymaxLoggerModule,
  LogContextService,
  PinoUnexpectedErrorSink
} from '@bymax-one/nest-logger'

@Global()
@Module({
  imports: [BymaxLoggerModule.forRoot({ service: { name: 'api', version: '1.0.0' } })],
  providers: [
    {
      provide: BYMAX_CORRELATION_PROVIDER,
      inject: [LogContextService],
      useFactory: (context: LogContextService): ICorrelationIdProvider => ({
        getCorrelationId: () => context.get<string>('requestId')
      })
    },
    { provide: BYMAX_UNEXPECTED_ERROR_SINK, useClass: PinoUnexpectedErrorSink }
  ],
  exports: [BYMAX_CORRELATION_PROVIDER, BYMAX_UNEXPECTED_ERROR_SINK]
})
export class ObservabilityModule {}
```

The id exists only once nest-logger's request-id middleware runs, and `BymaxLoggerModule` mounts
none on its own. Mount it in `main.ts`, or call `applyRequestIdMiddleware(consumer)` from a
module's `configure()`:

> **Express only.** nest-logger's request-id middleware supports
> `@nestjs/platform-express`; the Fastify adapter is unsupported, so do not
> rely on this correlation provider there.

```typescript
import { NestFactory } from '@nestjs/core'
import { applyAccessLog } from '@bymax-one/nest-logger'
import { AppModule } from './app.module'

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule)
  applyAccessLog(app) // opens the request context that carries `requestId`
  await app.listen(3000)
}
void bootstrap()
```

Every error envelope now carries the same correlation id your logs do, and the cause of every
collapsed `500` is logged with it (`PinoUnexpectedErrorSink` needs `@bymax-one/nest-logger` 1.4.1
or later). The same `@Global()`-module pattern overrides every pluggable token in this package.

## 🧱 HTTP Floors

`applyHttpFloors` (from `@bymax-one/nest-core/http`) is the HTTP-level protection that every
backend wants and none should tune per deployment. One call, before `app.init()` and `app.listen()`:

```typescript
import { NestFactory } from '@nestjs/core'
import { applyHttpFloors } from '@bymax-one/nest-core/http'
import { AppModule } from './app.module'

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule)
  await applyHttpFloors(app)
  await app.listen(3000)
}
void bootstrap()
```

| What                 | Default                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Security headers     | `helmet()` with `strictTransportSecurity: false` (TLS is normally ended in front of the app, which owns HSTS). Pass `helmet: { ... }` to tune it, for example the CSP of a browser-serving backend, or `helmet: false` to leave it out. An option given as `undefined` reads as unset, so `strictTransportSecurity: undefined` keeps HSTS off, as it does by default; an option given as `null` is refused, so a `null` from configuration never silently switches a header off. `helmet` must be an object or `false`, and an option name `helmet` does not have is refused at boot (`helmet` itself would ignore it). A switch (`xPoweredBy`, `noSniff`, `originAgentCluster`, `xXssProtection` and their aliases) takes `true` or `false`; any other option takes those or an object, and a value of another type is refused by name. What is inside an object is `helmet`'s to check, and when it refuses one the error names the option and not the value                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Request bodies       | The JSON and urlencoded parsers refuse a compressed body (`Content-Encoding`) with `415` instead of decompressing it, on every route and before routing. Only these two parsers: a raw or text parser you add yourself still decompresses. Each parser has its own explicit size limit (`bodyLimit`, below) and keeps the extended form syntax                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `headersTimeoutMs`   | `15000`: the longest a client may take to send its complete header block. Node's own default is 60 s, which leaves a header block sent a byte at a time open as a cheap denial of service                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `requestTimeoutMs`   | `30000`: the longest the server takes to receive a request, headers and body together. It does not bound the handler or the response. Node's default is 5 minutes. Must not be below `headersTimeoutMs`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `keepAliveTimeoutMs` | `65000`: how long an idle keep-alive connection is held open. Node's default is 5 s, which is below the 60 s idle timeout of the common load balancers and makes them reuse a socket Node has just closed, an intermittent `502`. Set it above your balancer's own idle timeout, for example `620000` behind a Google Cloud HTTP(S) balancer (600 s). Positive integer up to `2147483647`; a larger value would be read by Node as one millisecond.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `bodyLimit`          | `{ json: '100kb', urlencoded: '100kb' }`: the largest body each parser accepts, a byte count or a size such as `'1mb'`. A larger body is refused with `413` in the error envelope. The default is what Express applies when nothing is set, stated so it is a decision. An object with only `json` and `urlencoded`; each at most `256mb` (half of V8's longest string, which the JSON parser holds the body as; a larger upload is streamed, not parsed).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `cors`               | _(unset, `undefined` or `null`)_: cross-origin access is off. `{ origins: ['https://app.example.com'] }` allows exactly those origins (no path, no trailing slash, lower-case host, no `*` in the host, none listed twice; `https://app.example.com` does not admit another port or a longer host), `credentials: true` lets a browser send cookies and `Authorization` (a boolean, off unless asked), `methods` (`GET`, `HEAD`, `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS`, upper case), `allowedHeaders`, `exposedHeaders` and `maxAgeSeconds` tune the preflight, and any other key is refused. `['*']` alone allows every origin and is refused at boot together with `credentials`, as is an empty `origins` list (`methods`, `allowedHeaders` and `exposedHeaders` accept `[]`), a sparse list, an entry that is not an exact origin, and a header name in `allowedHeaders` or `exposedHeaders` that is not a token (a space, a colon or a line break in it). With a list of origins, a request from an origin that is not listed, or with no `Origin`, gets none of it: no allow-origin, no credentials, no preflight methods, headers or max age, no exposed headers, and an `OPTIONS` request is left to the application; `Vary: Origin` is set either way. The middleware is mounted right after helmet, ahead of the body parsers, so a preflight and a `413` or `415` refusal carry the headers |

Measured on Node 24, an idle keep-alive socket is closed about one second after `keepAliveTimeout`,
whatever `headersTimeout` is, so the two need no particular order, and closing the server with an
idle keep-alive socket open does not wait for it, so a long value does not delay shutdown.

### What the floors do not set

`requestTimeoutMs` bounds receiving the request, not serving it. Measured on Node 24 with
`requestTimeoutMs: 1000` and a handler that takes 2.5 s, the response came back `200` after 2510 ms.
Handler time and response writing are not bounded here (`server.timeout` stays `0`): handler time is
the job of [`handlerTimeout`](#handlertimeout), response writing that of the edge. The helper deliberately leaves
`server.timeout` and any socket idle timeout alone, because either would cut server-sent events and
long-poll streams.

It also sets none of these, so a deployment that needs them sets them itself or relies on the edge:

- a connection cap (`maxConnections`) and `maxRequestsPerSocket`, both unlimited;
- `maxHeaderSize`, left at Node's default;
- a slow-read limit on the response;
- a body size limit on a raw or text parser you add yourself, which has its own default; `bodyLimit`
  covers the JSON and urlencoded parsers only.

Node enforces both timeouts from a sweep over the open connections, not from a timer per
connection, and the sweep runs every 30 s by default: measured, a 1 s header timeout left a
dribbled header block open for 30 s. The helper therefore also sets the server's
`connectionsCheckingInterval` to one second (or the header timeout, if that is shorter), so a
connection is cut within a second of its timeout expiring. Nest creates the server without
exposing its options, so this is a property set before `listen()`: Node reads it when the server
starts listening, and the helper throws if the server is already listening. The sweep walks every
open connection each time, so a server holding very many sockets can set
`connectionsCheckingIntervalMs` higher, at the cost of cutting up to that long after the timeout.

**Order is part of the contract.** Call it before `app.init()` and right after `applyAccessLog` from
`@bymax-one/nest-logger`, and before everything that reads the request: helmet is mounted first,
so even a request the body parsers refuse carries the headers, and the parsers are registered
here so Nest's own defaults, which accept gzip, are not (an application that needs a raw body on a route mounts that parser before calling it). Cookie parsing, the trusted-proxy
setting and `applyBymaxOpenApi` stay with you and go after it. On an application that is already initialised the helper throws, because Nest's own parsers and the routes are registered ahead of anything mounted later:
`applyAccessLog` → `applyHttpFloors` → cookie parser → trusted proxies → `applyBymaxOpenApi`.

Express only; on another adapter it throws before applying anything. `helmet` is an optional
peer, loaded only when the helper runs, and a missing one fails with the install command. An
unusable timeout (zero, fractional, or a header timeout above the request timeout) throws
rather than leaving a socket limit switched off.

### Request deadline

`handlerTimeout` is armed in an interceptor, and Nest runs guards before interceptors, so a slow guard is
outside it. `applyHttpFloors(app, { requestDeadline: { timeoutMs, excludePaths } })` (`HttpFloorsRequestDeadline`) bounds the whole request:
a request that is still unanswered at `timeoutMs` gets `504` in the error envelope (`BYMAX_GATEWAY_TIMEOUT`),
once, and the signal `@HandlerSignal()` returns is aborted by it as well as by the handler timeout.

- **Off unless asked for**, and Express only, like the rest of the floors.
- **`excludePaths` is required** (it may be `[]`), up to 1000 path prefixes, each starting with `/` and matched
  at a segment boundary. The floors are mounted before the module, so nothing is taken from
  `handlerTimeout.excludePaths`: list an SSE or long-poll path in both. A WebSocket upgrade never goes through
  the middleware.
- The `504` is the answer: whatever the guard, the handler or the filter writes afterwards is dropped, so the
  response is sent once. A guard that is still running cannot be stopped; give it
  `@HandlerSignal()` to stop on the abort.
- Keep it above `handlerTimeout.timeoutMs`; if it is shorter, the deadline answers first.
- The `504` body carries `statusCode`, `code`, `message`, `timestamp` and `path`, and no `correlationId`: the floors
  write it themselves, not through the exception filter.

## 🚀 Production Checklist

What a backend built on this library sets before it takes traffic. Each line links to where it is
explained.

- Call [`applyHttpFloors`](#-http-floors) before `app.init()`, after the access log and before
  anything that reads the request; it throws on an initialised or listening application.
- Call `app.enableShutdownHooks()` so a `SIGTERM` flips readiness to `503`; `app.close()`
  always does.
- Set `server.keepAliveTimeout` above the load balancer's idle timeout, for example 61 s behind a
  60 s one.
- Bound handler time with `handlerTimeout` or at the edge, and slow reads at the edge: `requestTimeoutMs` does not.
- Set `metrics.authToken`, or restrict `/metrics` at the edge and set `metrics.edgeProtected: true`,
  when [metrics](#-metrics) are on: production refuses to boot with neither.
- Leave `health.exposeIndicatorErrors` off, and keep `health.readinessCacheMs` at its default unless a
  test needs every probe fresh.
- Turn on [`bodyDepth`](#bodydepth) for routes whose bodies reach a validator, and mind the raw
  parsers you add.
- Keep every metrics contributor's `collect()` bounded: past `metrics.scrapeTimeoutMs` the scrape
  answers `503`, but the collection keeps running. An indicator's `check()` is cut at
  `health.indicatorTimeoutMs`, but pass the `signal` on so the work stops too.
- Leave the OpenAPI document off in production; it is refused there anyway.

## 🔁 HTTP Idempotency

`@Idempotent()` (from `@bymax-one/nest-core/idempotency`) makes a route safe to retry: a repeat of a request
that carries the same `Idempotency-Key` header replays the first answer instead of running the handler again.

```ts
import { Body, Controller, Post } from '@nestjs/common'
import { Idempotent } from '@bymax-one/nest-core/idempotency'

@Controller('payments')
export class PaymentsController {
  @Post()
  @Idempotent({ scope: (request) => (request.user as { id?: string } | undefined)?.id ?? '' })
  create(@Body() body: { amount: number }): { id: string } {
    return { id: `pay_${body.amount}` }
  }
}
```

The module that declares the controller provides the store under `BYMAX_IDEMPOTENCY_STORE`. The package
ships `InMemoryIdempotencyStore` for one process; a deployment with several instances implements
`IIdempotencyStore` over a shared store (the port's atomicity contract is in its doc comment).

- **A scope is required**: a function returning the caller's identity, or `unscoped: true`. The storage key
  is a digest of the scope and the header, so one caller's key never resolves another's record.
- **The fingerprint** covers the method, the path, the query and the JSON body (keys sorted). A key reused
  by a different request is `422`.
- **The answer is replayed** with
  `Idempotent-Replayed: true`. A `4xx` answer is replayed too unless `storeClientErrors: false`; `408`, `425`
  and `429` never are, and a `5xx` releases the claim so the retry runs.
- **A request that is still running** gets `409` with `Retry-After: 1`. A caller that disconnects
  does not stop a handler that runs without `handlerTimeout`: a retry gets `409` while it runs and replays
  the stored answer once it has ended.
- **What is stored** is what the client was sent, taken at the response writers: the status, the body as
  text, and `content-type`, `location`, `content-location` and `etag`; never `set-cookie`. A replay sends
  those bytes with their own `content-length`, so an interceptor or serializer outside `@Idempotent` neither
  leaks a field into it nor wraps it twice. An answer with `content-encoding`, a stream, a `Buffer`, a body
  over `maxBodyBytes`, a body that is not UTF-8 or a `304` is sent untouched and replays as `409`. A `4xx` from
  an exception filter is stored the same way.
- **A failure after the handler returned** (an outer interceptor or serializer that throws) answers `5xx` and
  releases the claim, so the retry runs the handler again. An answer sent while the handler is still
  running, such as a timeout's, does not: when the handler then succeeds the claim is kept without a body,
  so the retry gets `409` `BYMAX_IDEMPOTENCY_NOT_REPLAYABLE` and the handler ran once; when it fails the
  claim is released; and a handler that `handlerTimeout` releases before it ends, more than one `timeoutMs`
  after the answer, leaves the key in progress until `leaseSeconds` ends. A replay replaces the
  first write below `400`, whatever its status: an outer interceptor that maps the replay's `undefined` to
  `204` is replaced too, while a write at `400` or above, such as an outer interceptor's error, goes out as it
  is.
- **The answer waits for the store** to record it, and is sent even when the store rejects. A store whose
  `complete` never settles holds the answer.
- **A store that fails** runs the handler unprotected (`onStoreError: 'fail-open'`, the default) or answers
  `503`; a `required` route always answers `503`.
- **Options**: `required` (missing header is `400`), `leaseSeconds` (60), `ttlSeconds` (86400, at most 7 days),
  `maxBodyBytes`, `storeClientErrors`, `onStoreError`. The lease must outlive the longest handler.
- **Refused at boot**: a handler that uses `@Res()` without passthrough, `@Next()`, `@Sse()`, `@Render()`, an
  uploaded file or a raw body. Write `@Idempotent` above `@Sse` and `@Render`.
- **Limits**: a multipart or otherwise unparsed body is not fingerprinted, so a key reused with another one
  replays; a replayed `HEAD` sends `content-length: 0`; `@Sse` written above `@Idempotent` truncates the
  stream and `@Render` written above it escapes the boot check (the first answer is sent, its replay answers `500`); a full in-memory store with `fail-open` runs the handler unprotected; a scope that holds a lone surrogate collides with the same scope
  written with `U+FFFD`.

| Code                                  | Status | Meaning                                                       |
| ------------------------------------- | ------ | ------------------------------------------------------------- |
| `BYMAX_IDEMPOTENCY_KEY_INVALID`       | 400    | The header is malformed, or the body cannot be fingerprinted. |
| `BYMAX_IDEMPOTENCY_KEY_REQUIRED`      | 400    | A required route got no header.                               |
| `BYMAX_IDEMPOTENCY_IN_PROGRESS`       | 409    | The first request is still running.                           |
| `BYMAX_IDEMPOTENCY_NOT_REPLAYABLE`    | 409    | The first answer could not be stored.                         |
| `BYMAX_IDEMPOTENCY_KEY_REUSED`        | 422    | The key belongs to a different request.                       |
| `BYMAX_IDEMPOTENCY_STORE_UNAVAILABLE` | 503    | The store, or the scope function, failed.                     |

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

Opt-in integrations attach to that spine rather than adding columns to it: a provider marked
`@BymaxHealthIndicator()` joins readiness, one marked `@BymaxMetricsContributor()` publishes on
the registry, telemetry puts the trace id on the envelope and the timing sample, and `./openapi`
serves the document in development. No request data is retained: the timing middleware emits
and forgets, and the pagination helpers are functions of their arguments.

### Design Principles

| Principle                          | Description                                                                                                                                                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🎭 **One shape for every failure** | A client's error handling is independent of which service failed and how. An unknown error becomes a generic 500 with a code, not a leaked stack                                                              |
| 🔌 **Enabled means registered**    | A feature that is off registers no provider at all, which is what keeps `prom-client`, `@nestjs/swagger`, `@opentelemetry/api` and `helmet` optional peers; the release gate asserts it on the packed tarball |
| 🧮 **Pure where it can be**        | Pagination is functions on their own subpath — no provider, no module, no container                                                                                                                           |
| 🧊 **Zero runtime dependencies**   | `dependencies` is `{}`. Every version you install is one you chose                                                                                                                                            |
| 🩺 **A probe cannot hang**         | The aggregator converts a rejecting or slow indicator to `down` itself                                                                                                                                        |
| 🧬 **Explicit DI tokens**          | Tokens are registered symbols (`Symbol.for`), so every bundle of this package resolves the same identity, and every injectable constructor parameter is decorated explicitly                                  |

---

## 🔐 Security Model

This library writes the response a client sees when something fails, and exposes the endpoints an
operator scrapes. Its security contract is about what those surfaces disclose.

### An error envelope is an exfiltration surface

An unknown error becomes a generic 500 whose body carries the fixed envelope fields and the
generic message, and not the cause unless `exposeInternals` is on. The original message and stack
go to the `BYMAX_UNEXPECTED_ERROR_SINK` seam when you bind one. `envelope.exposeInternals` exists
for local debugging only and defaults to `false`.

### The readiness response names the failure, it does not describe it

A failing indicator produces `{ name, status: 'down' }` and nothing else; the reason goes to the
logger. Readiness is usually unauthenticated, and a driver's error carries hosts, ports and, in a
connection string, credentials: in the response it is published to everyone who can reach the
endpoint, in the log it stays where access is controlled. `health.exposeIndicatorErrors` puts the
message back for local debugging, defaults to `false`, and carries the same warning as
`exposeInternals`. What reaches the log is the top-level `Error#message` only — never the raw
error, its stack or a nested cause — truncated at 300 characters. A slow indicator is converted to
`down` by the aggregator, and its `timedOutAfterMs` stays in the response because that number is
one this library chose.

### A metric an attack cannot be seen in is not a control

Request timing is a security signal: a credential-stuffing run is a flood of `401`s, a privilege
probe a flood of `403`s, route enumeration a flood of `404`s, and a rate limiter doing its job a
flood of `429`s. None reaches a handler, so a recorder placed after the guards sees none of them.
The recorder is middleware for that reason, and every closed request is counted whatever ended it.

### A route label is attacker-controlled input

The label on a timing sample comes from the matched route **template**, and a request that matched
nothing is recorded under the constant `UNMATCHED_ROUTE` (`<unmatched>`), never the requested
path. Following the path would let anyone mint one Prometheus time series per probe and grow the
registry without bound.

### Cursors are opaque, not secret

`encodeCursor` produces a token a client can round-trip; it is neither encrypted nor
authenticated. Put nothing in a cursor the client may not read, and do not treat one as proof of
anything.

### The metrics endpoint is a route like any other

It is off by default. When on, nothing authenticates it unless you set `metrics.authToken`: apply
the guard you would apply to any internal endpoint, or keep it off the public listener.

### The OpenAPI document does not exist in production

A published document maps every route, parameter and error shape, which is as useful to someone
probing the service as to a developer. So unlike the metrics endpoint it is not left to a guard:
it is refused whenever the runtime is not positively `development` or `test`, in two independent
layers. **`NODE_ENV` cannot be overridden.** A runtime that declares nothing is classified from the
application's own [`environment`](#environment) when it supplied one, and counts as production
otherwise.

---

## 🛡️ Security Table

| Layer               | Implementation                                                                                                                                                                                                                |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Error responses     | One shape for everything; unknown errors become a generic 500                                                                                                                                                                 |
| Internals           | Message and stack handed to the unexpected-error sink when bound, in the body only under `exposeInternals` (default `false`)                                                                                                  |
| Health output       | The response carries each indicator's name and status, never the `details` it returned; a failing indicator's reason goes to the logger. `exposeIndicatorErrors` (default `false`) puts it back in the response for debugging |
| Slow indicators     | Converted to `down` by the aggregator, so a probe cannot hang on one                                                                                                                                                          |
| Correlation         | Resolved through `BYMAX_CORRELATION_PROVIDER` — the app decides where the id comes from                                                                                                                                       |
| Body nesting        | Opt-in `bodyDepth` refuses a body nested deeper than `maxDepth` with a `400`, so a few kilobytes of nested arrays cannot overflow a recursive validator into a `500`                                                          |
| HTTP floors         | `applyHttpFloors`: compressed request bodies refused with `415`, header and request timeouts of 15 s and 30 s, `helmet` headers without HSTS                                                                                  |
| Request accounting  | Every closed request is counted, including the ones a guard rejected (`401`/`403`/`429`) and the ones that matched no route (`404`), so an attack in progress moves the graph                                                 |
| Route labels        | Taken from the matched template; an unmatched request records the constant `<unmatched>`, never the requested path, so a scan cannot grow the metric registry without bound                                                   |
| Pagination cursors  | Opaque, not authenticated; treated as client-supplied input on the way back in                                                                                                                                                |
| Metrics             | Opt-in; `prom-client` never imported while it is off                                                                                                                                                                          |
| OpenAPI             | Opt-in and development-only; refused in production by two independent guards, `@nestjs/swagger` never imported while it is off                                                                                                |
| Discovered checks   | Matched by an explicit marker, never by shape; off by default, because it lets an imported library fail your readiness probe                                                                                                  |
| Contributed metrics | Called only when marked; a name collision fails the boot naming the contributor rather than half-populating a scrape                                                                                                          |
| Trace ids           | Read-only, never used as a metric label; published in a response body only under `telemetry.exposeTraceId` (default off)                                                                                                      |
| Supply chain        | `dependencies: {}`; third-party Actions pinned by commit SHA (org-internal reusables by tag); CodeQL and OpenSSF Scorecard                                                                                                    |

> [!IMPORTANT]
> **`exposeInternals` is a debugging switch, not a verbosity setting.** With it on,
> the body of a 500 carries the original message and stack of whatever failed, and the
> `details` of any 5xx `HttpException` — including anything a driver, an SDK or a
> template put in them.

---

## 🧱 Tech Stack

- **Runtime:** Node.js 24+
- **Framework:** NestJS 11 (`ConfigurableModuleBuilder`, `APP_FILTER`, `NestModule.configure`)
- **Peers:** `@nestjs/common ^11`, `@nestjs/core ^11`, `rxjs ^7`, `reflect-metadata ^0.2`
- **Optional peers:** `prom-client ^15` when metrics are enabled, `@nestjs/swagger ^11` when
  OpenAPI is enabled, `@opentelemetry/api ^1.9` when trace correlation is enabled, `helmet ^8`
  when `applyHttpFloors` runs — none is imported while its feature is off
- **Adapters:** Express and Fastify for timing, the filter and health; the body-depth guard and
  `applyHttpFloors` are Express only
- **Build:** tsup — ESM + CJS per subpath, with `.d.ts` _and_ `.d.cts` declarations
- **Tests:** Jest (unit + e2e over real Nest applications, Express **and** Fastify) + Stryker (mutation)
- **TypeScript:** 5.x strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), zero `any`

---

## 🧪 Testing & Quality

This library sits in the path of every request and every failure of every service that
installs it, so the suite is held to a bar beyond "the tests pass".

- ✅ **100% line coverage** — statements, branches, functions and lines, enforced as a gate
- ✅ **100% mutation score** — [Stryker](https://stryker-mutator.io/) runs with `break: 100`, so
  a surviving mutant fails the run; a mutant no test can kill carries its reason on the line it
  applies to ([report](./docs/mutation_testing_results.md))
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
pnpm mutation      # Stryker mutation testing (break: 100)
pnpm typecheck     # tsc strict check
pnpm lint          # ESLint
```

---

## 📖 API Reference

Every export of every subpath, for quick lookup; each is documented in detail
in the sections above.

### `.` (root)

| Export                                                                                                                                                                                                                               | Kind      | Description                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `BymaxCoreModule`                                                                                                                                                                                                                    | class     | The dynamic module: `forRoot` and `forRootAsync`.                                                                                                                                                                                                                                                                                          |
| `BymaxCoreModuleOptions`, `EnvelopeOptions`, `TimingOptions`, `BodyDepthOptions`, `HealthOptions`, `MetricsOptions`, `TelemetryOptions`, `OpenApiOptions`, `OpenApiServerDescriptor`, `OpenApiSecurityScheme`, `ResolvedCoreOptions` | types     | The options surface and its resolved shape.                                                                                                                                                                                                                                                                                                |
| `OpenApiSecurityRequirement`, `OpenApiHttpMethod`, `OpenApiOperationKey`, `OperationSecurityMap`                                                                                                                                     | types     | The operation-key contract a sibling library targets to ship its own security map.                                                                                                                                                                                                                                                         |
| `OpenApiOperationIdFactory`                                                                                                                                                                                                          | type      | Names the operations in the generated document.                                                                                                                                                                                                                                                                                            |
| `BYMAX_CORE_OPTIONS`, `BYMAX_CORRELATION_PROVIDER`, `BYMAX_TIMING_SINK`, `BYMAX_HEALTH_INDICATORS`, `BYMAX_HEALTH_TRANSITION_SINK`, `BYMAX_UNEXPECTED_ERROR_SINK`, `BYMAX_METRICS_REGISTRY`, `BYMAX_TRACE_CONTEXT`                   | tokens    | The DI tokens; see the [token table](#-di-tokens).                                                                                                                                                                                                                                                                                         |
| `IHealthTransitionSink`, `HealthTransition`, `HealthTransitionCause`                                                                                                                                                                 | types     | The readiness-transition contract; also on `./health`.                                                                                                                                                                                                                                                                                     |
| `ICorrelationIdProvider`                                                                                                                                                                                                             | type      | The correlation-provider contract.                                                                                                                                                                                                                                                                                                         |
| `ITraceContextProvider`, `TraceContext`                                                                                                                                                                                              | types     | The trace-context contract and the identifiers it resolves.                                                                                                                                                                                                                                                                                |
| `BymaxExceptionFilter`                                                                                                                                                                                                               | class     | The envelope exception filter.                                                                                                                                                                                                                                                                                                             |
| `NonErrorThrownError`                                                                                                                                                                                                                | class     | The `Error` this package logs or chains for something your code threw that is not an `Error`; the value is its `cause`. `instanceof` answers for an instance made by any entry of this package.                                                                                                                                            |
| `FilterErrorContext`                                                                                                                                                                                                                 | type      | The neutral request context passed to the filter's observability seam.                                                                                                                                                                                                                                                                     |
| `IUnexpectedErrorSink`, `UnexpectedErrorReport`                                                                                                                                                                                      | types     | Receives the cause behind each collapsed `500 BYMAX_INTERNAL_ERROR`; see [Recording the cause of a 500](#recording-the-cause-of-a-500).                                                                                                                                                                                                    |
| `buildErrorEnvelope`                                                                                                                                                                                                                 | function  | Pure builder assembling an `ErrorEnvelope`.                                                                                                                                                                                                                                                                                                |
| `ErrorEnvelope`, `ErrorDetails`, `BuildErrorEnvelopeInput`                                                                                                                                                                           | types     | The envelope contract and its builder input.                                                                                                                                                                                                                                                                                               |
| `BymaxTimingMiddleware`                                                                                                                                                                                                              | class     | The request-timing middleware, applied to every route when timing is enabled.                                                                                                                                                                                                                                                              |
| `BymaxBodyDepthMiddleware`                                                                                                                                                                                                           | class     | Refuses a body nested deeper than `bodyDepth.maxDepth` with a `400`; applied to every route, after the timing middleware, only when `bodyDepth.enabled` is true.                                                                                                                                                                           |
| `UNMATCHED_ROUTE`                                                                                                                                                                                                                    | constant  | The bounded label recorded when a request matched no route (`<unmatched>`).                                                                                                                                                                                                                                                                |
| `TimingInterceptor`                                                                                                                                                                                                                  | class     | **Deprecated, registered nowhere.** `BymaxTimingMiddleware` replaced it as the recorder because guards run before interceptors, so it never saw a request a guard rejected; wiring it by hand next to the middleware records a second sample for every request that reaches a handler. Kept so code that wired it by hand keeps compiling. |
| `ITimingSink`, `RequestTimingSample`                                                                                                                                                                                                 | types     | The timing-sink contract and its sample shape.                                                                                                                                                                                                                                                                                             |
| `BYMAX_BAD_GATEWAY` … `BYMAX_VALIDATION_FAILED`                                                                                                                                                                                      | constants | The full error-code catalog (see [Error envelope](#-error-envelope)).                                                                                                                                                                                                                                                                      |
| `codeForStatus`                                                                                                                                                                                                                      | function  | Derives a catalog code from an HTTP status.                                                                                                                                                                                                                                                                                                |

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

### `./http`

| Export                                         | Kind     | Description                                                                               |
| ---------------------------------------------- | -------- | ----------------------------------------------------------------------------------------- |
| `applyHttpFloors`                              | function | Applies the headers, the body-parser floor and the timeouts; call it before `app.init()`. |
| `HttpFloorsOptions`, `HttpFloorsHelmetOptions` | types    | The `helmet`, `headersTimeoutMs` and `requestTimeoutMs` options.                          |
| `HttpFloorsCorsOptions`                        | type     | The `cors` allowlist.                                                                     |
| `HttpFloorsBodyLimit`, `HttpBodyLimit`         | types    | The `bodyLimit` object, and one parser's limit (a byte count or a size string).           |

### `./idempotency`

| Export                                               | Kind     | Description                                                                                                    |
| ---------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------- |
| `Idempotent`                                         | function | The route decorator; takes `IdempotentOptions`, a `ScopedIdempotentOptions` or an `UnscopedIdempotentOptions`. |
| `IdempotencyInterceptor`                             | class    | The interceptor `@Idempotent` attaches; it reads `BYMAX_IDEMPOTENCY_STORE`.                                    |
| `BYMAX_IDEMPOTENCY_STORE`                            | token    | Where the application provides its store.                                                                      |
| `IIdempotencyStore`                                  | type     | The port: `begin`, `complete` and `release`, addressed by a hashed key.                                        |
| `IdempotencyBeginResult`, `IdempotencyRecord`        | types    | What `begin` returns, and what a store holds under a key.                                                      |
| `IdempotencyStoredResponse`, `StoredResponseHeaders` | types    | The answer a store keeps and its allow-listed headers.                                                         |
| `InMemoryIdempotencyStore`                           | class    | A single-process store.                                                                                        |
| `IdempotencyRequest`, `IdempotencyStoreErrorMode`    | types    | The request a `scope` function reads, and `'fail-open'` or `'fail-closed'`.                                    |

### `./openapi`

| Export                                                                                 | Kind                | Description                                                                                       |
| -------------------------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------- |
| `applyBymaxOpenApi`                                                                    | function            | Builds and mounts the document; call it before `app.listen()`.                                    |
| `OpenApiMountOutcome`                                                                  | type                | What the helper did: mounted at a path, or skipped with a reason.                                 |
| `DiscardedComponent`                                                                   | type                | A contributed component entry the document already declared.                                      |
| `OpenApiSkipReason`                                                                    | type                | Why it was skipped: `'disabled'` or `'production'`.                                               |
| `BymaxOpenApiContributor`, `BYMAX_OPENAPI_CONTRIBUTOR_METADATA`                        | decorator, constant | Marks a provider as describing its own routes, and the metadata key behind it.                    |
| `BYMAX_OPENAPI_CONTRACT_VERSION`                                                       | constant            | The version of the fragment contract, currently `1`; a fragment declares it as `contractVersion`. |
| `IOpenApiContributor`, `OpenApiFragment`, `OpenApiFragmentObject`, `OpenApiHandlerKey` | types               | The contributor contract and the shape of what it returns.                                        |

## 🚫 What This Library Does NOT Do

- **It mints no request id.** `correlationId` is whatever the `BYMAX_CORRELATION_PROVIDER` you
  bind returns; with none bound the field is absent.
- **It creates no span and configures no OpenTelemetry SDK.** Trace correlation only reads the
  span your instrumentation already opened.
- **It validates no request body.** There is no validation pipe here; `bodyDepth` only bounds
  nesting, ahead of yours.
- **It authenticates and authorizes nothing.** The one credential it knows is the optional
  `metrics.authToken`; guards, sessions and roles are yours.
- **It keeps no request data.** Timing samples go to the sink you register.
- **It does not cover GraphQL or RPC execution contexts.** The error envelope and request timing
  pass those through untouched.
- **It does not cover Fastify** for the body-depth guard, `applyHttpFloors`, or the fixed messages
  of refusals raised before routing. Request timing and the envelope's path handling are
  asserted end to end on both Express and Fastify.
- **It never serves the OpenAPI document in production,** whatever the configuration says.

## 🤝 Contributing

Pull requests are welcome. Please open an issue first for significant changes.

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
