# Changelog

All notable changes to `@bymax-one/nest-core` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The `release.yml` workflow extracts the section matching the pushed `vX.Y.Z` tag
as the GitHub Release body, so each released version needs a matching `## [X.Y.Z]`
heading here.

## [Unreleased]

## [1.6.0] - 2026-08-29

A readiness check that fails without rejecting left no record an operator would
ever read, and one that fails by rejecting left one per probe. Both are the same
missing seam, and this release adds it: the aggregator now holds the last state
of every check and reports each **change** — to its own logger, and to an
optional sink a consumer binds.

**Apply to a derived backend:** nothing is required. Transitions now reach Nest's
logger on every path, where before only a rejection did. Bind
`BYMAX_HEALTH_TRANSITION_SINK` to route them into a structured logging surface,
and read `cause.kind` to tell the three failure shapes apart. If you have written
a health reporter of your own, delete it — including any wrapper that races a
timer beneath `health.indicatorTimeoutMs` to recover a verdict, which this seam
makes unnecessary.

### Added

- **`IHealthTransitionSink`, bound under `BYMAX_HEALTH_TRANSITION_SINK`.**
  Receives one `HealthTransition` per change of readiness state, per check name —
  never one per probe. `@Optional()` and unbound by default, like
  `BYMAX_HEALTH_INDICATORS`, so a consumer's binding is never shadowed by a local
  one.

  With no sink the aggregator writes the transition to Nest's logger, so a
  readiness failure is never silent by default; binding one stands that line down
  in favour of the sink. Both destinations are usually the same logger in a
  consuming application, and two records of one transition side by side is the
  noise this feature exists to remove. The sink is handed the cause as structured
  data, strictly more than the line renders, so what reaches the log after that
  is the consumer's decision rather than this package's.

  The de-duplication rule lives in the aggregator rather than in the sink, and
  that is the whole point. A readiness check runs every few seconds, so a line
  per failing probe turns one outage into thousands of identical records that
  bury the one carrying the cause; leaving that rule to each consumer means every
  backend re-deriving it, slightly differently. A sink that never sees raw
  outcomes cannot get it wrong.

  Overlapping probes are ordered by when they started, not by when they
  finished. Readiness is not called one at a time — an orchestrator's probe and a
  load balancer's health check reach it concurrently — and a dependency that
  hangs until the bound elapses is exactly what makes an earlier probe finish
  last. Comparing states alone would write such an outage backwards: the later
  probe reports the recovery, and the earlier one's timeout lands behind it and
  reports the dependency down again on evidence that is already stale.

  The rule is asymmetric on a first observation, deliberately. A first
  observation that is **failing** is reported — a process that boots against a
  dependency already down would otherwise look healthy in the log forever — while
  a first observation that is healthy is not, since announcing the expected state
  would write one line per dependency on every boot.

- **`HealthTransitionCause`, distinguishing the three ways a check is down.**
  `reported-down` (the indicator answered and said so), `rejected` (carrying the
  summarized message, bounded to 300 characters), and `timed-out` (carrying the
  `timeoutMs` that elapsed). A discriminated union rather than a string, so a
  consumer switches exhaustively and the compiler names the arm it has not
  handled if a future version adds one.

  `timed-out` is the one that exists nowhere else. An indicator this package
  gave up on is never told, so it reports nothing, and a consumer racing its own
  timer beneath `indicatorTimeoutMs` still never learns the bound that actually
  applied. A hung dependency is also the common shape rather than a refused one:
  a database under load, a network partition and a paused container all hang,
  while a refusal returns immediately and would have been reported. The obstacle
  for a consumer is information, not effort — which is the argument for this
  living in the library at all.

### Fixed

- **An `Error` whose `message` is not a string broke the readiness aggregation.**
  `message` is a writable property, so `Object.assign(new Error(), { message:
null })` is an `Error` that reads without throwing and then throws on every
  string operation. The summarizer coerced a non-`Error` reason but trusted an
  `Error`'s own `message`, then measured and truncated it outside that guard.

  It surfaced where the guard was supposed to hold. Summarizing runs inside the
  rejection-to-`down` conversion, so an indicator rejecting with such an error
  rejected the whole aggregation: the probe answered `500` instead of `503`, and
  reported nothing about the dependencies that were healthy — the exact outcome
  the conversion exists to prevent.

  **This is present in 1.5.3 and earlier**, on the indicator path. The transition
  sink added in this release reaches the same summarizer, so the fix covers both.

