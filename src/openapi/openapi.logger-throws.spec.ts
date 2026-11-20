/**
 * Unit tests for the OpenAPI bootstrap when the application's logger throws.
 *
 * Layer: unit.
 * Goal: a logger installed with `Logger.overrideLogger` that throws on every call does not stop the
 * document from being served, whichever of the three lines (served, unsecured, refused) is written.
 * Mocks: none; a real Nest application and a real `Logger` delegating to a throwing logger.
 */
import { ConsoleLogger, Logger } from '@nestjs/common'
import type { INestApplication, LoggerService } from '@nestjs/common'

import { applyBymaxOpenApi } from './openapi.bootstrap'
import { bootApp, ExampleController } from './__tests__/bootstrap.harness'

/** A logger whose every method throws synchronously. */
const throwing: LoggerService = {
  log: () => {
    throw new Error('logger down')
  },
  warn: () => {
    throw new Error('logger down')
  },
  error: () => {
    throw new Error('logger down')
  }
}

describe('applyBymaxOpenApi with a logger that throws', () => {
  const originalNodeEnv = process.env['NODE_ENV']
  let app: INestApplication | undefined

  afterEach(async () => {
    await app?.close()
    app = undefined
    process.env['NODE_ENV'] = originalNodeEnv
    Logger.overrideLogger(new ConsoleLogger())
  })

  it('still serves the document when the served and unsecured lines cannot be written', async () => {
    process.env['NODE_ENV'] = 'test'
    app = await bootApp(
      {
        openapi: {
          enabled: true,
          securitySchemes: { cookieAuth: { type: 'apiKey', in: 'cookie', name: 'access_token' } },
          operationSecurity: { 'POST /auth/login': [] }
        }
      },
      [ExampleController]
    )
    Logger.overrideLogger(throwing)

    await expect(applyBymaxOpenApi(app)).resolves.toMatchObject({ mounted: true })
  })

  it('still reports that production refused the document', async () => {
    process.env['NODE_ENV'] = 'production'
    app = await bootApp({ openapi: { enabled: true } })
    Logger.overrideLogger(throwing)

    await expect(applyBymaxOpenApi(app)).resolves.toEqual({ mounted: false, reason: 'production' })
  })
})
