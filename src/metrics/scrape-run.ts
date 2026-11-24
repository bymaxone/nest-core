/**
 * @fileoverview `ScrapeRun`: one metrics collection in flight at a time, with a deadline.
 * @layer Utility
 */
import { ServiceUnavailableException } from '@nestjs/common'

import { ignoreRejection, settleFirst } from '../settle'

function unavailable(): ServiceUnavailableException {
  return new ServiceUnavailableException('Metrics collection timed out')
}

/** One collection in flight at a time, shared by concurrent scrapes, with a deadline on the wait. */
export class ScrapeRun {
  private current: Promise<string> | undefined

  constructor(
    private readonly deadlineMs: number,
    private readonly onExpired: () => void
  ) {}

  /**
   * The text of the shared collection, or `503` once it is past its deadline. Every scrape gets the
   * same promise: racing per scrape would leave one more reaction on a collection that never settles.
   */
  run(collect: () => Promise<string>): Promise<string> {
    return this.current ?? this.start(collect)
  }

  private start(collect: () => Promise<string>): Promise<string> {
    const outcome = settleFirst<string>(collect, (_win, lose) => {
      const timer = setTimeout(() => {
        this.onExpired()
        lose(unavailable())
      }, this.deadlineMs)
      timer.unref()
      return (): void => {
        clearTimeout(timer)
        this.current = undefined
      }
    })
    // A rejection nobody is awaiting is not an unhandled one.
    ignoreRejection(outcome)
    this.current = outcome
    return outcome
  }
}
