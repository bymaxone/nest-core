/**
 * Unit tests for the helmet options read by name.
 *
 * Layer: unit.
 * Goal: for every option of `helmet` that takes settings, a block the host serves only through `get`
 * reaches `helmet` with its settings, so the header answers what the host asked and not its default.
 * Mocks: a fake Express application that keeps the middleware it is given; the real `helmet`.
 */
import type { INestApplication } from '@nestjs/common'

import { applyHttpFloors } from './http-floors'

/** One option, the settings the host gives it, and the header that must answer them. */
const CASES: ReadonlyArray<readonly [string, object, string, string]> = [
  [
    'contentSecurityPolicy',
    { useDefaults: false, directives: { defaultSrc: ["'none'"] } },
    'content-security-policy',
    "default-src 'none'"
  ],
  [
    'crossOriginEmbedderPolicy',
    { policy: 'credentialless' },
    'cross-origin-embedder-policy',
    'credentialless'
  ],
  [
    'crossOriginOpenerPolicy',
    { policy: 'same-origin-allow-popups' },
    'cross-origin-opener-policy',
    'same-origin-allow-popups'
  ],
  [
    'crossOriginResourcePolicy',
    { policy: 'cross-origin' },
    'cross-origin-resource-policy',
    'cross-origin'
  ],
  ['referrerPolicy', { policy: 'same-origin' }, 'referrer-policy', 'same-origin'],
  [
    'strictTransportSecurity',
    { maxAge: 100, preload: true },
    'strict-transport-security',
    'max-age=100; includeSubDomains; preload'
  ],
  [
    'hsts',
    { maxAge: 100, preload: true },
    'strict-transport-security',
    'max-age=100; includeSubDomains; preload'
  ],
  ['xDnsPrefetchControl', { allow: true }, 'x-dns-prefetch-control', 'on'],
  ['dnsPrefetchControl', { allow: true }, 'x-dns-prefetch-control', 'on'],
  ['xFrameOptions', { action: 'deny' }, 'x-frame-options', 'DENY'],
  ['frameguard', { action: 'deny' }, 'x-frame-options', 'DENY'],
  [
    'xPermittedCrossDomainPolicies',
    { permittedPolicies: 'all' },
    'x-permitted-cross-domain-policies',
    'all'
  ],
  [
    'permittedCrossDomainPolicies',
    { permittedPolicies: 'all' },
    'x-permitted-cross-domain-policies',
    'all'
  ]
]

/** `value` served only through `get`, over an empty target. */
function getOnly<T extends object>(value: T): T {
  return new Proxy({} as T, { get: (_target, key) => Reflect.get(value, key) })
}

/** The headers the helmet middleware set on one request. */
async function headersOf(helmet: object): Promise<Record<string, string>> {
  let middleware: ((req: object, res: object, next: () => void) => void) | undefined
  const app = {
    getHttpAdapter: () => ({ getType: () => 'express' }),
    getHttpServer: () => ({ listening: false }),
    use: (handler: typeof middleware) => {
      middleware = middleware ?? handler
    },
    enableCors: () => undefined,
    useBodyParser: () => undefined
  } as unknown as INestApplication
  await applyHttpFloors(app, { helmet: helmet as never })
  const headers: Record<string, string> = {}
  const res = {
    setHeader: (name: string, value: string) => {
      headers[name.toLowerCase()] = String(value)
    },
    removeHeader: () => undefined,
    getHeader: () => undefined
  }
  middleware?.({}, res, () => undefined)
  return headers
}

describe('the helmet options read by name', () => {
  it.each(CASES)(
    'serves the settings of %s held behind a proxy that answers only get',
    async (name, settings, header, value) => {
      const headers = await headersOf(getOnly({ [name]: getOnly(settings) }))
      expect(headers[header]).toBe(value)
    }
  )

  it('refuses the directives of the policy held behind a proxy that answers only get', async () => {
    const policy = { useDefaults: false, directives: getOnly({ defaultSrc: ["'none'"] }) }

    await expect(headersOf({ contentSecurityPolicy: policy })).rejects.toThrow(
      'the options could not be read'
    )
  })

  it('keeps the directives a class holds as accessors, so default-src stays none', async () => {
    class Directives {
      get defaultSrc(): string[] {
        return ["'none'"]
      }
    }
    const headers = await headersOf({
      contentSecurityPolicy: { useDefaults: true, directives: new Directives() }
    })
    expect(headers['content-security-policy']).toMatch(/^default-src 'none'/)
  })

  it('refuses a directive that is a function, naming it, instead of dropping it', async () => {
    const policy = { useDefaults: false, directives: { defaultSrc: () => ["'none'"] } }
    let thrown: Error | undefined
    try {
      await headersOf({ contentSecurityPolicy: policy })
    } catch (error) {
      thrown = error as Error
    }

    expect(thrown?.message).toBe('the options could not be read')
    expect(thrown?.cause).toMatchObject({ option: 'defaultSrc' })
  })

  it('keeps a method a class holds on its prototype out of the directives', async () => {
    class Directives {
      get defaultSrc(): string[] {
        return ["'none'"]
      }

      describe(): string {
        return 'directives'
      }
    }
    const headers = await headersOf({
      contentSecurityPolicy: { useDefaults: false, directives: new Directives() }
    })
    expect(headers['content-security-policy']).toBe("default-src 'none'")
  })
})
