/**
 * Unit tests for the options `@nestjs/swagger` is handed, with a name planted on `Object.prototype`.
 *
 * Layer: unit.
 * Goal: a name the peer reads that this package did not set (`ui`, `raw`, `yamlDocumentUrl`, `customJs`,
 * ...) is not answered by something planted on the root of all objects, so the served pages and
 * documents are the ones of an unplanted run.
 * Mocks: none; the real `@nestjs/swagger` runs against a real Nest application.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

import request from 'supertest'

import { applyBymaxOpenApi } from './openapi.bootstrap'
import { bootApp, ExampleController } from './__tests__/bootstrap.harness'

/** What boot says when a name the peer reads from its own instances is planted. */
const REFUSED = 'Object.prototype holds a name the OpenAPI peer reads from its own instances'

/** The paths the peer serves, and one a planted `yamlDocumentUrl` would add. */
const PATHS = [
  '/docs',
  '/docs-json',
  '/docs-yaml',
  '/planted-route',
  '/docs/swagger-ui-init.js',
  '/docs/swagger-ui-bundle.js'
]

/** What each path answers: its status, its text, and whether the text holds what was planted. */
async function served(): Promise<string> {
  const app = await bootApp({ openapi: { enabled: true } } as never, [ExampleController])
  await applyBymaxOpenApi(app)
  await app.init()
  const out: string[] = []
  for (const path of PATHS) {
    const answer = await request(app.getHttpServer()).get(path)
    out.push(`${path} ${answer.status} ${answer.text.replace(/"timestamp":"[^"]*"/, '')}`)
  }
  await app.close()
  return out.join('\n')
}

/** The generated document, as text. */
async function document(options: object = { openapi: { enabled: true } }): Promise<string> {
  const app = await bootApp(options as never, [ExampleController])
  await applyBymaxOpenApi(app)
  await app.init()
  const answer = await request(app.getHttpServer()).get('/docs-json')
  await app.close()
  return JSON.stringify(answer.body)
}

/** `value` planted under `name` while `run` executes. */
async function planted<T>(name: string, value: unknown, run: () => Promise<T>): Promise<T> {
  Object.defineProperty(Object.prototype, name, { value, configurable: true, writable: true })
  try {
    return await run()
  } finally {
    delete (Object.prototype as Record<string, unknown>)[name]
  }
}

describe('a name planted on Object.prototype under the options of the swagger peer', () => {
  it.each([
    ['ui', false],
    ['swaggerUiEnabled', false],
    ['raw', false],
    ['yamlDocumentUrl', '/planted-route'],
    ['customSwaggerUiPath', '/planted-route'],
    ['swaggerOptions', { customJs: 'http://planted.example/x.js' }],
    ['customCss', 'body{planted:1}'],
    ['customCssUrl', 'http://planted.example/x.css'],
    ['customJs', 'http://planted.example/x.js'],
    ['customJsStr', 'planted()'],
    ['customSiteTitle', 'planted title'],
    ['customfavIcon', 'http://planted.example/icon.png'],
    ['useGlobalPrefix', true],
    ['operationIdFactory', 'planted']
  ])('does not change what is served when %s is planted', async (name, value) => {
    const baseline = await served()

    expect(await planted(name, value, served)).toBe(baseline)
  })

  it.each(['explorer', 'schemas', 'webhookPaths', 'root', 'properties', 'format'])(
    'refuses to boot when %s, read from the peer instances, is planted',
    async (name) => {
      const app = await bootApp({ openapi: { enabled: true } } as never, [ExampleController])

      await expect(planted(name, 'x', () => applyBymaxOpenApi(app))).rejects.toMatchObject({
        message: REFUSED,
        name
      })
      await app.close()
    }
  )

  it('serves the same document whichever name the peer instances read is planted, or refuses to boot', async () => {
    const dist = join(dirname(createRequire(__filename).resolve('@nestjs/swagger')))
    const read = new Set<string>()
    for (const file of ['swagger-module.js', 'swagger-scanner.js', 'swagger-explorer.js']) {
      for (const found of readFileSync(join(dist, file), 'utf8').matchAll(/this\.([A-Za-z_]+)/g)) {
        read.add(found[1] as string)
      }
    }
    const baseline = await document()
    const changed: string[] = []

    for (const name of read) {
      let answer: string
      try {
        answer = await planted(name, 'x', document)
      } catch (error) {
        if ((error as Error).message !== REFUSED) changed.push(name)
        continue
      }
      if (answer !== baseline) changed.push(name)
    }

    expect(read.size).toBeGreaterThan(30)
    expect(changed).toEqual([])
  }, 120_000)

  it.each([
    ['security', []],
    ['security', [{ planted: [] }]],
    ['securitySchemes', { planted: { type: 'http', scheme: 'basic' } }],
    ['securitySchemes', {}],
    ['content', {}],
    ['$ref', '#/components/schemas/Planted'],
    ['description', 'planted description'],
    ['description', '']
  ])('serves the document it was configured with when %s is planted as %j', async (name, value) => {
    const configured = {
      openapi: {
        enabled: true,
        securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } },
        security: [{ bearer: [] }],
        operationSecurity: { 'GET /examples': [{ bearer: ['read'] }] }
      },
      metrics: { enabled: true, authToken: 'configured' }
    }
    const baseline = await document(configured)

    expect(baseline).toContain('"bearer"')
    expect(await planted(name, value, () => document(configured))).toBe(baseline)
  })
})
