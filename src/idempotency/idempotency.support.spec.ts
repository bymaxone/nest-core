/**
 * Unit tests for the boot refusal of handlers whose answer cannot be stored whole.
 *
 * Layer: unit.
 * Goal: only Nest's built-in parameter keys are read as a parameter type, `@Res` passes only with
 * `passthrough: true`, and `passthrough` excuses `@Res` and nothing else.
 * Mocks: none; the route metadata is written directly under Nest's own keys.
 */
import 'reflect-metadata'

import { assertSupportedHandler } from './idempotency.support'

/** A controller whose `handler` carries `args` as route arguments, and `passthrough` as Nest sets it. */
function controller(
  args: Record<string, unknown>,
  passthrough: boolean
): { prototype: { handler(): void } } {
  class Target {
    handler(): void {}
  }
  Reflect.defineMetadata('__routeArguments__', args, Target, 'handler')
  Reflect.defineMetadata('__responsePassthrough__', passthrough, Target, 'handler')
  return Target
}

const check = (args: Record<string, unknown>, passthrough = false): void => {
  const target = controller(args, passthrough)
  assertSupportedHandler(target, 'handler', target.prototype.handler)
}

describe('assertSupportedHandler, the parameter keys', () => {
  it('refuses a built-in key whose type is refused', () => {
    expect(() => check({ '2:0': {} })).toThrow(/@Next\(\)/)
  })

  it.each(['2x1:0', '2:0x', '2:0 '])(
    'reads %j as a custom decorator, not as the type it starts with',
    (key) => {
      expect(() => check({ [key]: {} })).not.toThrow()
    }
  )
})

describe('assertSupportedHandler, passthrough', () => {
  it('refuses @Res unless passthrough is set, and accepts it when it is', () => {
    expect(() => check({ '1:0': {} })).toThrow(/@Res\(\) without `passthrough: true`/)
    expect(() => check({ '1:0': {} }, true)).not.toThrow()
  })

  it('excuses @Res only: @Next beside a passthrough @Res is still refused', () => {
    expect(() => check({ '1:0': {}, '2:1': {} }, true)).toThrow(/@Next\(\)/)
  })
})
