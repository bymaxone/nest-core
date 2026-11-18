/**
 * @fileoverview `BymaxShutdownDeadline`: when the application starts to shut down, starts a timer
 * that ends the process with a non-zero code if the shutdown has not finished by then.
 * @layer Utility
 */
import { Inject, Injectable, Logger } from '@nestjs/common'
import type {
  BeforeApplicationShutdown,
  OnApplicationBootstrap,
  OnApplicationShutdown,
  OnModuleDestroy
} from '@nestjs/common'

import type { ResolvedCoreOptions } from '../core.options'
import { BYMAX_CORE_OPTIONS } from '../core.tokens'

/** The signals that arm the deadline ahead of the hooks; any other signal is left to the hooks. */
const SIGNALS: readonly NodeJS.Signals[] = ['SIGTERM', 'SIGINT']

/**
 * Enforces `shutdown.deadlineMs`; does nothing when it is unset.
 *
 * Nest runs every `onModuleDestroy`, then every `beforeApplicationShutdown`, then every
 * `onApplicationShutdown`, and within a phase the root module's providers first and a global module,
 * as this one is by default, last. No hook of this module can therefore be first, so the deadline is
 * armed by the first of the three it has to run, and, where the application already handles a signal,
 * by the signal itself, ahead of every hook.
 */
@Injectable()
export class BymaxShutdownDeadline
  implements
    OnApplicationBootstrap,
    OnModuleDestroy,
    BeforeApplicationShutdown,
    OnApplicationShutdown
{
  private readonly logger = new Logger(BymaxShutdownDeadline.name)

  private armed = false

  private readonly onSignal = (): void => this.arm()

  constructor(@Inject(BYMAX_CORE_OPTIONS) private readonly options: ResolvedCoreOptions) {}

  /**
   * Arm on a signal that something already handles. A signal nothing handles keeps Node's default of
   * ending the process, which a listener added here would remove, so it is left alone.
   */
  onApplicationBootstrap(): void {
    if (this.options.shutdown.deadlineMs === undefined) return
    for (const signal of SIGNALS) {
      if (process.listenerCount(signal) > 0) process.prependListener(signal, this.onSignal)
    }
  }

  onModuleDestroy(): void {
    this.arm()
  }

  beforeApplicationShutdown(): void {
    this.arm()
  }

  onApplicationShutdown(): void {
    this.arm()
    for (const signal of SIGNALS) process.removeListener(signal, this.onSignal)
  }

  /**
   * Start the deadline, once. The timer does not keep the process alive, so a shutdown that finishes
   * lets the process end on its own and the deadline never fires; a handle nothing closes keeps the
   * process alive, and the deadline then ends it.
   */
  private arm(): void {
    const { deadlineMs } = this.options.shutdown
    if (deadlineMs === undefined || this.armed) return
    this.armed = true
    setTimeout(() => {
      this.logger.error({
        event: 'CORE_SHUTDOWN_DEADLINE',
        message:
          'Shutdown did not finish in time; exiting with code 1. Something still holds the process open.',
        deadlineMs
      })
      process.exit(1)
    }, deadlineMs).unref()
  }
}
