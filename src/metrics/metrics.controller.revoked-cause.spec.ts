/**
 * Tests for a scrape whose collector rejects with a value that cannot be inspected.
 *
 * Layer: unit.
 * Goal: a collector that rejects with a revoked proxy is answered with the collection-failed `503`,
 * never with the `TypeError` its inspection throws, and the guard's own test says `false` for it.
 * Mocks: a registry stub whose collection rejects, and `HttpAdapterHost`.
 */
import { ServiceUnavailableException } from '@nestjs/common'
import type { HttpAdapterHost } from '@nestjs/core'

import { normalizeCoreOptions } from '../core.options'
import { isGuardRefusal } from '../object-prototype'
import { createMetricsController } from './metrics.controller'
import type { MetricsRegistry } from './metrics.registry'

/** A proxy whose every reflective operation throws. */
function revoked(): object {
  const { proxy, revoke } = Proxy.revocable({}, {})
  revoke()
  return proxy
}

describe('a collector that rejects with a value that cannot be inspected', () => {
  it('is answered with the collection-failed 503', async () => {
    const rejection = revoked()
    const registry = {
      metrics: () => Promise.reject(rejection),
      contentType: 'text/plain'
    } as unknown as MetricsRegistry
    const adapterHost = {
      httpAdapter: { setHeader: () => undefined, reply: () => undefined }
    } as unknown as HttpAdapterHost
    const Controller = createMetricsController('metrics')
    const instance = new Controller(
      registry,
      normalizeCoreOptions({ metrics: { enabled: true, path: 'metrics' } }),
      adapterHost
    ) as unknown as { scrape(response: unknown, request: object): Promise<void> }

    const error: unknown = await instance.scrape({}, {}).catch((thrown: unknown) => thrown)

    expect(error).toBeInstanceOf(ServiceUnavailableException)
    expect((error as ServiceUnavailableException).message).toBe('Metrics collection failed')
    expect((error as ServiceUnavailableException).cause).toBe(rejection)
  })

  it('is not the guard refusal', () => {
    expect(isGuardRefusal(revoked())).toBe(false)
  })
})
