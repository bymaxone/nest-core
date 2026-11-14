/**
 * @fileoverview `ScrapeRun`: one metrics collection in flight at a time, with a deadline.
 * @layer Utility
 */
import { ServiceUnavailableException } from '@nestjs/common'

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
    const settled = Promise.resolve().then(collect)
    let timer: ReturnType<typeof setTimeout> | undefined
    const expiry = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        this.onExpired()
        reject(unavailable())
      }, this.deadlineMs)
      timer.unref()
    })
    const outcome = Promise.race([settled, expiry])
    // A rejection nobody is awaiting is not an unhandled one.
    outcome.catch(() => undefined)
    const end = (): void => {
      clearTimeout(timer)
      this.current = undefined
    }
    settled.then(end, end)
    this.current = outcome
    return outcome
  }
}
