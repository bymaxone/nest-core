/**
 * @fileoverview Resolution of the OpenAPI options: the defaults, the production guard, and the shape
 * checks that make a malformed declaration fail at boot instead of when the document is first built,
 * which only happens in an environment that has the document switched on.
 * @layer Configuration
 */
import type {
  OpenApiOptions,
  OpenApiServerDescriptor,
  OpenApiSecurityRequirement,
  ResolvedOpenApiOptions
} from './core.options'
import {
  booleanOption,
  checkedBlock,
  refusal,
  routeOption,
  stringOption
} from './option-validation'
import { isProductionRuntime, runtimeEnvironmentName } from './runtime.environment'

/** The options of {@link OpenApiOptions}; the compiler keeps this table complete. */
const OPENAPI_KEYS = {
  enabled: 0,
  path: 0,
  jsonPath: 0,
  title: 0,
  description: 0,
  version: 0,
  servers: 0,
  securitySchemes: 0,
  security: 0,
  operationSecurity: 0,
  operationIdFactory: 0,
  includeCoreSchemas: 0
} satisfies Record<keyof OpenApiOptions, 0>

/** The options of a server entry. */
const SERVER_KEYS = { url: 0, description: 0 } satisfies Record<keyof OpenApiServerDescriptor, 0>

/** The scheme types the OpenAPI specification defines. */
const SCHEME_TYPES = ['apiKey', 'http', 'oauth2', 'openIdConnect', 'mutualTLS']

/** Where an API key may be carried. */
const KEY_LOCATIONS = ['header', 'query', 'cookie']

/** An operation key: an upper-case method, one space, and a path that starts with a slash. */
const OPERATION_KEY = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|TRACE) \/\S*$/

/** A record that is not an array, or throws. */
function recordOf(name: string, value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw refusal(name, 'an object', value)
  }
  return value as Record<string, unknown>
}

/** A list, or throws. */
function listOf(name: string, value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) throw refusal(name, 'an array', value)
  return Array.from(value as readonly unknown[])
}

/** Throws unless `value` is one of `allowed`. */
function oneOf(name: string, value: unknown, allowed: readonly string[]): void {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw refusal(name, `one of ${allowed.join(', ')}`, value)
  }
}

/** Throws unless a security scheme has a type of the specification and the fields that type needs. */
function assertScheme(name: string, scheme: unknown): void {
  const fields = recordOf(name, scheme)
  oneOf(`${name}.type`, fields['type'], SCHEME_TYPES)
  if (
    fields['type'] === 'http' &&
    (typeof fields['scheme'] !== 'string' || fields['scheme'] === '')
  ) {
    throw refusal(`${name}.scheme`, 'a non-empty string', fields['scheme'])
  }
  if (fields['type'] === 'apiKey') {
    oneOf(`${name}.in`, fields['in'], KEY_LOCATIONS)
    if (typeof fields['name'] !== 'string' || fields['name'] === '') {
      throw refusal(`${name}.name`, 'a non-empty string', fields['name'])
    }
  }
}

/** Throws unless a requirement maps scheme names to lists of scope strings. */
function assertRequirement(name: string, requirement: unknown): void {
  for (const [scheme, scopes] of Object.entries(recordOf(name, requirement))) {
    const scopeName = `${name}.${scheme}`
    if (
      !Array.isArray(scopes) ||
      Array.from(scopes as unknown[]).some((s) => typeof s !== 'string')
    ) {
      throw refusal(scopeName, 'a list of strings', scopes)
    }
  }
}

/** Throws unless `value` is a list of requirements. */
function assertRequirements(name: string, value: unknown): void {
  listOf(name, value).forEach((requirement, index) => {
    assertRequirement(`${name}[${index}]`, requirement)
  })
}

/** Throws unless every server has a non-empty `url` and, if set, a string `description`. */
function assertServers(servers: readonly unknown[]): void {
  servers.forEach((server, index) => {
    const name = `openapi.servers[${index}]`
    const entry = checkedBlock<OpenApiServerDescriptor>(name, server, SERVER_KEYS)
    if (entry === undefined) throw refusal(name, 'an object', server)
    if (typeof entry.url !== 'string' || entry.url === '') {
      throw refusal(`${name}.url`, 'a non-empty string', entry.url)
    }
    stringOption(`${name}.description`, entry.description, undefined)
  })
}

