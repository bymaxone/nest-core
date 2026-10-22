/**
 * Unit tests for the discarded-component report the bootstrap helper produces.
 *
 * Layer: unit.
 * Goal: prove that a component entry a library contributes and the document
 * already declares is reported rather than dropped in silence — through
 * `discarded` on the outcome and through a boot warning — and that the served
 * document keeps the application's own definition either way.
 * Mocks: none for the peer; the real `@nestjs/swagger` runs against a real Nest
 * application. The logger and the boot helper come from the shared harness.
 */
import type { INestApplication } from '@nestjs/common'
import request from 'supertest'

import { BymaxOpenApiContributor, BYMAX_OPENAPI_CONTRACT_VERSION } from './openapi.contract'
import type { IOpenApiContributor, OpenApiFragment } from './openapi.contract'
import { applyBymaxOpenApi } from './openapi.bootstrap'
import { bootApp, ExampleController, logged, LOG_CONTEXT } from './__tests__/bootstrap.harness'

/** The exact warning emitted for a single contributed entry the document keeps. */
const DISCARDED_WARNING =
  'the served OpenAPI document already defines 1 component entry(ies) a library also contributes: ' +
  'CollidingOpenApi -> securitySchemes.cookieAuth. The contributed version is not served, so a ' +
  "client generated from this document will not match that library's own types. What holds the " +
  "name may be the application's own declaration, a core schema under openapi.includeCoreSchemas, " +
  'or a contributor that sorted earlier — read the document before deciding what to remove.'

/** A library contributing one scheme under a name the application already declares. */
@BymaxOpenApiContributor()
class CollidingOpenApi implements IOpenApiContributor {
  /** Contributes a scheme whose name the consumer's own options also supply. */
  contributeOpenApi(): OpenApiFragment {
    return {
      contractVersion: BYMAX_OPENAPI_CONTRACT_VERSION,
      components: { securitySchemes: { cookieAuth: { type: 'http', scheme: 'bearer' } } }
    }
  }
}

/** A library colliding on exactly the number of names the warning lists. */
@BymaxOpenApiContributor()
class TenCollisionsOpenApi implements IOpenApiContributor {
  /** Contributes ten schemes, every one of them already declared. */
  contributeOpenApi(): OpenApiFragment {
    return {
      contractVersion: BYMAX_OPENAPI_CONTRACT_VERSION,
      components: {
        securitySchemes: Object.fromEntries(
          Array.from({ length: 10 }, (_unused, index) => [
            `scheme${index}`,
            { type: 'http', scheme: 'bearer' }
          ])
        )
      }
    }
  }
}

/** The ten schemes `TenCollisionsOpenApi` collides with, as the consumer declares them. */
const TEN_SCHEMES = Object.fromEntries(
  Array.from({ length: 10 }, (_unused, index) => [
    `scheme${index}`,
    { type: 'apiKey', in: 'cookie', name: `c${index}` }
  ])
)

/** A library colliding on more names than the warning lists, to prove the elision. */
@BymaxOpenApiContributor()
class ManyCollisionsOpenApi implements IOpenApiContributor {
  /** Contributes eleven schemes, every one of them already declared. */
  contributeOpenApi(): OpenApiFragment {
    return {
      contractVersion: BYMAX_OPENAPI_CONTRACT_VERSION,
      components: {
        securitySchemes: Object.fromEntries(
          Array.from({ length: 11 }, (_unused, index) => [
            `scheme${index}`,
            { type: 'http', scheme: 'bearer' }
          ])
        )
      }
    }
  }
}

/** The eleven schemes `ManyCollisionsOpenApi` collides with, as the consumer declares them. */
const ELEVEN_SCHEMES = Object.fromEntries(
  Array.from({ length: 11 }, (_unused, index) => [
    `scheme${index}`,
    { type: 'apiKey', in: 'cookie', name: `c${index}` }
  ])
)

/**
 * The discarded-components warning this run recorded, or `''` when none was.
 *
 * Reads the recorded argument rather than matching through
 * `expect.stringContaining`, so a test can assert what the line must **not**
 * contain. A `stringContaining` assertion cannot fail on extra content, which
 * makes it the wrong instrument for an elision: a line that listed everything
 * and then said "and 1 more" satisfies every such matcher written about it.
 *
 * @returns The warning text, or the empty string when it was never written.
 */
function discardWarning(): string {
  const call = logged.warn.mock.calls.find(
    ([message]) => typeof message === 'string' && message.includes('component entry(ies)')
  )
  return call === undefined ? '' : String(call[0])
}