- **An `async` timing sink could take the process down.** `ITimingSink.record`
  is declared to return `void`, and TypeScript accepts any return value in a
  void-returning position, so `async record()` compiles — and it is the natural
  shape when the backend behind the sink is async. Its rejection settled a
  microtask after the recorder's `try`/`catch` had exited, so instead of the
  contained failure the contract promises it became an unhandled rejection, able
  to kill the process under `--unhandled-rejections=strict`. An observer that can
  break what it observes is the one thing a fire-and-forget contract exists to
  rule out.

  Both the middleware and the deprecated interceptor were affected, and both now
  route delivery through one implementation rather than two copies of the same
  `try`/`catch` — the containment guarantee is worth exactly as much as its least
  careful copy. Nothing to change in a consumer: a sink that already returned
  synchronously behaves identically, and an `async` one is now caught.

  Found while reviewing the health transition sink, which had the same hole
  before release.

### Changed

- **A rejecting indicator is logged once per outage, not once per probe.** The
  aggregator already wrote a warning for a rejection, on every readiness check
  for as long as the dependency stayed down: roughly sixty identical lines for a
  ten-minute outage probed every ten seconds. That line now follows the
  transition rule like every other path. No API moves; log volume does, and a
  recovery now writes a line where nothing did before.

  This arrives with the upgrade, not with the binding — a deployment that wires
  no sink still stops repeating.

  The cost is stated rather than hidden: a dependency that stays down while its
  failure mode changes underneath keeps the cause observed **at the transition**.
  That is the trade for one line per outage instead of one per probe.

- **The root bundle's size budget moved from 15 to 17 KiB brotli**, measured
  14.25 → 15.82. Checked before the number moved: the transition contract is
  types-only and erases at build time, no module entered the root that was not
  already there, and the rationale prose was moved into the erased file — this
  bundle ships its comments — before the budget was touched.

## [1.5.3] - 2026-08-18

Three findings from a functional and security audit of a derived backend
running against real Postgres, Redis and MinIO, plus the corrections that
review found inside those fixes.

The one that reaches a running deployment: an unprotected `/metrics` was
documented as **requiring a credential**. The endpoint answers anyone when no
`metrics.authToken` is set — the documented "protected at the edge"
arrangement — and it inherited the document-level default instead of declaring
itself public. That is the opposite of what 1.5.0 fixed and the more dangerous
direction: documenting a guarded route as open fails loudly at the first
generated client that omits the credential, while documenting an open route as
guarded fails nowhere and hands the wrong answer to whoever opened the document
to ask what is exposed.

**Apply to a derived backend:** bump the dependency. Nothing to change in code.
If you serve a document and leave the scrape endpoint unprotected, re-render it
and confirm `/metrics` now carries `security: []`. If your page indexes reach
SQL, `maxOffset` is now available and is opt-in.

### Fixed

- **An unprotected `/metrics` was documented as requiring a credential.** This
  package writes an explicit `security: []` on its health probes so they do not
  inherit a document-level default, and did not do the same for the scrape
  endpoint. With `metrics.authToken` unset — the documented "protected at the
  edge" arrangement, where the endpoint answers anyone — `GET /metrics` fell
  through and inherited the default, so a document served by any backend with a
  default claimed a credential was required for an endpoint serving process
  metrics to whoever asked.

  Measured on a running derived backend, not reasoned about: no credential →
  `200` with the full Prometheus body, while the served document said
  `security: [{ bymaxAuthAccessCookie: [] }]`.

  **One half of the fix is covered by unit tests only, and that is worth saying
  rather than leaving it to look field-verified.** The reported symptom reaches
  a deployment through `openapi.security`, and that path was measured. Review
  then found the same hole on the other path — a document that arrives carrying
  its own default, whose `openapi.security` is therefore empty — and it is fixed
  by reading the effective default from the document that will be served. No
  consumer known to this project reaches that state today, so the only coverage
  that can be pointed at is this repository's tests — which is a statement about
  what is known, not a guarantee that nothing else exercises it. The health probes carried the same defect on
  that path and are fixed by the same change.

  This is the more dangerous of the two ways to describe a route wrongly, and
  the opposite of what 1.5.0 fixed. Documenting a **guarded** route as open
  fails loudly — a generated client omits the credential and gets a `401`.
  Documenting an **open** route as guarded fails nowhere, and hands the wrong
  answer to whoever opened the document to ask what is exposed.