/** Throws on a declaration the document could not be built from. */
function assertDeclarations(raw: OpenApiOptions | undefined): void {
  if (raw === undefined) return
  if (raw.servers !== undefined && raw.servers !== null) {
    assertServers(listOf('openapi.servers', raw.servers))
  }
  if (raw.securitySchemes !== undefined && raw.securitySchemes !== null) {
    for (const [scheme, declared] of Object.entries(
      recordOf('openapi.securitySchemes', raw.securitySchemes)
    )) {
      assertScheme(`openapi.securitySchemes.${scheme}`, declared)
    }
  }
  if (raw.security !== undefined && raw.security !== null) {
    assertRequirements('openapi.security', raw.security)
  }
  if (raw.operationSecurity !== undefined && raw.operationSecurity !== null) {
    const entries = Object.entries(recordOf('openapi.operationSecurity', raw.operationSecurity))
    entries.forEach(([key, requirements], index) => {
      if (!OPERATION_KEY.test(key)) {
        throw new Error(
          `openapi.operationSecurity key number ${index + 1} must be "<METHOD> /path" with an upper-case method`
        )
      }
      assertRequirements(`openapi.operationSecurity entry ${index + 1}`, requirements)
    })
  }
  const factory = raw.operationIdFactory as unknown
  if (factory !== undefined && factory !== null && typeof factory !== 'function') {
    throw refusal('openapi.operationIdFactory', 'a function', factory)
  }
}

/** The consumer's servers as objects this module owns, an absent description staying absent. */
function cloneServers(
  raw?: readonly OpenApiServerDescriptor[] | null
): readonly OpenApiServerDescriptor[] {
  return (raw ?? []).map((server) =>
    server.description === undefined || server.description === null
      ? { url: server.url }
      : { url: server.url, description: server.description }
  )
}

/**
 * Resolve OpenAPI options against their defaults, then intersect the consumer's request with the
 * runtime: in production the feature is off no matter what was asked for, and the refusal is
 * recorded rather than silently applied. This is the first of the two independent production
 * guards; the second lives in the bootstrap helper, which never trusts this one.
 *
 * @param given - The consumer OpenAPI block, if any.
 * @param declaredEnvironment - The environment the application declared, used only where
 *   `NODE_ENV` declares nothing. See `runtimeEnvironmentName`.
 * @returns The fully-populated OpenAPI options.
 * @throws Error When a value has the wrong type, the block has an option it does not document, or a
 *   server, security scheme, requirement or operation key is malformed.
 */
export function resolveOpenApi(
  given: unknown,
  declaredEnvironment?: string
): ResolvedOpenApiOptions {
  const raw = checkedBlock<OpenApiOptions>('openapi', given, OPENAPI_KEYS)
  assertDeclarations(raw)
  const requested = booleanOption('openapi.enabled', raw?.enabled, false)
  const production = isProductionRuntime(runtimeEnvironmentName(declaredEnvironment))
  const factory = raw?.operationIdFactory
  return {
    enabled: requested && !production,
    suppressedInProduction: requested && production,
    path: routeOption('openapi.path', raw?.path, 'docs'),
    jsonPath: routeOption('openapi.jsonPath', raw?.jsonPath, 'docs-json'),
    title: stringOption('openapi.title', raw?.title, 'API'),
    description: stringOption('openapi.description', raw?.description, ''),
    version: stringOption('openapi.version', raw?.version, '1.0.0'),
    servers: cloneServers(raw?.servers),
    // Structured-cloned rather than shallow-copied: the values are consumer-owned nested objects,
    // and the deep-freeze applied to the snapshot would otherwise reach into them.
    securitySchemes: structuredClone(raw?.securitySchemes ?? {}),
    security: structuredClone<readonly OpenApiSecurityRequirement[]>(raw?.security ?? []),
    operationSecurity: structuredClone(raw?.operationSecurity ?? {}),
    // Carried by reference: it is a function the consumer owns, which `structuredClone` cannot copy.
    ...(factory === undefined || factory === null ? {} : { operationIdFactory: factory }),
    includeCoreSchemas: booleanOption('openapi.includeCoreSchemas', raw?.includeCoreSchemas, true)
  }
}