describe('applyBymaxOpenApi — contributed component collisions', () => {
  const originalNodeEnv = process.env['NODE_ENV']
  let app: INestApplication | undefined

  afterEach(async () => {
    await app?.close()
    app = undefined
    jest.clearAllMocks()
    if (originalNodeEnv === undefined) {
      delete process.env['NODE_ENV']
    } else {
      process.env['NODE_ENV'] = originalNodeEnv
    }
  })

  /**
   * A contributed entry the document already declares is named on the way up.
   *
   * Silent by construction on both sides, which is what makes the log line the
   * only surface that can speak: the served document validates and looks
   * exactly as it would had nothing been offered, the contributing library gets
   * no signal that its entry lost, and the application gets none that one was
   * offered. A consumer's own document test stays green either way.
   */
  it('warns about a contributed component the document keeps its own version of', async () => {
    process.env['NODE_ENV'] = 'test'
    app = await bootApp(
      {
        openapi: {
          enabled: true,
          securitySchemes: { cookieAuth: { type: 'apiKey', in: 'cookie', name: 'access_token' } }
        }
      },
      [ExampleController],
      [CollidingOpenApi]
    )

    const outcome = await applyBymaxOpenApi(app)

    // Asserted whole: the consequence leads, because what makes someone act is
    // that a generated client will disagree with the library's own types, and
    // the last clause names both ways out rather than only the fix.
    expect(logged.warn).toHaveBeenCalledWith(DISCARDED_WARNING, LOG_CONTEXT)
    expect(outcome.discarded).toEqual([
      { contributor: 'CollidingOpenApi', member: 'securitySchemes', name: 'cookieAuth' }
    ])
  })

  /**
   * The served document is unchanged by the collision, which is the point.
   *
   * Read from the response rather than from the outcome object: a test that
   * asserts only what this package reports would pass even if the merge had
   * served the contributed entry after all.
   */
  it('serves the application definition of a contested component', async () => {
    process.env['NODE_ENV'] = 'test'
    app = await bootApp(
      {
        openapi: {
          enabled: true,
          securitySchemes: { cookieAuth: { type: 'apiKey', in: 'cookie', name: 'access_token' } }
        }
      },
      [ExampleController],
      [CollidingOpenApi]
    )
    await applyBymaxOpenApi(app)
    await app.init()

    const response = await request(app.getHttpServer()).get('/docs-json')

    expect(response.body.components.securitySchemes.cookieAuth).toEqual({
      type: 'apiKey',
      in: 'cookie',
      name: 'access_token'
    })
  })

  /**
   * Past the listing cap the line counts the rest instead of printing it.
   *
   * A library contributing a schema per DTO turns one collision into a hundred,
   * and the version that prints them all is the one an operator learns to skip
   * — which would cost the neighbouring warning its audience too.
   */
  it('elides the collisions it does not list', async () => {
    process.env['NODE_ENV'] = 'test'
    app = await bootApp(
      { openapi: { enabled: true, securitySchemes: ELEVEN_SCHEMES } },
      [ExampleController],
      [ManyCollisionsOpenApi]
    )

    const outcome = await applyBymaxOpenApi(app)

    expect(outcome.discarded).toHaveLength(11)
    expect(discardWarning()).toContain('11 component entry(ies)')
    expect(discardWarning()).toContain(', and 1 more')
    // The count is not enough on its own: a line that listed all eleven and
    // then said "and 1 more" would satisfy both assertions above.
    expect(discardWarning()).not.toContain('scheme10')
  })

  /**
   * An application whose contributions all land boots without the line.
   *
   * The warning is only worth having if it stays rare; fired on every boot it
   * trains people to skip warnings, including this one.
   */
  it('stays silent when every contributed component is placed', async () => {
    process.env['NODE_ENV'] = 'test'
    app = await bootApp({ openapi: { enabled: true } }, [ExampleController], [CollidingOpenApi])

    const outcome = await applyBymaxOpenApi(app)

    expect(outcome.discarded).toEqual([])
    expect(discardWarning()).toBe('')
  })
  /**
   * Two collisions are listed as a readable series, not run together.
   *
   * A single-entry assertion never exercises the separator, so the line could
   * join them with nothing and still satisfy every other test here.
   */
  it('separates the collisions it lists', async () => {
    process.env['NODE_ENV'] = 'test'
    app = await bootApp(
      {
        openapi: {
          enabled: true,
          securitySchemes: {
            cookieAuth: { type: 'apiKey', in: 'cookie', name: 'access_token' },
            scheme0: { type: 'apiKey', in: 'cookie', name: 'c0' }
          }
        }
      },
      [ExampleController],
      [CollidingOpenApi, TenCollisionsOpenApi]
    )

    await applyBymaxOpenApi(app)

    expect(discardWarning()).toContain(
      'CollidingOpenApi -> securitySchemes.cookieAuth, TenCollisionsOpenApi -> ' +
        'securitySchemes.scheme0'
    )
  })

  /**
   * Exactly at the cap the line lists everything and counts nothing.
   *
   * The boundary is where an off-by-one hides: a rule that elided at `>= 0`
   * rather than `> 0` appends "and 0 more" here and nowhere else, and every
   * test either side of the cap stays green.
   */
  it('counts no remainder when the collisions exactly fill the listing', async () => {
    process.env['NODE_ENV'] = 'test'
    app = await bootApp(
      { openapi: { enabled: true, securitySchemes: TEN_SCHEMES } },
      [ExampleController],
      [TenCollisionsOpenApi]
    )

    const outcome = await applyBymaxOpenApi(app)

    expect(outcome.discarded).toHaveLength(10)
    expect(discardWarning()).not.toContain('more')
  })
})
