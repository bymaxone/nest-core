/**
 * @fileoverview Correlation-id contract consumed by the error envelope. The
 * filter resolves this provider to stamp the current request's correlation id
 * onto every error response. The default binding is a no-op; any implementation
 * (for example the AsyncLocalStorage-based log context of `@bymax-one/nest-logger`)
 * plugs in through the `BYMAX_CORRELATION_PROVIDER` token with no hard coupling.
 * @layer Contract
 */

/**
 * Resolve the correlation id for the current execution context.
 */
export interface ICorrelationIdProvider {
  /**
   * Return the correlation id for the current execution context.
   *
   * @returns The correlation id, or `undefined` when none is bound.
   */
  getCorrelationId(): string | undefined
}
