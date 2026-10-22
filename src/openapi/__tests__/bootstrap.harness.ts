/**
 * @fileoverview Shared harness for the OpenAPI bootstrap specs: a captured
 * logger, a controller with one described and one bare route, and a helper that
 * boots a real Nest application around `BymaxCoreModule`.
 *
 * Extracted so the bootstrap suites can be split by concern — mounting rules in
 * one file, contributed-component reporting in another — without either copying
 * the harness. Nest's logger is replaced through the public
 * `Logger.overrideLogger` hook rather than by spying on `Logger.prototype`: a
 * prototype spy intercepts the call before Nest appends the logger's context, so
 * the context could not be asserted.
 * @layer test-support
 */
import { Controller, Get, Logger, Post } from '@nestjs/common'
import type { INestApplication, LoggerService, Provider, Type } from '@nestjs/common'
import { Test } from '@nestjs/testing'

import { BymaxCoreModule } from '../../core.module'
import type { BymaxCoreModuleOptions } from '../../core.options'

/** The context every log line the bootstrap helper writes must carry. */
export const LOG_CONTEXT = 'BymaxCoreModule'

/** Captures what Nest's logger received, message and context alike. */
export const logged = {
  log: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  verbose: jest.fn()
  // `satisfies` rather than a type annotation: the object still has to be a
  // LoggerService, and each member keeps its `jest.Mock` type, so a test can
  // read `.mock.calls` directly. An annotation erases that and every such read
  // needs a cast, which is a type error laundered rather than answered.
} satisfies LoggerService

/** A consumer's controller: one route described, one left as generated. */
@Controller()
export class ExampleController {
  /** Stands in for a handler a consumer marks public. */
  @Post('auth/login')
  login(): string {
    return 'ok'
  }

  /** Stands in for the guarded route that loses its requirement. */
  @Get('examples')
  list(): string {
    return 'ok'
  }
}

/**
 * Boot a Nest application around `BymaxCoreModule` with the logger captured.
 *
 * @param options - The core module options under test.
 * @param controllers - Controllers to register beside the package's own.
 * @param providers - Providers to register, such as OpenAPI contributors.
 * @returns The application, not yet initialised.
 */
export async function bootApp(
  options: BymaxCoreModuleOptions,
  controllers: readonly Type<unknown>[] = [],
  providers: readonly Provider[] = []
): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [BymaxCoreModule.forRoot(options)],
    controllers: [...controllers],
    providers: [...providers]
  }).compile()
  const app = moduleRef.createNestApplication()
  // Installed here, not in `beforeEach`: creating the application applies its own
  // logger options over Nest's global logger, so an override registered earlier
  // is discarded and every assertion on a log line would silently see nothing.
  Logger.overrideLogger(logged)
  return app
}
