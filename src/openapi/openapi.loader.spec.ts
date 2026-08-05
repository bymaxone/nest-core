/**
 * Unit tests for the lazy `@nestjs/swagger` loader.
 *
 * Layer: unit.
 * Goal: prove the loader resolves the real peer when it is installed, and that
 * an absent peer fails fast with a message naming the package and the install
 * command while a failure originating inside the peer propagates unchanged.
 * Mocks: `jest.doMock('@nestjs/swagger')` throwing, to simulate both an absent
 * peer and a peer that fails for its own reasons.
 */
import { loadSwagger } from './openapi.loader'

describe('loadSwagger, absent optional peer', () => {
  afterEach(() => {
    jest.dontMock('@nestjs/swagger')
    jest.resetModules()
  })

  /**
   * Fail fast, descriptively, at load time.
   *
   * With `@nestjs/swagger` unresolvable, the loader must reject with an error
   * naming the missing package and the exact install command, so enabling the
   * feature without the peer fails legibly during bootstrap rather than
   * cryptically once the application is serving traffic.
   */
  it('rejects with a descriptive error naming the package and install command', async () => {
    jest.resetModules()
    jest.doMock('@nestjs/swagger', () => {
      const error: NodeJS.ErrnoException = new Error('Cannot find module @nestjs/swagger')
      error.code = 'MODULE_NOT_FOUND'
      throw error
    })
    const { loadSwagger: load } = require('./openapi.loader') as typeof import('./openapi.loader')

    // The whole message: it must name the option that turned the feature on as
    // well as the package, or an operator running several optional features
    // cannot tell which switch produced the failure.
    await expect(load()).rejects.toThrow(
      'openapi.enabled is true but the optional peer @nestjs/swagger is not installed. Run: pnpm add @nestjs/swagger'
    )
  })

  /**
   * Preserve the underlying resolution failure.
   *
   * The descriptive boot error must chain the original module-not-found error
   * as its `cause`, so operators can still see the root resolution failure.
   */
  it('chains the original failure as the error cause', async () => {
    jest.resetModules()
    jest.doMock('@nestjs/swagger', () => {
      const error: NodeJS.ErrnoException = new Error('Cannot find module @nestjs/swagger')
      error.code = 'ERR_MODULE_NOT_FOUND'
      throw error
    })
    const { loadSwagger: load } = require('./openapi.loader') as typeof import('./openapi.loader')

    await expect(load()).rejects.toMatchObject({
      cause: expect.objectContaining({ message: 'Cannot find module @nestjs/swagger' })
    })
  })

  /**
   * Non-resolution failures are not masked.
   *
   * A failure that is not a module-not-found error must propagate unchanged, so
   * it is not misreported as the peer being uninstalled and the real defect
   * stays visible.
   */
  it('rethrows a non-module-not-found failure unchanged', async () => {
    jest.resetModules()
    jest.doMock('@nestjs/swagger', () => {
      throw new Error('boom: internal swagger failure')
    })
    const { loadSwagger: load } = require('./openapi.loader') as typeof import('./openapi.loader')

    await expect(load()).rejects.toThrow(/boom: internal swagger failure/)
    await expect(load()).rejects.not.toThrow(/is not installed/)
  })
})

describe('loadSwagger, present optional peer', () => {
  /**
   * Resolve the real module when installed.
   *
   * With the peer available, the loader must expose the two entry points the
   * bootstrap helper uses, confirming the structural surface matches the real
   * module rather than only compiling against it.
   */
  it('resolves the module exposing DocumentBuilder and SwaggerModule', async () => {
    const swagger = await loadSwagger()

    expect(typeof swagger.DocumentBuilder).toBe('function')
    expect(typeof swagger.SwaggerModule.createDocument).toBe('function')
    expect(typeof swagger.SwaggerModule.setup).toBe('function')
  })
})
