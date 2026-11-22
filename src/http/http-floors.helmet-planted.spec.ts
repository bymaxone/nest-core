/**
 * Unit tests for the options `helmet` is handed, with a name planted on `Object.prototype`.
 *
 * Layer: unit.
 * Goal: `helmet` reads names it was not given, from the object it is handed or from one of its own, so
 * the headers an application serves must be the ones of an unplanted run whatever is planted; and the
 * names the installed `helmet` reads are all names this package knows.
 * Mocks: a fake Express application that keeps the middleware it is given; the real `helmet`.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

import type { INestApplication } from '@nestjs/common'

import { applyHttpFloors, HELMET_OPTION_NAMES } from './http-floors'

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

describe('a name planted on Object.prototype under the options of helmet', () => {
  it.each(INPUTS)('does not change the headers served for %s', async (_name, input) => {
    const baseline = await headersOf(input)

    for (const name of [...HELMET_OPTION_NAMES, ...SETTING_NAMES, 'maxage', 'includeSubdomains']) {
      for (const value of PLANTED) {
        Object.defineProperty(Object.prototype, name, { value, configurable: true, writable: true })
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
