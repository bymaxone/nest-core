/**
 * @fileoverview The default route prefixes for the endpoints this package
 * registers, alone in a module of their own.
 *
 * They were declared beside the option resolver, which reads naturally until a
 * second published entry needs one. This package builds one bundle per subpath
 * with the shared modules inlined into each, so importing a single constant
 * from `core.options` pulls in whatever the bundler cannot prove unused — and
 * it cannot prove much there, since that module evaluates
 * `normalizeCoreOptions()` at load time to publish its frozen defaults. The
 * measured cost was the entire resolver, deep-freeze and all, inlined into the
 * `./openapi` bundle for two strings.
 *
 * A leaf module with no imports of its own cannot do that to anyone. Anything
 * both the resolver and a subpath needs belongs here rather than there.
 * @layer Constants
 */

/**
 * Default health route prefix. The health controller mounts at `/health/live`
 * and `/health/ready` under it, and the asynchronous registration path always
 * uses it, since route metadata is fixed before the options resolve.
 */
export const DEFAULT_HEALTH_PATH = 'health'

/** Default route the Prometheus scrape endpoint is served from. */
export const DEFAULT_METRICS_PATH = 'metrics'
