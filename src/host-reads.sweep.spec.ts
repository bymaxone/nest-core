/**
 * Unit tests for an Nth-operation sweep of what a host hands over: a contributor's fragment and the
 * options object.
 *
 * Layer: unit.
 * Goal: every object the build reads from a contributor's fragment, or from the options, at any depth, is wrapped
 * in a proxy whose Nth trap throws, for each N until no trap is left to reach; every run that reaches
 * the throwing trap fails as the contributor's labelled error with the host error somewhere in its
 * cause chain, and no message carries the host's text.
 * Mocks: none; the fragment is a plain object wrapped in proxies, the document is a small literal.
 */
import type { INestApplication } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { Registry } from 'prom-client'

import { normalizeCoreOptions } from './core.options'
import type { BymaxCoreModuleOptions } from './core.options'
import {
  BYMAX_OPENAPI_CONTRACT_VERSION,
  BYMAX_OPENAPI_CONTRIBUTOR_METADATA
} from './openapi/openapi.contract'
import type { IOpenApiContributor, OpenApiFragment } from './openapi/openapi.contract'
import { applyHttpFloors } from './http/http-floors'
import type { HttpFloorsOptions } from './http/http-floors'
import { discoverIndicators } from './health/health.discovery'
import { BymaxHealthIndicator } from './health/health.marker'
import { BymaxMetricsContributor } from './metrics/metrics.contract'
import { applyContributions, discoverContributors } from './metrics/metrics.contribution'
import { collectContributions, createHandlerIdMap } from './openapi/openapi.contribution'
import { augmentDocument } from './openapi/openapi.document'

/** The text the host puts in everything it throws. */
const SECRET = 'SECRET-host-text'

/** How many traps have run, and which one throws. */
interface Sweep {
  count: number
  readonly failAt: number
}

/** Count a trap, and throw when it is the one being swept. */
function trip(sweep: Sweep): void {
  sweep.count += 1
  if (sweep.count === sweep.failAt) throw new Error(`${SECRET} ${sweep.failAt}`)
}

/** `value` wrapped, and every object read out of it wrapped, in proxies that count their traps. */
function trapped<T>(value: T, sweep: Sweep): T {
  if (typeof value !== 'object' || value === null) return value
  return new Proxy(value, {
    get: (target, key, receiver) => {
      trip(sweep)
      return trapped(Reflect.get(target, key, receiver) as unknown, sweep)
    },
    has: (target, key) => {
      trip(sweep)
      return Reflect.has(target, key)
    },
    ownKeys: (target) => {
      trip(sweep)
      return Reflect.ownKeys(target)
    },
    getOwnPropertyDescriptor: (target, key) => {
      trip(sweep)
      return Reflect.getOwnPropertyDescriptor(target, key)
    },
    getPrototypeOf: (target) => {
      trip(sweep)
      return Reflect.getPrototypeOf(target)
    }
  })
}

/** A fragment that describes an operation and a component, as a library would. */
function fragment(): OpenApiFragment {
  return {
    contractVersion: BYMAX_OPENAPI_CONTRACT_VERSION,
    operations: {
      'Items.list': {
        summary: 'List the items',
        tags: ['items'],
        responses: {
          '200': {
            description: 'The items',
            content: { 'application/json': { schema: { type: 'object', properties: {} } } }
          }
        }
      }
    },
    components: { schemas: { Item: { type: 'object', properties: { id: { type: 'string' } } } } }
  }
}

