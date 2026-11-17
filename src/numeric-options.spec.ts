/**
 * Unit tests for the numeric options of the module and of `applyHttpFloors`, all in one table.
 *
 * Layer: unit.
 * Goal: every numeric option refuses NaN, the infinities, a negative number, a fraction and a
 * string, refuses zero unless zero is its documented value, and reads `null` as unset, so no option
 * is guarded by a test that lets one of those through.
 * Mocks: none; the resolvers are real and the floors are applied to a real application.
 */
import { Module } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import type { Server } from 'node:http'

import { normalizeCoreOptions } from './core.options'
import { applyHttpFloors } from './http/http-floors'

/** What every numeric option must refuse. */
const REFUSED: readonly unknown[] = [
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
  -1,
  1.5,
  '3'
]

/** The options of `BymaxCoreModule`, each as the block and the field, and whether `0` is legal. */
const CORE: readonly (readonly [string, string, boolean])[] = [
  ['envelope', 'serverErrorWindowMs', false],
  ['timing', 'slowRequestThresholdMs', false],
  ['bodyDepth', 'maxDepth', false],
  ['health', 'indicatorTimeoutMs', false],
  ['health', 'readinessCacheMs', true],
  ['metrics', 'scrapeTimeoutMs', false],
  ['handlerTimeout', 'timeoutMs', false],
  ['shutdown', 'deadlineMs', false]
]

/** The numeric options of `applyHttpFloors`. */
const FLOORS: readonly string[] = [
  'headersTimeoutMs',
  'requestTimeoutMs',
  'connectionsCheckingIntervalMs',
  'keepAliveTimeoutMs'
]

@Module({})
class Empty {}

/** Whether `attempt` throws; a value that is accepted reads as `false` with its name beside it. */
const refuses = (attempt: () => unknown): boolean => {
  try {
    attempt()
    return false
  } catch {
    return true
  }
}

/** Resolve one core option with `value`, or throw. */
const core = (block: string, field: string, value: unknown): unknown =>
  normalizeCoreOptions({ [block]: { [field]: value } } as never)

/** Apply the floors with `options` to a fresh application and return the server settings it left. */
async function floors(options: Record<string, unknown>): Promise<number[]> {
  const moduleRef = await Test.createTestingModule({ imports: [Empty] }).compile()
  const app = moduleRef.createNestApplication()
  const server = app.getHttpServer() as Server & { connectionsCheckingInterval: number }
  try {
    await applyHttpFloors(app, options as never)
    return [
      server.headersTimeout,
      server.requestTimeout,
      server.keepAliveTimeout,
      server.connectionsCheckingInterval
    ]
  } finally {
    await app.close()
  }
}

describe('numeric options of the module', () => {
  it.each(CORE)('%s.%s refuses what is not a usable number', (block, field, zeroLegal) => {
    for (const value of zeroLegal ? REFUSED : [...REFUSED, 0]) {
      expect([String(value), refuses(() => core(block, field, value))]).toEqual([
        String(value),
        true
      ])
    }
  })

  it.each(CORE)('%s.%s reads null as unset', (block, field) => {
    expect(core(block, field, null)).toEqual(core(block, field, undefined))
  })

  it('accepts zero where zero is the documented value', () => {
    expect(normalizeCoreOptions({ health: { readinessCacheMs: 0 } }).health.readinessCacheMs).toBe(
      0
    )
  })
})

describe('numeric options of applyHttpFloors', () => {
  it.each(FLOORS)('%s refuses what is not a usable number', async (field) => {
    for (const value of [...REFUSED, 0]) {
      await expect(floors({ [field]: value })).rejects.toThrow(new RegExp(field))
    }
  })

  it.each(FLOORS)('%s reads null as unset', async (field) => {
    expect(await floors({ [field]: null })).toEqual(await floors({}))
  })

  it('refuses a body limit and a CORS max age that are not usable numbers', async () => {
    const cors = (maxAgeSeconds: unknown): Record<string, unknown> => ({
      cors: { origins: ['https://a.example.com'], maxAgeSeconds }
    })
    for (const value of [...REFUSED, 0]) {
      await expect(floors({ bodyLimit: { json: value } })).rejects.toThrow(/bodyLimit\.json/)
      await expect(floors({ bodyLimit: { urlencoded: value } })).rejects.toThrow(
        /bodyLimit\.urlencoded/
      )
      await expect(floors(cors(value))).rejects.toThrow(/cors\.maxAgeSeconds/)
    }
  })

  it('reads null as unset for the body limits and the CORS max age', async () => {
    expect(await floors({ bodyLimit: { json: null, urlencoded: null } })).toEqual(await floors({}))
    expect(
      await floors({ cors: { origins: ['https://a.example.com'], maxAgeSeconds: null } })
    ).toEqual(await floors({}))
  })
})
