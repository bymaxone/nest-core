/**
 * Unit tests for the production guard on the metrics endpoint.
 *
 * Layer: unit.
 * Goal: enabling metrics in production without a scrape token is refused at boot, unless the
 * deployment states that the route is protected at the edge; every other combination is accepted.
 * Mocks: none (pure function); the runtime environment is set per case and restored.
 */
import { Test } from '@nestjs/testing'

import { BymaxCoreModule } from './core.module'
import { normalizeCoreOptions } from './core.options'
import type { MetricsOptions } from './core.options'

/** Runs `body` with `NODE_ENV` set to `value` (or unset), restoring it afterwards. */
function withNodeEnv<T>(value: string | undefined, body: () => T): T {
  const before = process.env['NODE_ENV']
  if (value === undefined) {
    delete process.env['NODE_ENV']
  } else {
    process.env['NODE_ENV'] = value
  }
  try {
    return body()
  } finally {
    if (before === undefined) {
      delete process.env['NODE_ENV']
    } else {
      process.env['NODE_ENV'] = before
    }
  }
}

/** Normalizes a metrics block under `NODE_ENV`, with an optional declared environment. */
const resolve = (nodeEnv: string | undefined, metrics: MetricsOptions, environment?: string) =>
  withNodeEnv(nodeEnv, () =>
    normalizeCoreOptions({ metrics, ...(environment === undefined ? {} : { environment }) })
  )

describe('metrics production guard', () => {
  /**
   * Metrics on, in production, with nothing protecting the route is refused.
   *
   * The error names the two ways out so the fix is in the message.
   */
  it('refuses metrics in production with no token and no edge declaration', () => {
    expect(() => resolve('production', { enabled: true })).toThrow(
      /metrics\.authToken.*metrics\.edgeProtected/s
    )
  })

  it.each([
    ['a token', { enabled: true, authToken: 'secret' }],
    ['an edge declaration', { enabled: true, edgeProtected: true }],
    [
      'both a token and an edge declaration',
      { enabled: true, authToken: 's', edgeProtected: true }
    ],
    ['metrics disabled', { enabled: false }],
    ['metrics left at the default', {}]
  ])('accepts metrics in production with %s', (_name, metrics) => {
    expect(() => resolve('production', metrics)).not.toThrow()
  })

  it('an edge declaration that is false is not a declaration', () => {
    expect(() => resolve('production', { enabled: true, edgeProtected: false })).toThrow(
      /metrics\.edgeProtected/
    )
  })

  it.each(['development', 'test'])('accepts an open endpoint when NODE_ENV is %s', (env) => {
    expect(() => resolve(env, { enabled: true })).not.toThrow()
  })

  /**
   * An unset `NODE_ENV` is production by the package's fail-closed rule, unless the application
   * declares its own environment.
   */
  it('treats an unset NODE_ENV as production, unless the application declares development', () => {
    expect(() => resolve(undefined, { enabled: true })).toThrow(/metrics\.edgeProtected/)
    expect(() => resolve(undefined, { enabled: true }, 'development')).not.toThrow()
  })

  it('does not let a declared development override a production NODE_ENV', () => {
    expect(() => resolve('production', { enabled: true }, 'development')).toThrow(
      /metrics\.edgeProtected/
    )
  })

  it('keeps an empty token a boot error, ahead of the production guard', () => {
    expect(() => resolve('production', { enabled: true, authToken: ' ' })).toThrow(/authToken/)
  })
})

describe('metrics production guard, at the module entry points', () => {
  it('refuses at forRoot, before the module is built', () => {
    expect(() =>
      withNodeEnv('production', () => BymaxCoreModule.forRoot({ metrics: { enabled: true } }))
    ).toThrow(/metrics\.edgeProtected/)
  })

  it('refuses at forRootAsync, when the factory result is resolved', async () => {
    const compile = async (metrics: MetricsOptions): Promise<unknown> => {
      const before = process.env['NODE_ENV']
      process.env['NODE_ENV'] = 'production'
      try {
        return await Test.createTestingModule({
          imports: [BymaxCoreModule.forRootAsync({ useFactory: () => ({ metrics }) })]
        }).compile()
      } finally {
        if (before === undefined) {
          delete process.env['NODE_ENV']
        } else {
          process.env['NODE_ENV'] = before
        }
      }
    }
    await expect(compile({ enabled: true })).rejects.toThrow(/metrics\.edgeProtected/)
    await expect(compile({ enabled: true, edgeProtected: true })).resolves.toBeDefined()
  })
})