/** Collect and merge a swept fragment into a small document; returns what was thrown, if anything. */
function build(sweep: Sweep): unknown {
  class Hostile {
    contributeOpenApi(): OpenApiFragment {
      return trapped(fragment(), sweep)
    }
  }
  Reflect.defineMetadata(BYMAX_OPENAPI_CONTRIBUTOR_METADATA, true, Hostile)
  const handlers = createHandlerIdMap()
  handlers.record('Items', 'list', undefined, 'Items_list')
  const document = {
    openapi: '3.0.0',
    info: { title: 't', version: '1' },
    paths: { '/items': { get: { operationId: 'Items_list', responses: {} } } },
    components: {}
  }
  try {
    const contributions = collectContributions(
      { getProviders: () => [{ metatype: Hostile, instance: new Hostile() }] },
      new Reflector(),
      handlers
    )
    augmentDocument(
      document,
      normalizeCoreOptions({ openapi: { enabled: true } }),
      [''],
      contributions
    )
    return undefined
  } catch (error) {
    return error
  }
}

/** Every `cause` down a chain, starting from `error`. */
function chain(error: unknown): unknown[] {
  const found: unknown[] = []
  for (let next: unknown = error; next instanceof Error; next = next.cause) found.push(next)
  return found
}

describe('a fragment read through proxies that throw at the Nth trap', () => {
  it('fails as the contributor error with the host error as cause, for every N', () => {
    const raw: number[] = []
    let operations = 0
    for (let failAt = 1; failAt < 2_000; failAt += 1) {
      const sweep: Sweep = { count: 0, failAt }
      const thrown = build(sweep)
      if (sweep.count < failAt) {
        operations = sweep.count
        break
      }
      const labelled =
        thrown instanceof Error &&
        (thrown as Error & { contributor?: string }).contributor === 'Hostile' &&
        !thrown.message.includes(SECRET) &&
        chain(thrown).some((link) => link instanceof Error && link.message.includes(SECRET))
      if (!labelled) raw.push(failAt)
    }

    expect(operations).toBeGreaterThan(20)
    expect(raw).toEqual([])
  })
})

/** A set of options that touches every block the resolver reads. */
function options(): BymaxCoreModuleOptions {
  return {
    environment: 'test',
    health: { path: 'health', readinessCacheMs: 10 },
    metrics: {
      enabled: true,
      path: 'metrics',
      defaultLabels: { team: 'core' },
      authToken: 'token'
    },
    openapi: {
      enabled: true,
      title: 'Title',
      securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } }
    },
    timing: { enabled: true },
    handlerTimeout: { enabled: true, timeoutMs: 100 }
  }
}

describe('the options read through proxies that throw at the Nth trap', () => {
  it('fail as the options error with the host error as cause, for every N', () => {
    const raw: number[] = []
    let operations = 0
    for (let failAt = 1; failAt < 2_000; failAt += 1) {
      const sweep: Sweep = { count: 0, failAt }
      let thrown: unknown
      try {
        normalizeCoreOptions(trapped(options(), sweep))
      } catch (error) {
        thrown = error
      }
      if (sweep.count < failAt) {
        operations = sweep.count
        break
      }
      const read =
        thrown instanceof Error &&
        thrown.message === 'the options could not be read' &&
        chain(thrown).some((link) => link instanceof Error && link.message.includes(SECRET))
      if (!read) raw.push(failAt)
    }

    expect(operations).toBeGreaterThan(20)
    expect(raw).toEqual([])
  })
})

/**
 * `value` with every own property turned into a non-enumerable getter, for the options and for the
 * properties of each block. What a block holds under a host-named key, an open map, is left as given.
 */
function hidden<T>(value: T, depth = 0): T {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || depth > 1) return value
  const copy = {}
  for (const [key, inner] of Object.entries(value)) {
    Object.defineProperty(copy, key, { get: () => hidden(inner, depth + 1), enumerable: false })
  }
  return copy as T
}

describe('the documented options served only through non-enumerable getters', () => {
  it('resolve as the same options as when they are plain properties', () => {
    expect(normalizeCoreOptions(hidden(options()))).toEqual(normalizeCoreOptions(options()))
  })
})

describe('an open map, whose keys the host names', () => {
  it('is read as the host would enumerate it: a key that is not enumerable is not one of its entries', () => {
    const labels = {}
    Object.defineProperty(labels, 'team', { value: 'core', enumerable: false })
    Object.defineProperty(labels, 'app', { value: 'api', enumerable: true })
    const resolved = normalizeCoreOptions({
      environment: 'test',
      metrics: { enabled: true, defaultLabels: labels }
    })
    expect(resolved.metrics.defaultLabels).toEqual({ app: 'api' })
  })
})

