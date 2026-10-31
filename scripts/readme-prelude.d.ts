/**
 * @fileoverview The names a README snippet uses without declaring them, typed
 * against the published package. `check-published-surface.mjs` copies this file into
 * the throwaway consumer it compiles the snippets in, so a call made through one of
 * these names is checked against the real types instead of resolving to `any`.
 * Only names the surrounding prose introduces belong here; a wrong option, method or
 * field on a package type is a real error and must stay one.
 */
import type { IHealthIndicator } from '@bymax-one/nest-core/health'
import type { OperationSecurityMap } from '@bymax-one/nest-core'
import type { PageQuery } from '@bymax-one/nest-core/pagination'
import type { INestApplication } from '@nestjs/common'
import type supertest from 'supertest'

declare global {
  /** What `this` holds in a snippet that shows calls without a class around them. */
  type SnippetContext = object

  /** The application's own configuration service in the `forRootAsync` example. */
  class AppConfigService {
    readonly env: string
  }
  /** `@nestjs/config`'s service, which the fixture does not install. */
  class ConfigService {
    get(key: string): string | undefined
    getOrThrow<T>(key: string): T
  }

  const app: INestApplication
  const request: typeof supertest

  interface Invoice {
    id: string
  }
  class InvoiceRepository {
    findPage(query: PageQuery): Promise<{ rows: Invoice[]; total: number }>
    findAfter(after: { id: string } | undefined, limit: number): Promise<Invoice[]>
  }
  interface RedisClient {
    ping(): Promise<unknown>
  }
  /** Defined by an earlier README snippet. */
  class RedisHealthIndicator implements IHealthIndicator {
    readonly name: string
    check: IHealthIndicator['check']
  }

  interface MyStructuredLogger {
    info(event: string, fields: Record<string, unknown>): void
    warn(event: string, fields: Record<string, unknown>): void
  }

  const myOwnOverrides: OperationSecurityMap
  function buildYourDocument(): { security: unknown }
  function publicOperationsOf(document: unknown): string[]

  /** Resolved options of the package the contributor example belongs to. */
  interface ResolvedAuthOptions {
    cookies: { accessTokenName: string; refreshTokenName: string }
  }
}

export {}
