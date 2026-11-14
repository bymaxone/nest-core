/**
 * @fileoverview `RepeatWindow`: admits the first occurrence of a key and counts the repeats inside
 * its window, so a failure that repeats on every request is reported once and then summarised.
 * @layer Utility
 */

/** How many distinct keys are tracked at once; later keys share {@link OVERFLOW_KEY}. */
const MAX_TRACKED_KEYS = 64

/** The slot every key past {@link MAX_TRACKED_KEYS} shares. */
const OVERFLOW_KEY = '*'

/** One open window. */
interface Entry<T> {
  repeats: number
  latest: T
  readonly timer: ReturnType<typeof setTimeout>
}

/** Admits the first occurrence of each key in a window and counts the rest. */
export class RepeatWindow<T> {
  private readonly entries = new Map<string, Entry<T>>()

  constructor(
    private readonly windowMs: number,
    private readonly onSummary: (latest: T, repeats: number) => void
  ) {}

  /** `true` for the first occurrence of `key` in a window, to report at once; `false` for a repeat. */
  admit(key: string, occurrence: T): boolean {
    const slot = this.entries.has(key) || this.entries.size < MAX_TRACKED_KEYS ? key : OVERFLOW_KEY
    const open = this.entries.get(slot)
    if (open !== undefined) {
      open.repeats += 1
      open.latest = occurrence
      return false
    }
    const entry: Entry<T> = {
      repeats: 0,
      latest: occurrence,
      timer: setTimeout(() => this.close(slot, entry), this.windowMs)
    }
    entry.timer.unref()
    this.entries.set(slot, entry)
    return true
  }

  /** Close every open window now, summarising those that withheld repeats. */
  flush(): void {
    for (const [slot, entry] of [...this.entries]) {
      this.close(slot, entry)
    }
  }

  private close(slot: string, entry: Entry<T>): void {
    this.entries.delete(slot)
    clearTimeout(entry.timer)
    if (entry.repeats === 0) {
      return
    }
    try {
      this.onSummary(entry.latest, entry.repeats)
    } catch {
      // From a timer: a throw would be an uncaught exception.
    }
  }
}