### Added

- **`maxOffset`, a bound on how far into a dataset a request may start.**
  `normalizePageQuery` capped the page size through `maxLimit` and bounded the
  page index only for arithmetic safety, so `?page=1000000000&limit=20` resolved
  to `OFFSET 19999999980`. Harmless against an in-memory repository and paid in
  full by an offset-paginated database: twenty bytes of query for a table scan.

  It is **absent by default and deliberately so** — legitimate deep paging
  exists, and a silent ceiling would change the rows a working query returns.
  Set it wherever the page index reaches SQL. `0` is a valid bound meaning "the
  first page only"; any value that is not a non-negative safe integer reads as
  absent rather than as an invented cap. Clamping matches how `maxLimit` already
  behaves, and the resolved values come back in `meta`.

### Documentation

- **What the error filter classifies from, and what it cannot.** An error raised
  before any handler ran becomes a clean `4xx` because the filter recognizes it
  by **shape** — `expose: true` with a `4xx` status, the convention Node's body
  pipeline follows — not by class. An error carrying no such marking is a `500`
  even when a client caused it: a few kilobytes nested thousands of levels deep
  overflows the stack during validation and surfaces as `RangeError`, well under
  any size limit.

  That is deliberate. Mapping `RangeError` to a `4xx` would make the filter
  infer causation from an error class and would be wrong where it matters most —
  a genuine stack overflow in application code is a `500` that should page
  someone. Body-shape limits are the application's floor, applied in the one
  window where the body exists and nothing has walked it yet.

  **Apply to a derived backend:** cap nesting depth **after the body parser and
  before validation**, so a hostile body is rejected as the `400` it is instead
  of becoming a `5xx` that pollutes your error rate and writes a stack per
  request. On Express that means module middleware, not `app.use()` during
  bootstrap — measured, a middleware registered there runs ahead of Nest's own
  parser and sees `req.body` as `undefined`, so the guard inspects nothing and
  protects nothing while reading as present. Walk the parsed body iteratively; a
  recursive depth check on a hostile payload overflows the stack it exists to
  protect. The README carries the per-adapter table and a test that proves the
  floor by behaviour rather than by where it is registered.

## [1.5.2] - 2026-08-15

The production guard read `NODE_ENV` and nothing else, and treated an unset
variable as production. An application that validates its own `APP_ENV` and
never sets `NODE_ENV` was therefore classified as production on evidence it
never gave — the OpenAPI document was refused in a development deployment, with
no way to answer back. Two independent consumers reported the same split.

**Apply to a derived backend:** nothing to change. A deployment that sets
`NODE_ENV` behaves exactly as before. If yours validates its own variable
instead, pass it as `environment` and the document is served where that variable
says `development` or `test`.

### Added

- **`environment`, for applications that validate their own environment
  variable.** The production guard read `NODE_ENV` and nothing else, and treated
  an unset variable as production. An application that parses an `APP_ENV`
  through its config schema and never sets `NODE_ENV` was therefore classified
  as production on evidence it never gave — the OpenAPI document was refused in
  a development deployment, with no way to answer back. Two independent
  consumers reported the same split between the library's view of the
  environment and their own validated one.

  A top-level `environment` option is now consulted **where the process declares
  nothing**: `NODE_ENV` unset, or set to whitespace. `NODE_ENV` wins whenever it
  says anything at all, so no configured value can make a runtime that named
  itself production serve the document — asserted in both guards rather than in
  one. The declaration enters the same fail-closed classification, so an
  unrecognized name is production like any other: this is a second source for
  the value, never a second set of rules.

  The narrowing is stated rather than buried. Both guards previously classified
  from the process alone; now, in the single case where the process says
  nothing, the snapshot a consumer bound decides the answer, because there is
  nothing else to decide it with. Replacing a guess with a declaration is not an
  override, but it is a real change to what the second guard depends on.

  **Apply to a derived backend:** nothing to change. The option is optional and
  every existing classification is unchanged — a deployment that sets `NODE_ENV`
  behaves exactly as before.