/** Sweep `read` to the end; the numbers of the runs whose error is not a boot error naming `property`. */
function sweepProvider(read: (sweep: Sweep) => void, property: string): number[] {
  const raw: number[] = []
  for (let failAt = 1; failAt < 500; failAt += 1) {
    const sweep: Sweep = { count: 0, failAt }
    let thrown: unknown
    try {
      read(sweep)
    } catch (error) {
      thrown = error
    }
    if (sweep.count < failAt) return raw
    const labelled =
      thrown instanceof Error &&
      property in thrown &&
      !thrown.message.includes(SECRET) &&
      chain(thrown).some((link) => link instanceof Error && link.message.includes(SECRET))
    if (!labelled) raw.push(failAt)
  }
  return raw
}

describe('a provider read through proxies that throw at the Nth trap', () => {
  const reflector = new Reflector()

  it('a metrics contributor fails as a boot error naming it, for every N', () => {
    @BymaxMetricsContributor()
    class Queue {
      registerMetrics(): void {}
    }

    const raw = sweepProvider((sweep) => {
      const instance = trapped(new Queue(), sweep)
      applyContributions(
        discoverContributors(
          { getProviders: () => [{ metatype: Queue, instance, name: 'Queue' }] },
          reflector
        ),
        new Registry()
      )
    }, 'contributor')

    expect(raw).toEqual([])
  })

  it('a health indicator fails as a boot error naming it, for every N', () => {
    @BymaxHealthIndicator()
    class Database {
      name = 'database'
      check = (): Promise<{ status: 'up' }> => Promise.resolve({ status: 'up' })
    }

    const raw = sweepProvider((sweep) => {
      const instance = trapped(new Database(), sweep)
      discoverIndicators(
        { getProviders: () => [{ metatype: Database, instance, name: 'Database' }] },
        reflector
      )
    }, 'provider')

    expect(raw).toEqual([])
  })
})

/** A fake Express-backed application that accepts whatever is registered on it. */
function fakeApp(): INestApplication {
  return {
    getHttpAdapter: () => ({ getType: () => 'express' }),
    getHttpServer: () => ({ listening: false }),
    use: () => 1,
    enableCors: () => undefined,
    useBodyParser: () => undefined
  } as unknown as INestApplication
}

describe('the HTTP floors options read through proxies that throw at the Nth trap', () => {
  it('fail as the options error with the host error as cause, for every N', async () => {
    const floors: HttpFloorsOptions = {
      helmet: { contentSecurityPolicy: false },
      headersTimeoutMs: 1_000,
      requestTimeoutMs: 2_000,
      keepAliveTimeoutMs: 500,
      bodyLimit: { json: '1mb', urlencoded: '1mb' },
      cors: {
        origins: ['https://app.example.com'],
        credentials: true,
        methods: ['GET'],
        allowedHeaders: ['x-key'],
        exposedHeaders: ['x-id'],
        maxAgeSeconds: 10
      }
    }
    const raw: number[] = []
    let operations = 0
    for (let failAt = 1; failAt < 2_000; failAt += 1) {
      const sweep: Sweep = { count: 0, failAt }
      let thrown: unknown
      try {
        await applyHttpFloors(fakeApp(), trapped(floors, sweep))
      } catch (error) {
        thrown = error
      }
      if (sweep.count < failAt) {
        operations = sweep.count
        break
      }
      const read =
        thrown instanceof Error &&
        thrown.message === 'the options could not be read' &&
        chain(thrown).some((link) => link instanceof Error && link.message.includes(SECRET))
      if (!read) raw.push(failAt)
    }

    expect(operations).toBeGreaterThan(20)
    expect(raw).toEqual([])
  })
})
