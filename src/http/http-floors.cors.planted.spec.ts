/**
 * Unit tests for the options the CORS callback hands to `cors`, with a name planted on `Object.prototype`.
 *
 * Layer: unit.
 * Goal: `cors` merges the options it is handed over its defaults and reads `exposedHeaders`, `allowedHeaders`
 * (and its alias `headers`), `methods` and `maxAge` from the result, so an option the host left out must be an
 * own property of what is handed over, and a name planted afterwards answers none of them.
 * Mocks: a hand-built request; the real option builder.
 */
import { resolveCors } from './http-floors.cors'

/** The callback `cors` is given, for a CORS block, built before anything is planted. */
function callbackFor(
  cors: object
): (request: object, done: (error: null, options: object) => void) => void {
  return resolveCors(cors as never) as never
}

/** The options handed to `cors` for a request from an allowed origin. */
function offered(callback: ReturnType<typeof callbackFor>): Record<string, unknown> {
  let handed: Record<string, unknown> = {}
  callback({ headers: { origin: 'https://app.example' } }, (_error, options) => {
    handed = options as Record<string, unknown>
  })
  return handed
}

describe('the options handed to cors beside a planted name', () => {
  it.each(['exposedHeaders', 'allowedHeaders', 'headers', 'methods', 'maxAge'])(
    'ignores %s planted after boot, for a host that left it out',
    (name) => {
      const callback = callbackFor({ origins: ['https://app.example'] })
      Object.defineProperty(Object.prototype, name, {
        value: 'x-planted',
        enumerable: true,
        configurable: true,
        writable: true
      })
      try {
        const handed = offered(callback)

        expect(handed[name]).toEqual(
          name === 'methods' ? 'GET,HEAD,PUT,PATCH,POST,DELETE' : undefined
        )
        expect(Object.hasOwn(handed, name)).toBe(true)
      } finally {
        delete (Object.prototype as Record<string, unknown>)[name]
      }
    }
  )

  it('keeps what the host gave', () => {
    const handed = offered(
      callbackFor({
        origins: ['https://app.example'],
        methods: ['GET'],
        allowedHeaders: ['x-a'],
        exposedHeaders: ['x-b'],
        maxAgeSeconds: 60
      })
    )

    expect(handed).toMatchObject({
      methods: ['GET'],
      allowedHeaders: ['x-a'],
      exposedHeaders: ['x-b'],
      maxAge: 60
    })
  })
})