## [1.5.1] - 2026-08-15

Documentation only; no source change. The 1.5.0 warning's known-limit note told
readers that no tool could catch the one shape the warning cannot report, and
that rendering the document twice was therefore the only check. That is true
only of something reading the rendered document alone — a consumer's own suite
knows the intent and can assert it on every commit — so the note was arguing
against the better practice.

**Apply to a derived backend:** nothing to change in code. Read the revised
"Documenting authentication" section and write the assertion it now shows; it
costs one test and replaces a manual step nobody remembers to run.

### Documentation

- **The credential-free warning's known limit no longer argues against the
  practice that covers it.** The README said no tool could distinguish a
  document that lost its requirements from one that never had any, and that
  rendering the document twice was therefore the only check. The first half is
  true only of something reading the rendered document alone; a consumer's own
  suite knows which of the two it is and can assert it on every commit. Saying
  otherwise did not merely overstate a limit — it told readers that the standing
  check they should write does not exist. The section now attributes the limit
  correctly, states why the warning cannot fire on that shape (it follows from
  the trigger, in every version), gives the assertion as the practice, and
  leaves render-and-diff the narrower job it is genuinely good at: seeing what
  moved when you change something, so you can turn it into an assertion.

- **A contributed scheme's presence is documented as part of the contributor's
  configuration.** Which security schemes a library contributes can depend on
  how that library is configured — the names are stable, their presence is not.
  A document-level default must therefore be derived from the same configuration
  the contributor reads. A literal is correct only for the configuration it was
  written against: elsewhere it either resolves while describing one of two
  credentials a route accepts (quietly incomplete) or names a scheme nobody
  declares (a failed document build). Guarding on whether the scheme exists
  clears the loud case and ships the quiet one.

- **What a document-level default does not let you say** is now stated. Its
  entries are alternatives applied to every operation that says nothing, so a
  backend with two credential families _can_ list both and nothing rejects it —
  the result asserts that either credential works for every inheriting route,
  which is false in the permissive direction. The minority family belongs in
  `openapi.operationSecurity`, which outranks the default.

## [1.5.0] - 2026-08-15

An OpenAPI document could stop requiring credentials without anything saying
so. Deleting a document-level `security` default — typically alongside the
per-operation entries a library has taken over describing — leaves every route
the backend itself owns with no requirement from any source, and the document
stays valid, no requirement dangles, and the runtime still answers `401`. The
only observable change is that a client generated from the document stops
sending credentials.

**Apply to a derived backend:** bump the dependency. No code change is needed.
If the boot log now names operations, they are the ones a generated client will
call without credentials — set `openapi.security`, or mark each public with an
explicit `[]` in `openapi.operationSecurity`.

### Added

- **The document build warns when an operation ends up requiring no credential
  at all.** Deleting a document-level `security` default — typically alongside
  the per-operation entries a library has taken over describing — leaves every
  route the backend itself owns with no requirement from any source. Nothing
  catches it today: the document is valid, no requirement dangles so
  `assertSchemesDeclared` is satisfied, the runtime still answers `401` so a
  status-code probe finds nothing, and a consumer's document test stays green if
  it asserts only the operations it enumerated. The only observable change is
  that a client generated from the document sends no credentials.
  `applyBymaxOpenApi` now emits one warning per build naming the affected
  operations, capped at ten with a count of the rest.

  It warns and never throws — an API that is public on purpose is legitimate —
  and the trigger is narrow so the line stays worth reading: only when the
  document declares no top-level `security`, **and** at least one other
  operation does state a requirement, **and** the operation is not one of the
  three this package registers. An explicit `[]` — from `operationSecurity`, a
  decorator, or a library's fragment — states the intent and stops the report.
  The known limit is documented rather than closed: a document with nothing
  explicit anywhere is indistinguishable from an API that is public on purpose,
  so removing _every_ requirement at once is not warned. Render the document
  with and without your libraries and diff the operations you mount.

## [1.4.0] - 2026-08-13

HTTP metrics were blind to every request that did not reach a handler. Nest runs
**middleware → guards → interceptors → pipes → handler**, and the recorder was an
interceptor, so authentication failures, authorization failures, throttled
requests and unknown paths were never counted. Measured on a running
application, three requests — a handler success, a guard rejection, an unknown
path — produced **one** sample. A deployment could be under a credential-stuffing
run, a privilege probe or route enumeration with a flat error graph, which makes
this a security fix rather than an observability improvement.

