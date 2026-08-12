/**
 * Integration tests for the `./openapi` public barrel.
 *
 * Layer: integration.
 * Goal: prove the subpath exposes exactly the bootstrap helper and the
 * contributor contract, and nothing more — the schema catalogue, the merge
 * rules, the discovery scan and the peer loader stay private — and that the
 * helper reached through the barrel is the same contract the feature's own
 * suite exercises.
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
   * The published surface is exactly the helper and the contract.
   *
   * Everything else in this subpath is an implementation detail, and keeping it
   * private is what lets the schema catalogue, the merge rules and the
   * contributor scan change without a major release. Asserted as an exact set
   * rather than a subset: an accidental re-export is a promise this package
   * then owns forever.
   */
  it('exports only the bootstrap helper and the contributor contract', () => {
    expect(Object.keys(barrel).sort()).toEqual([
      'BYMAX_OPENAPI_CONTRIBUTOR_METADATA',
      'BymaxOpenApiContributor',
      'applyBymaxOpenApi'
    ])
    expect(typeof applyBymaxOpenApi).toBe('function')
    expect(typeof barrel.BymaxOpenApiContributor).toBe('function')
    expect(barrel.BYMAX_OPENAPI_CONTRIBUTOR_METADATA).toBe('bymax-one:openapi-contributor')
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
