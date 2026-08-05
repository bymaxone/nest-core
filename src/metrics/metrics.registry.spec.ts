/**
 * Unit tests for the lazy `prom-client` registry factory.
 *
 * Layer: unit.
 * Goal: prove the factory loads `prom-client` lazily and returns a dedicated
 * registry; that `defaultLabels` flow onto scraped output; that
 * `collectDefaultMetrics` is invoked against the registry only when opted in;
 * and that enabling metrics without the optional peer fails fast with a
 * descriptive boot error naming the package and the install command.
 * Mocks: `jest.doMock('prom-client')` throwing to simulate the absent peer; the
 * `collectDefaultMetrics` toggle is asserted through the registry's registered
 * metric set rather than a spy, since the module namespace export is read-only.
 */
import { normalizeCoreOptions } from '../core.options'
import type { ResolvedCoreOptions } from '../core.options'
import { createMetricsRegistry, loadPromClient } from './metrics.registry'

/** Build resolved options with an enabled metrics block plus the given overrides. */
function enabledMetrics(
  overrides: Partial<ResolvedCoreOptions['metrics']> = {}
): ResolvedCoreOptions {
  return normalizeCoreOptions({
    metrics: { enabled: true, collectDefaultMetrics: false, ...overrides }
  })
}

describe('createMetricsRegistry', () => {
  /**
   * Default labels reach scraped output.
   *
   * A resolved `defaultLabels` map must be applied to the registry so every
   * emitted metric carries the static labels; a manual counter is scraped to
   * observe the label without depending on process metrics.
   */
  it('applies defaultLabels to every metric on scraped output', async () => {
    const registry = await createMetricsRegistry(enabledMetrics({ defaultLabels: { app: 'svc' } }))
    const promClient = await import('prom-client')
    new promClient.Counter({ name: 'probe_total', help: 'probe', registers: [registry] }).inc()

    const text = await registry.metrics()

    expect(text).toContain('app="svc"')
  })

  /**
   * Opt-in process metrics.
   *
   * When `collectDefaultMetrics` is true, the factory must register the
   * process collectors against the created registry, so a scrape exposes the
   * standard `process_*` and `nodejs_*` series.
   */
  it('registers default process metrics against the registry when enabled', async () => {
    const registry = await createMetricsRegistry(enabledMetrics({ collectDefaultMetrics: true }))

    const registered = registry.getMetricsAsArray().map((metric) => metric.name)

    expect(registered).toContain('process_cpu_seconds_total')
  })

  /**
   * Process metrics stay off unless opted in.
   *
   * When `collectDefaultMetrics` is false, no collector runs, so a consumer who
   * wants only their own metrics starts from an empty registry and pays nothing
   * for process metrics.
   */
  it('leaves the registry empty of default metrics when disabled', async () => {
    const registry = await createMetricsRegistry(enabledMetrics({ collectDefaultMetrics: false }))

    expect(registry.getMetricsAsArray()).toHaveLength(0)
  })
})

describe('loadPromClient, absent optional peer', () => {
  afterEach(() => {
    jest.dontMock('prom-client')
    jest.resetModules()
  })

  /**
   * Fail fast, descriptively, at load time.
   *
   * With `prom-client` unresolvable, the lazy loader must reject with an error
   * naming the missing package and the exact install command, so enabling
   * metrics without the peer fails legibly at boot rather than cryptically at
   * the first scrape.
   */
  it('rejects with a descriptive error naming the package and install command', async () => {
    jest.resetModules()
    jest.doMock('prom-client', () => {
      const error = new Error('Cannot find module prom-client')
      ;(error as NodeJS.ErrnoException).code = 'MODULE_NOT_FOUND'
      throw error
    })
    const { loadPromClient: load } =
      require('./metrics.registry') as typeof import('./metrics.registry')

    // The whole message: it must name the option that turned the feature on as
    // well as the package, or an operator running several optional features
    // cannot tell which switch produced the failure.
    await expect(load()).rejects.toThrow(
      'metrics.enabled is true but the optional peer prom-client is not installed. Run: pnpm add prom-client'
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
    jest.doMock('prom-client', () => {
      const error = new Error('Cannot find module prom-client')
      ;(error as NodeJS.ErrnoException).code = 'ERR_MODULE_NOT_FOUND'
      throw error
    })
    const { loadPromClient: load } =
      require('./metrics.registry') as typeof import('./metrics.registry')

    await expect(load()).rejects.toMatchObject({
      cause: expect.objectContaining({ message: 'Cannot find module prom-client' })
    })
  })

  /**
   * Non-resolution failures are not masked.
   *
   * A failure that is not a module-not-found error (a syntax or runtime error
   * inside the peer, a broken transitive dependency) must propagate unchanged,
   * so it is not misreported as the peer being uninstalled.
   */
  it('rethrows a non-module-not-found failure unchanged', async () => {
    jest.resetModules()
    jest.doMock('prom-client', () => {
      throw new Error('boom: internal prom-client failure')
    })
    const { loadPromClient: load } =
      require('./metrics.registry') as typeof import('./metrics.registry')

    await expect(load()).rejects.toThrow(/boom: internal prom-client failure/)
    await expect(load()).rejects.not.toThrow(/prom-client is not installed/)
  })
})

describe('loadPromClient, present optional peer', () => {
  /**
   * Resolve the real module when installed.
   *
   * With `prom-client` available, the loader resolves the module exposing its
   * `Registry` constructor, confirming the happy path used by the factory.
   */
  it('resolves the prom-client module exposing Registry', async () => {
    const promClient = await loadPromClient()

    expect(typeof promClient.Registry).toBe('function')
  })
})