**Apply to a derived backend:** bump the dependency. No code change is needed.
Expect new `401`/`403`/`429` series on routes that already existed, a new
`route="<unmatched>"` series for `404`s, and a **lower success rate** — the
denominator finally includes the rejections. Existing `status_code="200"` series
keep their values.

### Security

- **Requests rejected before a handler are now counted.** The recorder moved
  from `APP_INTERCEPTOR` to middleware (`BymaxTimingMiddleware`), applied to
  every route when `timing.enabled` is `true`. Nest runs middleware, then
  guards, then interceptors: a request a guard rejects never reached
  `intercept()`, and a request matching no route never reached a controller.
  Measured on a real application, three requests — a handler success, a guard
  rejection and an unknown path — produced exactly **one** sample. `401`, `403`,
  `429` and `404` were all invisible, which is to say a deployment could be under
  a credential-stuffing run, a privilege probe or route enumeration with a flat
  error graph. All six cases are now counted, and the sample is emitted on the
  response's `'close'` event rather than `'finish'`, so a client that hangs up
  mid-request — what a scanner does — is counted too.
- **The root path is recorded.** On Express the middleware is mounted at `'/'`
  rather than through a wildcard pattern. The unbraced `'*splat'` skips the root outright,
  and the braced `'{*splat}'` that Nest 11's migration guide prescribes stops
  matching the _prefixed_ root once an application calls `setGlobalPrefix` —
  which production applications almost always do. That was reported as
  nest#14520 and fixed by nest#14522, whose regression test covers Fastify;
  measured on `@nestjs/core` 11.1.28 with the Express adapter, the prefixed root
  still reaches no middleware while the route itself answers `200`. Both
  patterns were measured against the mount, which matched every path in both
  configurations. Fastify needs the opposite choice — see the next entry. One
  limit remains and is documented: module middleware is scoped to the global
  prefix, so a request outside it entirely reaches no middleware.
- **Fastify records the same labels as Express**, which the documented support
  for both platforms had been promising without any test behind it. Nest runs
  middleware on Fastify through `@fastify/middie`, whose `runMiddie` calls
  `run(req.raw, reply.raw, next)` and copies only `id`, `hostname`, `protocol`,
  `ip`, `ips`, `log`, `query` and `body` onto that raw request — never
  `routeOptions`. The recorder therefore saw no route metadata at all and would
  have labelled every Fastify request `<unmatched>`, destroying the per-route
  breakdown and making a scan indistinguishable from ordinary traffic. Worse,
  `forRoutes('/')` is a mount on Express but an **exact match** on Fastify, so
  most requests produced no sample whatsoever. The module now selects the mount
  per adapter and registers an `onRequest` hook on Fastify that carries the
  resolved template to the recorder. Covered by a new Fastify end-to-end suite.
- **Unmatched requests record a bounded label.** A request that matched no route
  is recorded as `<unmatched>` (exported as `UNMATCHED_ROUTE`), never the
  requested path. The previous raw-URL fallback would have let anyone mint one
  Prometheus time series per probe, so counting scanner traffic under it would
  have turned this fix into a memory-exhaustion vector.

### Changed

- **`ITimingSink` implementations now receive more samples**, including requests
  that never reached a handler. Sinks that assumed "one sample per completed
  request" should expect "one sample per closed request". The built-in metrics
  bridge needs no change; a dashboard filtering on `2xx` sees its numbers
  unchanged and its error rates become correct.
- **No status is relabelled**, and that is deliberate. A client that hangs up
  mid-handler was already counted — destroying the socket does not cancel the
  JavaScript already running, so the handler finished and the interceptor
  recorded an ordinary `200` — and it still is, once, under the same `200`.
  Introducing a sentinel status for aborts would rewrite the value of
  `status_code="200"` series that already exist in every deployment, moving
  error-rate panels with no change in traffic. Whether an abort deserves its own
  status is a separate decision from whether the request is counted at all, and
  this release makes only the second one.
- **The timing recorder is registered once, not twice.** The middleware
  **replaced** the interceptor rather than joining it — two recorders would
  double every rate an alert threshold is tuned against, which is a quieter
  failure than the one being fixed.

