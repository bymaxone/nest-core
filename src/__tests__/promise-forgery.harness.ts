/**
 * @fileoverview Replaces the `Promise` statics and `Promise.prototype` members the way a host could after
 * this package loaded, and puts them back.
 * @layer tests
 */

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
