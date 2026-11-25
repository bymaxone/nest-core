/**
 * @fileoverview What the decorator and the interceptor share: the metadata key an idempotent route carries
 * and the refusal of handlers whose answer cannot be stored and replayed.
 * @layer Utility
 */

/** The metadata key under which `@Idempotent` stores a route's resolved options. */
export const IDEMPOTENT_OPTIONS = Symbol.for('@bymax-one/nest-core:idempotent-options')

/** Nest's metadata keys, read as strings so no framework internals are imported. */
const ROUTE_ARGUMENTS = '__routeArguments__'
const RESPONSE_PASSTHROUGH = '__responsePassthrough__'
const SSE = '__sse__'
const RENDER = '__renderTemplate__'

/** A built-in parameter key, `type:index`; a custom decorator's key starts with a random id instead. */
const BUILT_IN_ARGUMENT = /^\d+:\d+$/

/** `@Res`, `@Next`, `@UploadedFile`, `@UploadedFiles` and `@RawBody`, by Nest's parameter type. */
const REFUSED_PARAMETERS: ReadonlyMap<number, string> = new Map([
  [1, '@Res() without `passthrough: true`'],
  [2, '@Next()'],
  [8, '@UploadedFile()'],
  [9, '@UploadedFiles()'],
  [12, '@RawBody()']
])

/**
 * Refuse a handler whose answer or request body cannot be fingerprinted and replayed whole: one that
 * writes its own response, is `@Sse`, or takes an uploaded file or a raw body.
 *
 * @param controller - The controller class.
 * @param name - The handler's method name.
 * @param handler - The handler function.
 * @throws Error Naming the unsupported feature.
 */
export function assertSupportedHandler(
  controller: object,
  name: string | symbol,
  handler: object
): void {
  if (Reflect.getMetadata(SSE, handler) === true) {
    throw new Error('@Idempotent does not support an @Sse() handler: a stream cannot be replayed')
  }
  if (Reflect.getMetadata(RENDER, handler) !== undefined) {
    throw new Error('@Idempotent does not support @Render(): a rendered view cannot be replayed')
  }
  const used = Reflect.getMetadata(ROUTE_ARGUMENTS, controller, name) as
    Readonly<Record<string, unknown>> | undefined
  const passthrough = Reflect.getMetadata(RESPONSE_PASSTHROUGH, controller, name) === true
  for (const argument of Object.keys(used ?? {})) {
    if (!BUILT_IN_ARGUMENT.test(argument)) continue
    const type = Number.parseInt(argument, 10)
    const refused = REFUSED_PARAMETERS.get(type)
    if (refused !== undefined && !(passthrough && type === 1)) {
      throw new Error(`@Idempotent does not support ${refused}: the answer cannot be stored whole`)
    }
  }
}