### Deprecated

- **`TimingInterceptor`** is superseded by `BymaxTimingMiddleware` and is no
  longer registered by `BymaxCoreModule`. It stays exported so an application
  that wired it by hand keeps compiling; registering it alongside the middleware
  records a second sample for every request that reaches a handler.

### Added

- **`BymaxTimingMiddleware` and `UNMATCHED_ROUTE`** are exported from the package
  root.
- **A library can describe its own routes in a consumer's document.** A provider
  marked `@BymaxOpenApiContributor()` returns OpenAPI fragments keyed by handler
  identity — `'AuthController.login'` — and they are merged onto the operations
  those handlers produced. It exists because the two obvious alternatives do
  not work: decorating a library's controllers with `@nestjs/swagger` would load
  that peer in every application importing the library, and a consumer-side map
  keyed by path cannot be written by a library mounted through
  `RouterModule.register`, which does not know its own final paths.
- **`openapi.operationIdFactory`**, plus the exported `OpenApiOperationIdFactory`
  type. This package now always installs a factory so it can learn which handler
  produced which operation, and **delegates the id string** — to this option when
  set, to the format `@nestjs/swagger` itself produces otherwise. Choosing the id
  instead would have renamed every operation in every published document and
  broken any client generated from one; a test compares both documents to keep
  that true if the peer's format ever changes.
- **The contract types** `IOpenApiContributor`, `OpenApiFragment`,
  `OpenApiFragmentObject` and `OpenApiHandlerKey`, exported from `./openapi` so a
  sibling library can target them at its own compile time.
- **`BYMAX_OPENAPI_CONTRACT_VERSION`**, and a required `contractVersion` on every
  fragment. A fragment crosses a boundary between independently released
  packages, and on that boundary compile-time types protect nothing: each side
  type-checks against its own installed copy, so only the value travelling at
  runtime can say which shape it is. A revision this package does not speak fails
  the build naming both. Required rather than inferred from absence, following
  the pattern Kubernetes objects use for `apiVersion` — an optional discriminator
  is unambiguous only while exactly one revision exists, which is precisely when
  nobody checks it.

### Fixed

- **`DiscoveryModule` is imported when only the document is enabled.** It was
  imported on the synchronous registration path only when readiness discovery or
  metrics could scan, so an application enabling nothing but OpenAPI had no
  scanner — and a library's description of its own routes would have been
  silently dropped.

### Notes

- Deriving fragments from validation decorators is deliberately **not** in this
  package: it takes no dependency on any validation library. A library that
  wants its schemas to track its own decorators generates them in its own build,
  where that dependency already exists, and commits the result with a test
  asserting generated matches committed — so drift fails in the repository that
  caused it. An application's own DTOs need none of this; `@nestjs/swagger`'s CLI
  plugin already derives them, which is the route a precompiled library lacks.

## [1.3.2] - 2026-08-12

A consumer audit of the served document found that it described the library's
promises rather than the deployment: routes of features that were switched off
were still listed, the contributed schemas were never referenced by any
operation, and nothing said which operations needed authentication. Everything
below is additive — no option changes meaning, no existing document loses an
entry it had.

**Apply to a derived backend:** bump the dependency. The document improves with
no code change; the two new options are opt-in.

### Added

- **`openapi.security` and `openapi.operationSecurity`.** A document-level
  default requirement, plus per-operation overrides keyed `"<METHOD> <path>"`.
  An empty array marks an operation public, which is the specification's own way
  of overriding the default — and it matters for generated clients, since an
  operation with _absent_ security inherits the document default and a client
  would attach credentials to a public registration endpoint.
- **The operation key is a documented contract**, with `OpenApiOperationKey` and
  `OperationSecurityMap` exported as types so a sibling library can ship a
  plain-data map of its own operations and have it checked at its own compile
  time, with no runtime coupling. The path is written exactly as documented,
  **including any global prefix** — `@nestjs/swagger` puts `setGlobalPrefix` into
  the documented paths, so a library shipping such a map should expose a function
  taking the prefix rather than a frozen constant.
- **A key addressing no operation fails the document build**, listing both the
  keys that missed and the operations that exist. A stale key would otherwise
  leave a route silently documented as authenticated when it is not, or the
  reverse. Failing is safe here: the document is only ever built outside
  production.
