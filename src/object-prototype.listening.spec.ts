/**
 * Tests for how a promise is pinned, listened to and watched, in this process.
 *
 * Layer: unit.
 * Goal: a slot changed only in its setter, a replaced species accessor, a foreign own `constructor` and an
 * own `then` are each seen; a native promise is awaited without reading `Promise[Symbol.species]`; one that
 * cannot be listened to is never reported settled; a rejection reaches the failure listener; and only the
 * guard's own error is taken for its refusal.
 * Mocks: none; the real built-ins, put back after each row.
 */
import { hear, afterSettled, isGuardRefusal, pinned, promiseAltered } from './object-prototype'

const species = Object.getOwnPropertyDescriptor(Promise, Symbol.species) as PropertyDescriptor

/** Put `Promise[Symbol.species]` back as it was at load. */
function restoreSpecies(): void {
  Object.defineProperty(Promise, Symbol.species, species)
}

/** A pending native promise, with what settles it. */
function pending(): { promise: Promise<void>; settle: () => void } {
  let settle = (): void => undefined
  const promise = new Promise<void>((resolve) => {
    settle = resolve
  })
  return { promise, settle }
}

/** Whether `promise` settled within `ms`. */
async function settledWithin(promise: Promise<void>, ms: number): Promise<boolean> {
  return await Promise.race([
    promise.then(() => true),
    new Promise<boolean>((done) => setTimeout(() => done(false), ms))
  ])
}

describe('what the promise watch sees', () => {
  afterEach(() => {
    delete (Object.prototype as Record<string, unknown>)['then']
    restoreSpecies()
  })

  it('sees a then that differs only in its setter', () => {
    Object.defineProperty(Object.prototype, 'then', { set(): void {}, configurable: true })

    expect(promiseAltered()).toBe(true)
  })

  it('sees Promise[Symbol.species] replaced by another accessor', () => {
    Object.defineProperty(Promise, Symbol.species, { get: () => Promise, configurable: true })

    expect(promiseAltered()).toBe(true)
  })

  it('is quiet while nothing was replaced', () => {
    expect(promiseAltered()).toBe(false)
  })
})

describe('pinning a promise', () => {
  const foreign = function Foreign() {}

  it('refuses a native promise whose own constructor is another, without an own then', () => {
    const promise = Promise.resolve()
    Object.defineProperty(promise, 'constructor', { value: foreign, configurable: false })

    expect(pinned(promise)).toBe(false)
  })

  it('refuses a native promise that carries its own then', () => {
    const promise = Promise.resolve()
    Object.defineProperty(promise, 'then', { value: () => undefined, configurable: true })

    expect(pinned(promise)).toBe(false)
  })

  it('accepts a plain native promise', () => {
    expect(pinned(Promise.resolve())).toBe(true)
  })
})

describe('listening to a native promise', () => {
  afterEach(() => {
    restoreSpecies()
  })

  it('reports it settled without reading Promise[Symbol.species]', async () => {
    const { promise, settle } = pending()
    Object.defineProperty(Promise, Symbol.species, {
      get: () => {
        throw new Error('species read')
      },
      configurable: true
    })
    const settled = afterSettled(promise)
    restoreSpecies()
    settle()

    expect(await settledWithin(settled, 200)).toBe(true)
  })

  it('never reports settled a native promise that no listener can be attached to', async () => {
    const { promise, settle } = pending()
    const Foreign = function Foreign() {}
    Object.defineProperty(Foreign, Symbol.species, {
      get: () => {
        throw new Error('species read')
      }
    })
    Object.defineProperty(promise, 'constructor', { value: Foreign, configurable: false })
    const settled = afterSettled(promise)
    settle()

    expect(await settledWithin(settled, 100)).toBe(false)
  })

  it('hands a rejection to the failure listener', async () => {
    const reason = new Error('rejected')
    const seen: unknown[] = []
    hear(Promise.reject(reason), (found) => {
      seen[seen.length] = found
    })
    await new Promise((done) => setTimeout(done, 20))

    expect(seen).toEqual([reason])
  })
})

describe('what is taken for the guard refusal', () => {
  it.each([
    ['a plain object with a count', { count: 1 }],
    ['another kind of error with a count', Object.assign(new TypeError('x'), { count: 1 })]
  ])('does not take %s for it', (_name, error) => {
    expect(isGuardRefusal(error)).toBe(false)
  })
})

describe('importing beside a Promise whose species is not an accessor', () => {
  afterEach(() => {
    restoreSpecies()
  })

  it('refuses the import, naming the species', () => {
    Object.defineProperty(Promise, Symbol.species, { value: Promise, configurable: true })

    expect(() => {
      jest.isolateModules(() => {
        require('./object-prototype')
      })
    }).toThrow('Promise[Symbol.species] is not an intrinsic accessor')
  })
})
