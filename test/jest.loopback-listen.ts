/**
 * Binds every port-only `listen` of the test suites to the IPv4 loopback address.
 *
 * Layer: test support, loaded through `setupFiles` in `jest.config.ts`, `jest.e2e.config.ts` and
 * `jest.coverage.config.ts`, so every spec runs under it.
 *
 * The reasoning, the patch and its limits are in `test/support/loopback-listen.ts`.
 */
import { installLoopbackListen } from './support/loopback-listen'

installLoopbackListen()
