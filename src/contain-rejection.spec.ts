/**
 * Unit tests for the containment of what a `void`-declared sink returns.
 *
 * Layer: unit.
 * Goal: a value with no callable `then` is left alone, so the ordinary synchronous sink allocates no
 * promise.
 * Mocks: none; promises are counted with `node:async_hooks`.
 */
import { createHook } from 'node:async_hooks'

import { containRejection } from './contain-rejection'

/** How many promises `run` creates before it returns. */
function promisesCreatedBy(run: () => void): number {
  let created = 0
  const hook = createHook({
    init: (_id, type) => {
      if (type === 'PROMISE') created += 1
    }
  }).enable()
  try {
    run()
  } finally {
    hook.disable()
  }
  return created
}

describe('containRejection', () => {
  it.each([
    ['a number, as a concise arrow sink returns', 1],
    ['nothing', undefined],
    ['null', null],
    ['an object whose then is not a function', { then: 1 }]
  ])('creates no promise for %s', (_name, returned) => {
    const onFailure = jest.fn()

    expect(promisesCreatedBy(() => containRejection(returned, onFailure))).toBe(0)
    expect(onFailure).not.toHaveBeenCalled()
  })

  it('creates a promise for a thenable, so the count sees what it is meant to see', () => {
    const thenable = { then: (): void => undefined }

    expect(promisesCreatedBy(() => containRejection(thenable, jest.fn()))).toBeGreaterThan(0)
  })
})
