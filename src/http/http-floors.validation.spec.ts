/**
 * Unit tests for how `applyHttpFloors` reads the options it is given, over every option.
 *
 * Layer: unit.
 * Goal: every option refuses a value of the wrong type without echoing it, an option it does not have
 * is refused by name, helmet is an object of helmet's own option names or `false`, and an option left
 * `undefined` or `null` is read as unset, except an option of helmet, where `null` is refused.
 * Mocks: a fake application that records what is registered; helmet itself is real.
 */
import helmet from 'helmet'
import type { INestApplication } from '@nestjs/common'

import { resolveCors } from './http-floors.cors'
import { applyHttpFloors, HELMET_OPTION_NAMES } from './http-floors'
import type { HttpFloorsOptions } from './http-floors'

/** What a hostile or mistaken value must never leak into a message. */
const SECRET = 'SECRET-sentinel-7f3a'

/** The values whose text could reach a message. */
const SENTINELS: readonly unknown[] = [
  SECRET,
  Symbol(SECRET),
  Object.defineProperty(() => 1, 'name', { value: SECRET }),
  { toString: () => SECRET },
  BigInt(12345)
]

/** Every option, as the path of keys to it. */
const OPTIONS: readonly (readonly string[])[] = [
  ['helmet'],
  ['headersTimeoutMs'],
  ['requestTimeoutMs'],
  ['connectionsCheckingIntervalMs'],
  ['keepAliveTimeoutMs'],
  ['bodyLimit'],
  ['bodyLimit', 'json'],
  ['bodyLimit', 'urlencoded'],
  ['cors'],
  ['cors', 'origins'],
  ['cors', 'credentials'],
  ['cors', 'methods'],
  ['cors', 'allowedHeaders'],
  ['cors', 'exposedHeaders'],
  ['cors', 'maxAgeSeconds']
]

/** A fake Express-backed application, and what was registered on it. */
function fakeApp(): { app: INestApplication; used: unknown[] } {
  const used: unknown[] = []
  const app = {
    getHttpAdapter: () => ({ getType: () => 'express' }),
    getHttpServer: () => ({ listening: false }),
    use: (middleware: unknown) => used.push(middleware),
    enableCors: () => undefined,
    useBodyParser: () => undefined
  }
  return { app: app as unknown as INestApplication, used }
}

/** Options with the value at `path`, over a valid CORS block so its inner options are reached. */
function withValue(path: readonly string[], value: unknown): HttpFloorsOptions {
  const base: Record<string, unknown> = { cors: { origins: ['https://app.example.com'] } }
  const [head, tail] = path
  if (tail === undefined) return { ...base, [head as string]: value } as HttpFloorsOptions
  const inner = head === 'cors' ? (base['cors'] as object) : {}
  return { ...base, [head as string]: { ...inner, [tail]: value } } as HttpFloorsOptions
}

/** The message `applyHttpFloors` rejects with, or `undefined` when it resolves. */
async function refusal(options: HttpFloorsOptions): Promise<string | undefined> {
  try {
    await applyHttpFloors(fakeApp().app, options)
    return undefined
  } catch (error) {
    expect(error).toBeInstanceOf(Error)
    return (error as Error).message
  }
}

describe('a refusal names the option and the type of the value, and nothing else', () => {
  const cases = OPTIONS.flatMap((path) =>
    SENTINELS.map((value) => [path.join('.'), path, value] as const)
  )

  it.each(cases)('%s given a hostile value', async (name, path, value) => {
    const message = await refusal(withValue(path, value))
    if (message !== undefined) {
      expect(message).not.toContain(SECRET)
      expect(message).not.toContain('12345')
      expect(message).toContain(name)
    }
  })

  it('a list entry is named by its position and never shown', async () => {
    for (const [option, entry] of [
      ['origins', 'https://evil.example.com/path'],
      ['methods', SECRET],
      ['allowedHeaders', `${SECRET} bad`],
      ['exposedHeaders', `${SECRET}:bad`]
    ] as const) {
      const message = await refusal({
        cors: { origins: ['https://app.example.com'], [option]: [entry] }
      } as HttpFloorsOptions)
      expect(message).toContain(`cors.${option}`)
      expect(message).not.toContain(SECRET)
      expect(message).not.toContain('evil')
    }
  })

  it('refuses an origin that is a bigint with a message, not a TypeError from stringifying it', async () => {
    const message = await refusal({ cors: { origins: [BigInt(1)] } } as never)
    expect(message).toContain('cors.origins')
  })

  it('shows a number and not a string for a limit', async () => {
    expect(await refusal({ keepAliveTimeoutMs: 1.5 })).toContain('received 1.5')
    expect(await refusal({ keepAliveTimeoutMs: '65000' as never })).toContain('received a string')
    expect(await refusal({ bodyLimit: { json: '999gb' } })).not.toContain('999')
  })
})

