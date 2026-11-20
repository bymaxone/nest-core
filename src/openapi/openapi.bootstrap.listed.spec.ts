/**
 * Unit tests for the characters a listed route is escaped for.
 *
 * Layer: unit.
 * Goal: a line or paragraph separator and a bidirectional control in a route template reach the log
 * line as `\uXXXX`, and a character just outside those ranges is written as it is.
 * Mocks: none; a real Nest application with the logger captured.
 */
import { Controller, ConsoleLogger, Get, Logger } from '@nestjs/common'
import type { INestApplication } from '@nestjs/common'

import { applyBymaxOpenApi } from './openapi.bootstrap'
import { bootApp, ExampleController, logged } from './__tests__/bootstrap.harness'

describe('applyBymaxOpenApi, listed routes', () => {
  const originalNodeEnv = process.env['NODE_ENV']
  let app: INestApplication | undefined

  afterEach(async () => {
    await app?.close()
    app = undefined
    process.env['NODE_ENV'] = originalNodeEnv
    Logger.overrideLogger(new ConsoleLogger())
  })

  /**
   * Characters that break or reorder a line without showing are escaped; their neighbours are not.
   *
   * Each row names the first and last code point of a range and the one just outside it, so a range
   * that is off by one at either end is told apart from a correct one.
   */
  it.each([
    ['\u2028', '\\u2028'],
    ['\u2029', '\\u2029'],
    ['\u202a', '\\u202a'],
    ['\u202e', '\\u202e'],
    ['\u2066', '\\u2066'],
    ['\u2069', '\\u2069'],
    ['\u2027', '\u2027'],
    ['\u202f', '\u202f'],
    ['\u2065', '\u2065'],
    ['\u206a', '\u206a']
  ])('writes %j in a listed route as %j', async (char, written) => {
    process.env['NODE_ENV'] = 'test'
    class OddController {
      odd(): string {
        return 'ok'
      }
    }
    Controller('odd')(OddController)
    const descriptor = Object.getOwnPropertyDescriptor(OddController.prototype, 'odd')
    if (descriptor === undefined) throw new Error('no descriptor')
    Get(`a${char}b`)(OddController.prototype, 'odd', descriptor)
    app = await bootApp(
      {
        openapi: {
          enabled: true,
          securitySchemes: { cookieAuth: { type: 'apiKey', in: 'cookie', name: 'access_token' } },
          operationSecurity: { 'POST /auth/login': [] }
        }
      },
      [ExampleController, OddController]
    )

    await applyBymaxOpenApi(app)

    const [{ routes }] = (logged.warn as jest.Mock).mock.calls[0] as [{ routes: string }]
    expect(routes).toContain(`a${written}b`)
  })
})
