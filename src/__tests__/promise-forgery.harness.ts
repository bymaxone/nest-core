/**
 * @fileoverview Replaces the `Promise` statics and `Promise.prototype` members the way a host could after
 * this package loaded, and puts them back.
 * @layer tests
 */
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

/** The statics a verdict must never read. */
export const STATICS = ['race', 'all', 'allSettled', 'any', 'resolve', 'reject'] as const

const realResolve = Promise.resolve.bind(Promise)
const originals = new Map<string, { owner: object; key: string; descriptor?: PropertyDescriptor }>()

/** Remember what `owner[name]` was, once. */
function remember(owner: object, name: string, tag: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(owner, name)
  if (!originals.has(tag) && descriptor !== undefined)
    originals.set(tag, { owner, key: name, descriptor })
}

/**
 * Replace one static with a function that answers `forged`, as a fulfilled promise, without reading
 * any static.
 *
 * @param name - The static.
 * @param forged - What every call answers.
 */
export function forgeStatic(name: (typeof STATICS)[number], forged: unknown): void {
  remember(Promise, name, `static:${name}`)
  Object.defineProperty(Promise, name, {
    value: () => realResolve(forged),
    configurable: true,
    writable: true
  })
}

/** Replace `Promise.prototype.then` with a wrapper that delegates to the original, as an APM does. */
export function delegateThen(): void {
  remember(Promise.prototype, 'then', 'then')
  const original = Promise.prototype.then
  Object.defineProperty(Promise.prototype, 'then', {
    value: function then(this: Promise<unknown>, ...args: Parameters<typeof original>) {
      return original.apply(this, args)
    },
    configurable: true,
    writable: true
  })
}

/** Replace `Promise.prototype.constructor` with a function that is not `Promise`. */
export function replaceConstructor(): void {
  remember(Promise.prototype, 'constructor', 'constructor')
  Object.defineProperty(Promise.prototype, 'constructor', {
    value: function Forged() {},
    configurable: true,
    writable: true
  })
}

/** Put back everything replaced since the last call. */
export function restorePromise(): void {
  for (const { owner, key, descriptor } of originals.values()) {
    if (descriptor !== undefined) Object.defineProperty(owner, key, descriptor)
  }
  originals.clear()
}

/**
 * Load modules while `globalThis.Promise` is a subclass whose `then` answers `forged`, as a host that
 * set `Promise = Bluebird` before this package loaded, then put the global back.
 *
 * @param forged - What the subclass's `then` hands to every fulfilment callback.
 * @param load - Requires the modules under test.
 * @returns What `load` returned.
 */
export function loadUnderForeignPromise<T>(forged: unknown, load: () => T): T {
  const NativePromise = globalThis.Promise
  class Foreign<V> extends NativePromise<V> {
    override then(onFulfilled?: ((value: V) => unknown) | null): never {
      onFulfilled?.(forged as V)
      return undefined as never
    }
  }
  globalThis.Promise = Foreign as unknown as PromiseConstructor
  try {
    return load()
  } finally {
    globalThis.Promise = NativePromise
  }
}

/**
 * Run `body` in a fresh Node process that can `require` this package's TypeScript, and return its last
 * line of output: jest observes no unhandled rejection of its own, so those rows count them in a child.
 *
 * @param body - A script; `require` resolves from the repository root.
 * @returns The last line the script printed.
 */
export function lastLineFromChild(body: string): string {
  const script = `
    const ts = require('typescript')
    require.extensions['.ts'] = (module, file) => {
      const { outputText } = ts.transpileModule(require('node:fs').readFileSync(file, 'utf8'), {
        compilerOptions: { module: 1, target: 9, experimentalDecorators: true, emitDecoratorMetadata: true }
      })
      module._compile(outputText, file)
    }
    ${body}
  `
  const output = execFileSync(process.execPath, ['-e', script], {
    cwd: resolve(__dirname, '../..'),
    encoding: 'utf8'
  })
  return output.trim().split('\n').pop() as string
}