describe('an option that is not there is refused by name', () => {
  it('at the top level', async () => {
    expect(await refusal({ bogus: 1 } as never)).toBe('options has an unknown option "bogus"')
  })

  it.each(['bodyLimit', 'cors'])('inside %s', async (block) => {
    const options = { cors: { origins: ['https://a.example.com'] }, [block]: {} } as never
    const given =
      block === 'cors'
        ? { cors: { origins: ['https://a.example.com'], bogus: 1 } }
        : { bodyLimit: { bogus: 1 } }
    expect(await refusal({ ...(options as object), ...given } as never)).toContain(
      `${block} has an unknown option "bogus"`
    )
  })

  it('refuses options that are not an object', async () => {
    for (const value of ['x', 1, [], true]) {
      expect(await refusal(value as never)).toContain('options must be an object')
    }
  })
})

describe('an option left undefined or null is read as unset', () => {
  it('on every option', async () => {
    for (const unset of [undefined, null]) {
      const blank = {
        headersTimeoutMs: unset,
        requestTimeoutMs: unset,
        connectionsCheckingIntervalMs: unset,
        keepAliveTimeoutMs: unset,
        bodyLimit: { json: unset, urlencoded: unset },
        helmet: unset,
        cors: {
          origins: ['https://a.example.com'],
          credentials: unset,
          methods: unset,
          allowedHeaders: unset,
          exposedHeaders: unset,
          maxAgeSeconds: unset
        }
      }
      expect(await refusal(blank as never)).toBeUndefined()
    }
  })
})

/** The response headers helmet sets when it runs for `options`. */
async function headersFor(options: HttpFloorsOptions): Promise<string[]> {
  const { app, used } = fakeApp()
  await applyHttpFloors(app, options)
  const set: string[] = []
  const response = {
    setHeader: (name: string) => set.push(name.toLowerCase()),
    removeHeader: () => undefined,
    getHeader: () => undefined
  }
  ;(used[0] as (req: object, res: object, next: () => void) => void)({}, response, () => undefined)
  return set
}

describe('cors given as null or undefined is off', () => {
  it('reads both as unset, and so are the options as a whole', async () => {
    expect(await refusal(null as never)).toBeUndefined()
    expect(await refusal({ cors: null } as never)).toBeUndefined()
    expect(await refusal({ cors: undefined } as never)).toBeUndefined()
  })
})

describe('resolveCors called with nothing', () => {
  it('refuses, because it is only called for a block that is set', () => {
    expect(() => resolveCors(undefined)).toThrow('cors must be an object such as')
  })
})

describe('helmet is an object of helmet option names, or false', () => {
  it.each(['x', 1, true, []])('refuses %j', async (value) => {
    expect(await refusal({ helmet: value } as never)).toMatch(
      /^helmet must be an object or false, received/
    )
  })

  it('refuses an option helmet does not have, which helmet itself would ignore', async () => {
    expect(await refusal({ helmet: { contentSecurityPolcy: false } })).toBe(
      'helmet has an unknown option "contentSecurityPolcy"'
    )
  })

  it("the list is the installed helmet's own names, no more and no fewer", async () => {
    const names = Object.keys(helmet).filter((name) => name !== 'default')
    expect([...HELMET_OPTION_NAMES].sort()).toEqual(names.sort())
    for (const name of names) {
      expect(await refusal({ helmet: { [name]: false } })).toBeUndefined()
    }
  })

  it('leaves helmet out for false', async () => {
    const { app, used } = fakeApp()
    await applyHttpFloors(app, { helmet: false })
    expect(used).toEqual([])
  })

  it('reads an own undefined key as unset, so HSTS stays off as it does by default', async () => {
    expect(
      await headersFor({ helmet: { strictTransportSecurity: undefined } as never })
    ).not.toContain('strict-transport-security')
    expect(await headersFor({ helmet: { strictTransportSecurity: true } })).toContain(
      'strict-transport-security'
    )
  })

  /**
   * A null that comes from configuration must not silently mean "no header": the protections helmet
   * switches on are refused when set to null, and only an option left out takes its default.
   */
  it.each(HELMET_OPTION_NAMES)('refuses %s set to null', async (name) => {
    expect(await refusal({ helmet: { [name]: null } } as never)).toBe(
      `helmet.${name} must not be null: leave it out, or give an object, true or false`
    )
  })
})

describe('cors refusals carry exact messages', () => {
  const ok = 'https://app.example.com'

  it.each([
    [
      'a list that is a string',
      { origins: [ok], methods: 'GET' },
      'cors.methods must be a list of strings, received a string'
    ],
    [
      'origins that are a string',
      { origins: ok },
      'cors.origins must be a list of origins, received a string'
    ],
    ['origins left out', {}, 'cors.origins must list at least one origin'],
    ['origins that are empty', { origins: [] }, 'cors.origins must list at least one origin'],
    [
      'a wildcard in the second origin',
      { origins: [ok, 'https://*.example.com'] },
      'cors.origins entry 2 has a wildcard in its host: a pattern is not matched, list each origin'
    ]
  ])('%s', async (_name, cors, message) => {
    expect(await refusal({ cors } as never)).toBe(message)
  })
})
