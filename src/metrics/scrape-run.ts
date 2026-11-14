/**
 * @fileoverview `ScrapeRun`: one metrics collection in flight at a time, with a deadline.
 * @layer Utility
 */
import { ServiceUnavailableException } from '@nestjs/common'

interface Run {
  readonly settled: Promise<string>
  readonly expiry: Promise<never>
}

function unavailable(): ServiceUnavailableException {
  return new ServiceUnavailableException('Metrics collection timed out')
}

/** One collection in flight at a time, shared by concurrent scrapes, with a deadline on the wait. */
export class ScrapeRun {
  private current: Run | undefined

  constructor(
    private readonly deadlineMs: number,
    private readonly onExpired: () => void
  ) {}

  /** The text of the shared collection, or `503` once it is past its deadline. */
  async run(collect: () => Promise<string>): Promise<string> {
    const run = this.current ?? this.start(collect)
    return Promise.race([run.settled, run.expiry])
  }

  private start(collect: () => Promise<string>): Run {
    const settled = Promise.resolve().then(collect)
    let timer: ReturnType<typeof setTimeout> | undefined
    const expiry = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        this.onExpired()
        reject(unavailable())
      }, this.deadlineMs)
      timer.unref()
    })
    // A rejection nobody is racing any more is not an unhandled one.
    expiry.catch(() => undefined)
    const run: Run = { settled, expiry }
    const end = (): void => {
      clearTimeout(timer)
      this.current = undefined
    }
    settled.then(end, end)
    this.current = run
    return run
  }
}
