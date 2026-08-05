/**
 * Integration tests for the `./openapi` public barrel.
 *
 * Layer: integration.
 * Goal: prove the subpath exposes exactly the bootstrap helper and nothing more
 * — the schema catalogue, the merge rules, and the peer loader stay private —
 * and that the helper reached through the barrel is the same contract the
 * feature's own suite exercises.
 * Mocks: none; a real Nest application is built by `@nestjs/testing`.
 */
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'

import { BymaxCoreModule } from '../core.module'
import * as barrel from './index'
import { applyBymaxOpenApi } from './index'

describe('openapi subpath barrel', () => {
  let app: INestApplication | undefined

  afterEach(async () => {
    await app?.close()
    app = undefined
  })

  /**
   * The published surface is exactly one function.
   *
   * Everything else in this subpath is an implementation detail, and keeping it
   * private is what lets the schema catalogue and the merge rules change
   * without a major release.
   */
  it('exports only the bootstrap helper', () => {
    expect(Object.keys(barrel)).toEqual(['applyBymaxOpenApi'])
    expect(typeof applyBymaxOpenApi).toBe('function')
  })

  /**
   * The barrel export is the working contract, not a stub.
   *
   * A barrel that re-exports the wrong symbol still type-checks; calling
   * through it against a real application is what proves the specifier a
   * consumer imports actually does the work.
   */
  it('skips mounting through the barrel when the feature is disabled', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [BymaxCoreModule.forRoot({})]
    }).compile()
    app = moduleRef.createNestApplication()

    await expect(applyBymaxOpenApi(app)).resolves.toEqual({
      mounted: false,
      reason: 'disabled'
    })
  })
})