- **A requirement naming an undeclared security scheme fails the same way.** A
  requirement is a reference, and a reference to nothing produces a document
  whose security cannot be resolved — a client generator looks the name up in
  `components.securitySchemes`, finds nothing, and either fails or emits an
  unauthenticated client. Configuring the requirement and forgetting the scheme
  is one edit apart. A scheme the document itself declares counts as declared,
  and marking an operation public names no scheme, so it needs none.

### Fixed

- **A disabled feature's routes are no longer documented.** With
  `metrics: { enabled: false }` the runtime answers `GET /metrics` with a 404
  envelope — on `forRootAsync` the controller is mounted unconditionally and
  guards each request, because route metadata is fixed before the async options
  resolve — while the document still advertised it. The filter reads the same
  resolved snapshot the guard reads, so the two cannot drift. `@nestjs/swagger`
  documents paths as the application serves them — the global prefix, and under
  `enableVersioning({ type: URI })` the version segment that follows it, so
  `/api/v1/metrics` — and both are **read from the application** rather than
  inferred from the document. Versioning matters as much as the prefix: without
  it, every versioned application kept advertising the routes of a feature it
  had switched off, and its health probes lost the payload schema and the public
  marking this package contributes. Inference is the trap: an application whose routes all sit under one
  controller prefix would have that treated as the global one, and a consumer
  route ending in `/health/live` deleted as though this package owned it. What
  leaves is also the **operation**, not the path item — a method the consumer
  mounted on the same path survives, and the path disappears only once nothing
  is left under it.
- **The automatic security policy is stated for `GET` alone.** These controllers
  expose no other method, so a consumer's `POST` on the same path is theirs and
  no longer inherits a requirement written for ours.
- **The envelope response follows the envelope feature.** With
  `envelope.enabled` off, errors are shaped by Nest or by the consumer's own
  handler, so documenting this package's envelope described a body the
  deployment never sends. The health response is a separate feature and is
  unaffected.
- **A response written as a bare `$ref` is a declaration.** It carries no
  `content`, so the placeholder rule would have overwritten it — discarding the
  reference and leaving `$ref` beside sibling keys, which is not a valid
  response object.
- **`BymaxMetricsAuth` is reserved while a scrape token is configured.** The
  name was silently overwritten or silently lost depending on where the other
  definition came from, and the losing case left the scrape operation pointing
  at a scheme that is not the bearer token the runtime checks. It now fails the
  document build with the collision named.
- **The contributed schemas are referenced by the operations that return them.**
  They shipped orphaned: `components.schemas` carried the envelope, the health
  response and the pagination shapes while no operation pointed at any of them,
  so a generated client had no error type at all. Every operation now carries a
  `default` response referencing `BymaxErrorEnvelope`, and the health endpoints
  an explicit `200` referencing `BymaxHealthResponse`. Gated by
  `includeCoreSchemas`, because referencing a schema that was not contributed
  would leave a dangling `$ref`.
- **A response is judged by whether it declares a shape.** `@nestjs/swagger`
  emits a placeholder `200` with a description and no content for every handler,
  so a plain "existing always wins" rule would never have written a contributed
  schema. A response carrying `content` is a real declaration and is untouched;
  one without it is filled in, keeping any description already written.
- **The library documents the security of its own three routes.** The health
  probes are marked public — an orchestrator polls them holding no credential —
  and the scrape endpoint carries a bearer requirement, with its scheme, exactly
  when `metrics.authToken` is set. The library owns both the routes and the
  option, so no consumer should have to restate either.

### Documentation

- The metrics naming rules are framed as an adoption guideline for sibling
  libraries, with the reason the rules live here: a Prometheus registry is a flat
  namespace, so two libraries picking the same metric name collide at the
  _consumer's_ boot, in an application neither library's CI ever assembles. A
  contributing library is asked to publish its own metric list; this package
  deliberately keeps no central catalogue.
- `applyBymaxOpenApi` documents that testing its enabled path under Jest needs
  `NODE_OPTIONS=--experimental-vm-modules`, because the optional peer is reached
  through a dynamic `import()`. Only the enabled case fails without it, which is
  what makes the omission confusing.

## [1.3.1] - 2026-08-11

