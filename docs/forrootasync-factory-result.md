# `forRootAsync`: Nest reads the factory's result outside the library's guard

## Status

Documented, not fixed. Decision: leave as is.

## What happens

`BymaxCoreModule.forRoot` reads the options once under the guard and hands Nest's module builder
that copy. `forRootAsync` cannot: Nest receives the factory, runs it and reads what it returned
before `normalizeCoreOptions` runs.

In `@nestjs/core` `injector/injector.js`:

- `instanceHost.instance = await factoryReturnValue` reads `then` on the value the factory
  returned.
- `host.instance = await host.instance` reads it again when the host is resolved.
- The lifecycle-hook predicates read the instance's hook names later, at bootstrap and at close.

`@nestjs/common` `module-utils/configurable-module.builder.js` passes `options.useFactory` straight to
the provider for the builder's options token, and wraps `useClass` and
`useExisting` in an internal `async (factory) => await factory.create()` that the library cannot
reach.

So a factory that returns a hostile `Proxy` (a trap that throws on `then`, `ownKeys`, `get` or the
hook names) fails the boot with the host's own error, unlabelled.

## Why it is left

- Fail closed: the boot fails with the host's error. Nothing is dropped silently, no option falls
  back to a default and no authentication decision depends on it.
- It needs the factory's own result to be a hostile `Proxy`.
- Nest's own reads are not the library's code.

## Option that was weighed

Wrap `useFactory` and identify the factory's own errors structurally:

1. A synchronous throw from the factory is rethrown unchanged.
2. When `util.types.isPromise(result)` holds (a brand check, no trap runs), `await` it; a rejection is
   the factory's and surfaces unchanged; the resolved value is safe to read with `readOptions`.
3. Otherwise read `result?.then` under the guard: a throw is ours and becomes
   `the options could not be read` with the host error as `cause`; a function is a foreign thenable
   and is awaited as the factory's own; anything else is read with `readOptions`.

Nest then holds a plain copy, which also keeps its hook predicates inert.

Rejected because:

- An async factory that does `return hostileProxy` with a throwing `then` trap rejects inside the
  host's own async function, which is indistinguishable from the factory's own throw, so a residual
  stays raw.
- `useClass` and `useExisting` stay uncovered unless the builder's internal factory is replaced.
- It costs root brotli bytes, and the root budget has little headroom.
- A marker on the factory's own errors does not work: a thrown primitive cannot carry one, and an
  async factory's own error and a `then`-trap error share one rejection channel.

If it is reopened, verify with an Nth-trap sweep through real Nest
(`Test.createTestingModule` with a trapped options factory) and settle the size
budget first.
