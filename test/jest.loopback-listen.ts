/**
 * Binds every port-only `listen` of the end-to-end suite to the IPv4 loopback address, and makes
 * supertest wait for a listener it starts itself.
 *
 * Layer: e2e support, loaded through `setupFiles` in `jest.e2e.config.ts`.
 *
 * The reasoning, the patches and their limits are in `test/support/loopback-listen.ts`.
 */
import { installLoopbackListen, installSupertestWait } from './support/loopback-listen'

installLoopbackListen()
installSupertestWait()
