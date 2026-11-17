/**
 * @fileoverview `BymaxShutdownDeadline`: when the application starts to shut down, starts a timer
 * that ends the process with a non-zero code if the shutdown has not finished by then.
 * @layer Utility
 */
import { Inject, Injectable, Logger } from '@nestjs/common'
import type { BeforeApplicationShutdown } from '@nestjs/common'

import type { ResolvedCoreOptions } from '../core.options'
import { BYMAX_CORE_OPTIONS } from '../core.tokens'

/** Enforces `shutdown.deadlineMs`; does nothing when it is unset. */
@Injectable()
export class BymaxShutdownDeadline implements BeforeApplicationShutdown {
  private readonly logger = new Logger(BymaxShutdownDeadline.name)

  constructor(@Inject(BYMAX_CORE_OPTIONS) private readonly options: ResolvedCoreOptions) {}

  /**
   * Start the deadline. The timer does not keep the process alive, so a shutdown that finishes
   * lets the process end on its own and the deadline never fires; a handle nothing closes keeps
   * the process alive, and the deadline then ends it.
   */
  beforeApplicationShutdown(): void {
    const { deadlineMs } = this.options.shutdown
    if (deadlineMs === undefined) return
    setTimeout(() => {
      this.logger.error(
        `Shutdown did not finish within ${deadlineMs}ms; exiting with code 1. Something still holds the process open.`
      )
      process.exit(1)
    }, deadlineMs).unref()
  }
}