A patch fixing a defect that existed only in the published artifact: `applyBymaxOpenApi` threw on
every consumer boot, including consumers that never enabled the OpenAPI document. No API changed —
the type declarations are byte-identical to `1.3.0` apart from one added documentation comment.

**Apply to a derived backend:** `pnpm up @bymax-one/nest-core`. No code change on the consumer
side; the DI token identities are internal to the package.

### Fixed

- **`applyBymaxOpenApi` resolves the options registered by `BymaxCoreModule` again.** The DI
  tokens were minted with `Symbol()`. This package ships one bundle per published subpath with the
  shared internals inlined into each, so `core.tokens` existed twice at runtime — once in
  `dist/index.cjs`, once in `dist/openapi/index.cjs` — and `Symbol('X') !== Symbol('X')`. The
  provider bound by the package root carried one identity and the `./openapi` helper looked up
  another, so `app.get()` found nothing and the helper threw its "could not resolve
  BYMAX_CORE_OPTIONS" error with `BymaxCoreModule` correctly registered. Under Nest's default
  `abortOnError` that took down the process. The feature flag did not protect anyone: the helper
  resolves the options before it reads `openapi.enabled`, so an application with the document
  switched off failed exactly the same way. Every token is now minted with `Symbol.for` against the
  runtime's global symbol registry, which is immune to bundle duplication by construction.
  `./health`, `./metrics` and `./pagination` were audited and carry no DI token at all, so
  `./openapi` was the only subpath where the defect could manifest; the remaining tokens are
  converted anyway, so a future subpath that starts consuming one is safe before the fact.

### Internal

- **The consumer load gate now boots a real application against the packed tarball.** It registers
  `BymaxCoreModule.forRootAsync` from the package root, calls `applyBymaxOpenApi` from the
  `./openapi` subpath, and asserts all three outcomes — disabled, mounted outside production, and
  refused in production — in ESM and in CommonJS. The unit suite structurally could not catch this
  class of defect: under ts-jest every module is loaded once, so tokens shared between two entries
  are the same object however they were minted, and the bug only exists once the code is bundled.
  The gate fails against the `1.3.0` artifact and passes against this one.
- The token specs assert that every exported token round-trips through `Symbol.for`, swept from the
  module namespace rather than a hand-maintained list, so a token added later is covered without
  anyone remembering to add it.

## [1.3.0] - 2026-08-11

Coordinated ecosystem release aligning every `@bymax-one/*` package after the ioredis 6 /
bullmq 6 migration. **No source, runtime, or public-API change in this package** — the
published `dist/` is byte-identical to `1.2.2`; the changes below are development
and CI tooling only.

### Changed

- Bumped the `dev-dependencies` group with 3 updates. None of these reaches the published bundle.
- Bumped the pinned `pnpm/action-setup` CI action from 6.0.9 to 6.0.10.
- Bumped the pinned `github/codeql-action/upload-sarif` CI action from 4.37.4 to 4.37.6 in the
  codeql group.

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
[1.3.2]: https://github.com/bymaxone/nest-core/compare/v1.3.1...v1.3.2
[1.3.1]: https://github.com/bymaxone/nest-core/compare/v1.3.0...v1.3.1
[1.3.0]: https://github.com/bymaxone/nest-core/compare/v1.2.2...v1.3.0
[1.2.2]: https://github.com/bymaxone/nest-core/compare/v1.2.1...v1.2.2
[1.2.1]: https://github.com/bymaxone/nest-core/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/bymaxone/nest-core/compare/v1.1.1...v1.2.0
[1.4.0]: https://github.com/bymaxone/nest-core/compare/v1.3.2...v1.4.0
[1.5.0]: https://github.com/bymaxone/nest-core/compare/v1.4.0...v1.5.0
[1.5.1]: https://github.com/bymaxone/nest-core/compare/v1.5.0...v1.5.1
[1.5.2]: https://github.com/bymaxone/nest-core/compare/v1.5.1...v1.5.2
[1.5.3]: https://github.com/bymaxone/nest-core/compare/v1.5.2...v1.5.3
[1.6.0]: https://github.com/bymaxone/nest-core/compare/v1.5.3...v1.6.0
[Unreleased]: https://github.com/bymaxone/nest-core/compare/v1.6.0...HEAD
