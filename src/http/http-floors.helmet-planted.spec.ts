/**
 * Unit tests for the options `helmet` is handed, with a name planted on `Object.prototype`.
 *
 * Layer: unit.
 * Goal: `helmet` reads names it was not given, from the object it is handed or from one of its own, so
 * the headers an application serves must be the ones of an unplanted run whatever is planted; and the
 * names the installed `helmet` reads are all names this package knows.
 * Mocks: the guard that refuses a planted `Object.prototype` at boot, so the reads under it are still exercised; a fake Express application that keeps the middleware it is given; the real `helmet`.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

import type { INestApplication } from '@nestjs/common'

import { applyHttpFloors, HELMET_OPTION_NAMES } from './http-floors'

jest.mock('../object-prototype', () => ({ assertObjectPrototypeClean: (): void => undefined }))

/** Whether a name is planted so that `for...in` sees it: every row runs both ways. */
let ENUMERABLE = false

/** The names of the settings the options of `helmet` take. */
const SETTING_NAMES = [
  'reportOnly',
  'useDefaults',
  'directives',
  'policy',
  'maxAge',
  'includeSubDomains',
  'preload',
  'allow',
  'action',
  'permittedPolicies'
]

/** The headers the helmet middleware set on one request, as text. */
async function headersOf(helmet: object | undefined): Promise<string> {
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
  await applyHttpFloors(app, helmet === undefined ? {} : { helmet: helmet as never })
  const headers: Record<string, string> = {}
  const res = {
    setHeader: (name: string, value: string) => {
      headers[name.toLowerCase()] = String(value)
    },
    removeHeader: (name: string) => {
      delete headers[name.toLowerCase()]
    },
    getHeader: () => undefined
  }
  middleware?.({}, res, () => undefined)
  return JSON.stringify(Object.entries(headers).sort())
}

/** The options a host could give, each leaving every other name out. */
const INPUTS: ReadonlyArray<readonly [string, object | undefined]> = [
  ['no helmet option', undefined],
  ['an empty object', {}],
  [
    'a policy of its own',
    { contentSecurityPolicy: { useDefaults: false, directives: { defaultSrc: ["'none'"] } } }
  ],
  [
    'switches given as true',
    {
      contentSecurityPolicy: true,
      crossOriginEmbedderPolicy: true,
      referrerPolicy: true,
      frameguard: true
    }
  ],
  ['the hsts alias', { hsts: { maxAge: 100 } }],
  [
    'empty settings',
    { crossOriginResourcePolicy: {}, strictTransportSecurity: {}, xFrameOptions: {} }
  ]
]

const PLANTED: readonly unknown[] = [true, false, 'x', 'cross-origin', 1, ['a'], {}]

describe.each([false, true])(
  'a name planted on Object.prototype under the options of helmet (enumerable: %s)',
  (enumerable) => {
    beforeAll(() => {
      ENUMERABLE = enumerable
    })
    it.each(INPUTS)('does not change the headers served for %s', async (_name, input) => {
      const baseline = await headersOf(input)

      for (const name of [
        ...HELMET_OPTION_NAMES,
        ...SETTING_NAMES,
        'maxage',
        'includeSubdomains'
      ]) {
        for (const value of PLANTED) {
          Object.defineProperty(Object.prototype, name, {
            value,
            configurable: true,
            writable: true,
            enumerable: ENUMERABLE
          })
          let served: string
          try {
            served = await headersOf(input)
          } finally {
            delete (Object.prototype as Record<string, unknown>)[name]
          }
          expect([name, JSON.stringify(value), served]).toEqual([
            name,
            JSON.stringify(value),
            baseline
          ])
        }
      }
    })
  }
)

describe('the options of helmet that take settings, left out or given as true', () => {
  /** The header `name` of one run, or `undefined`. */
  async function header(helmet: object | undefined, name: string): Promise<string | undefined> {
    const entries = JSON.parse(await headersOf(helmet)) as Array<[string, string]>
    return entries.find(([key]) => key === name)?.[1]
  }

  it('leaves the cross-origin embedder policy and the transport security off unless asked', async () => {
    expect(await header(undefined, 'cross-origin-embedder-policy')).toBeUndefined()
    expect(await header({}, 'strict-transport-security')).toBeUndefined()
  })

  it.each([
    ['crossOriginEmbedderPolicy', 'cross-origin-embedder-policy', 'require-corp'],
    ['strictTransportSecurity', 'strict-transport-security', 'max-age=31536000; includeSubDomains'],
    ['hsts', 'strict-transport-security', 'max-age=31536000; includeSubDomains']
  ])(
    'turns %s on with its defaults when it is given as true, planted names or not',
    async (name, key, value) => {
      expect(await header({ [name]: true }, key)).toBe(value)

      for (const planted of ['maxAge', 'policy']) {
        Object.defineProperty(Object.prototype, planted, {
          value: planted === 'maxAge' ? 5 : 'unsafe-none',
          configurable: true,
          writable: true
        })
      }
      try {
        expect(await header({ [name]: true }, key)).toBe(value)
      } finally {
        for (const planted of ['maxAge', 'policy']) {
          delete (Object.prototype as Record<string, unknown>)[planted]
        }
      }
    }
  )

  it.each([
    ['strictTransportSecurity', { maxAge: 100 }, 'max-age=100; includeSubDomains'],
    ['hsts', { maxAge: 100 }, 'max-age=100; includeSubDomains']
  ])('reads the settings the host gave %s, planted names or not', async (name, settings, value) => {
    Object.defineProperty(Object.prototype, 'preload', {
      value: true,
      configurable: true,
      writable: true
    })
    try {
      expect(await header({ [name]: settings }, 'strict-transport-security')).toBe(value)
    } finally {
      delete (Object.prototype as Record<string, unknown>)['preload']
    }
  })
})

describe('the names the installed helmet reads', () => {
  it('are all names this package lists', () => {
    const source = readFileSync(
      createRequire(__filename)
        .resolve('helmet')
        .replace(/index\.cjs$/, 'index.mjs'),
      'utf8'
    )
    const read = new Set<string>()
    for (const found of source.matchAll(/\boptions\??\.(\w+)/g)) read.add(found[1] as string)
    for (const found of source.matchAll(/\(\{([^}()]*)\}\)\s*(?:=>|\{)/g)) {
      for (const part of (found[1] as string).split(',')) {
        const name = part.split('=')[0]?.split(':')[0]?.trim()
        if (name) read.add(name)
      }
    }
    for (const found of source.matchAll(/"(\w+)" in options/g)) read.add(found[1] as string)
    read.delete('constructor')

    const known = new Set([...HELMET_OPTION_NAMES, ...SETTING_NAMES, 'maxage', 'includeSubdomains'])

    expect([...read].filter((name) => !known.has(name))).toEqual([])
  })
})
