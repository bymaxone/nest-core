/**
 * Unit tests for the readiness transition rule owned by `HealthService`.
 *
 * Layer: unit.
 * Goal: prove the sink is called once per *change* of state per check name and
 * never once per probe; that the first observation is asymmetric (failing is
 * news, healthy is not); that each of the three down causes reaches the sink
 * distinguishably, including the timeout only the aggregator can observe; that
 * state is keyed by check name; and that a broken sink cannot fail a probe.
 * Mocks: hand-built `IHealthIndicator` and `IHealthTransitionSink` stubs
 * (family convention, no test double library), plus spies on Nest's `Logger`.
 */
import { runInNewContext } from 'node:vm'

import { Logger } from '@nestjs/common'

import { normalizeCoreOptions } from '../core.options'
import type { ResolvedCoreOptions } from '../core.options'
import type { HealthIndicatorResult, IHealthIndicator } from './health.interfaces'
import { HealthService } from './health.service'
import type { HealthTransition, IHealthTransitionSink } from './health.transition'

/**
 * A sink that keeps every transition it is handed, so a test asserts on the
 * exact sequence rather than on a call count alone.
 */
class RecordingSink implements IHealthTransitionSink {
  readonly transitions: HealthTransition[] = []

  /**
   * Keep the transition.
   *
   * @param transition - The event to record.
   */
  record(transition: HealthTransition): void {
    this.transitions.push(transition)
  }
}

/** An indicator whose result the test swaps between probes. */
class ScriptedIndicator implements IHealthIndicator {
  /**
   * @param name - The check name.
   * @param behaviour - Produces the next outcome; may resolve, reject or hang.
   */
  constructor(
    readonly name: string,
    private behaviour: () => Promise<HealthIndicatorResult>
  ) {}

  /**
   * Replace what the next check does.
   *
   * @param behaviour - The new behaviour.
   */
  setBehaviour(behaviour: () => Promise<HealthIndicatorResult>): void {
    this.behaviour = behaviour
  }

  /**
   * Run the current behaviour.
   *
   * @returns Whatever the behaviour produces.
   */
  async check(): Promise<HealthIndicatorResult> {
    return this.behaviour()
  }
}

/** Behaviour: report the dependency reachable. */
const up = (): Promise<HealthIndicatorResult> => Promise.resolve({ status: 'up' as const })

/** Behaviour: report the dependency unreachable, without rejecting. */
const down = (): Promise<HealthIndicatorResult> => Promise.resolve({ status: 'down' as const })

/**
 * Behaviour: reject.
 *
 * @param message - The rejection message.
 * @returns A behaviour that rejects with an `Error` carrying it.
 */
function rejects(message: string): () => Promise<HealthIndicatorResult> {
  return (): Promise<HealthIndicatorResult> => Promise.reject(new Error(message))
}

/**
 * Let every pending microtask and immediate settle before asserting.
 *
 * @returns A promise resolved after the current macrotask turn.
 */
function flushAsync(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve)
  })
}

/**
 * A minimal thenable, shaped like what a userland promise library returns.
 *
 * Deliberately not `PromiseLike`: the point of the test that uses it is that a
 * value carrying a rejection need not be this realm's `Promise`, nor even a
 * well-typed promise at all, for the language to assimilate it.
 */
interface RejectingThenable {
  then(onFulfilled?: unknown, onRejected?: (reason: unknown) => void): void
}

/** Behaviour: never settle, so the aggregator's bound is what resolves the check. */
const hangs = (): Promise<HealthIndicatorResult> => new Promise(() => {})

/**
 * Resolve options with a specific `indicatorTimeoutMs`, defaults otherwise.
 *
 * @param indicatorTimeoutMs - The per-indicator bound.
 * @returns The resolved snapshot.
 */
function optionsWithTimeout(indicatorTimeoutMs: number): ResolvedCoreOptions {
  return normalizeCoreOptions({ health: { indicatorTimeoutMs } })
}

/**
 * Build a service over the given indicators with a recording sink attached.
 *
 * @param indicators - The readiness set.
 * @param options - The resolved options; defaults when omitted.
 * @returns The service and the sink watching it.
 */
function serviceWithSink(
  indicators: readonly IHealthIndicator[],
  options: ResolvedCoreOptions = normalizeCoreOptions()
): { service: HealthService; sink: RecordingSink } {
  const sink = new RecordingSink()
  const service = new HealthService(indicators, options, undefined, undefined, sink)
  return { service, sink }
}

describe('HealthService readiness transitions', () => {
  let warn: jest.SpyInstance
  let log: jest.SpyInstance

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
  })

  afterEach(() => {
    warn.mockRestore()
    log.mockRestore()
  })

  /**
   * A first observation that is already failing is news.
   *
   * A process that boots against a dependency that is already down would
   * otherwise look healthy in the log forever: there is no earlier healthy state
   * for it to differ from, so a rule that only reported changes from a known
   * state would never report the outage that was there from the start.
   */
  it('reports a first observation that is failing', async () => {
    const { service, sink } = serviceWithSink([new ScriptedIndicator('redis', down)])

    await service.checkReadiness()

    expect(sink.transitions).toEqual([
      { name: 'redis', isUp: false, cause: { kind: 'reported-down' } }
    ])
  })

  /**
   * A first observation that is healthy is not news.
   *
   * It is the expected state, and announcing it would write one line per
   * dependency on every boot — exactly the noise the probe-path exclusion in a
   * consuming backend exists to keep out.
   */
  it('stays silent on a first observation that is healthy', async () => {
    const { service, sink } = serviceWithSink([new ScriptedIndicator('redis', up)])

    await service.checkReadiness()

    expect(sink.transitions).toEqual([])
    expect(warn).not.toHaveBeenCalled()
    expect(log).not.toHaveBeenCalled()
  })

  /**
   * A failure that persists is reported once, not once per probe.
   *
   * This is the whole reason the rule lives in the aggregator. A readiness check
   * runs every few seconds, so a line per failing probe turns one outage into
   * thousands of identical records that bury the one carrying the cause.
   */
  it('reports a persisting failure once across many probes', async () => {
    const { service, sink } = serviceWithSink([new ScriptedIndicator('redis', down)])

    await service.checkReadiness()
    await service.checkReadiness()
    await service.checkReadiness()

    expect(sink.transitions).toHaveLength(1)
  })

  /**
   * Recovery is reported once, and only once.
   *
   * The recovery event is as load-bearing as the failure one: a failure with no
   * recorded end reads as still happening.
   */
  it('reports a recovery once', async () => {
    const indicator = new ScriptedIndicator('redis', down)
    const { service, sink } = serviceWithSink([indicator])

    await service.checkReadiness()
    indicator.setBehaviour(up)
    await service.checkReadiness()
    await service.checkReadiness()

    expect(sink.transitions).toEqual([
      { name: 'redis', isUp: false, cause: { kind: 'reported-down' } },
      { name: 'redis', isUp: true }
    ])
  })

  /**
   * A recovery carries no cause key at all, rather than an undefined one.
   *
   * A structured log query filtering on the presence of `cause` answers the
   * question it was asked only if the key is genuinely absent; a key present and
   * `undefined` serializes away in JSON but not in every sink between here and
   * the log store.
   */
  it('omits the cause key entirely on a recovery', async () => {
    const indicator = new ScriptedIndicator('redis', down)
    const { service, sink } = serviceWithSink([indicator])

    await service.checkReadiness()
    indicator.setBehaviour(up)
    await service.checkReadiness()

    const recovery = sink.transitions[1]
    expect(recovery).toBeDefined()
    expect(Object.hasOwn(recovery as object, 'cause')).toBe(false)
  })

  /**
   * A rejection reaches the sink as its own cause, carrying the message.
   *
   * The message reaches the sink whether or not the response exposes it: the
   * sink is application-side code at the logger's trust level, while the
   * response is typically unauthenticated.
   */
  it('distinguishes a rejection and carries its message', async () => {
    const { service, sink } = serviceWithSink([
      new ScriptedIndicator('database', rejects('connection refused'))
    ])

    await service.checkReadiness()

    expect(sink.transitions).toEqual([
      {
        name: 'database',
        isUp: false,
        cause: { kind: 'rejected', message: 'connection refused' }
      }
    ])
  })

  /**
   * A timeout reaches the sink as its own cause, carrying the bound applied.
   *
   * This is the case a consumer cannot produce for itself at any effort. The
   * aggregator abandons the indicator without telling it, so the indicator
   * reports nothing, and a consumer racing its own timer beneath this one still
   * never learns the bound that actually elapsed.
   *
   */
  it('distinguishes a timeout and carries the bound that elapsed', async () => {
    const { service, sink } = serviceWithSink(
      [new ScriptedIndicator('database', hangs)],
      optionsWithTimeout(20)
    )

    await service.checkReadiness()

    expect(sink.transitions).toEqual([
      { name: 'database', isUp: false, cause: { kind: 'timed-out', timeoutMs: 20 } }
    ])
  })

  /**
   * State is held per check name, so dependencies do not mask one another.
   *
   * A single shared flag would let one dependency going down suppress the line
   * for a second one going down after it, and let one recovery report the whole
   * application recovered while another dependency was still unreachable.
   */
  it('keys transition state by check name', async () => {
    const redis = new ScriptedIndicator('redis', down)
    const database = new ScriptedIndicator('database', up)
    const { service, sink } = serviceWithSink([redis, database])

    await service.checkReadiness()
    database.setBehaviour(down)
    await service.checkReadiness()
    redis.setBehaviour(up)
    await service.checkReadiness()

    expect(sink.transitions).toEqual([
      { name: 'redis', isUp: false, cause: { kind: 'reported-down' } },
      { name: 'database', isUp: false, cause: { kind: 'reported-down' } },
      { name: 'redis', isUp: true }
    ])
  })

  /**
   * A cause observed later in an outage does not overwrite the first.
   *
   * A dependency that stays down while its failure mode changes — a refusal that
   * becomes a hang — produces one line, carrying the cause seen at the
   * transition. That is the documented cost of one line per outage instead of
   * one per probe, and this pins it so it cannot change silently.
   */
  it('keeps the cause observed at the transition when the failure mode changes', async () => {
    const indicator = new ScriptedIndicator('database', rejects('connection refused'))
    const { service, sink } = serviceWithSink([indicator], optionsWithTimeout(20))

    await service.checkReadiness()
    indicator.setBehaviour(hangs)
    await service.checkReadiness()

    expect(sink.transitions).toEqual([
      {
        name: 'database',
        isUp: false,
        cause: { kind: 'rejected', message: 'connection refused' }
      }
    ])
  })

  /**
   * A sink that throws cannot fail the probe.
   *
   * Readiness answering `500` because its own logging broke would take a healthy
   * deployment out of rotation over an observability fault — the opposite of
   * what this feature exists to do.
   */
  it('contains a throwing sink and still answers the probe', async () => {
    const throwing: IHealthTransitionSink = {
      record: (): never => {
        throw new Error('log pipeline down')
      }
    }
    const service = new HealthService(
      [new ScriptedIndicator('redis', down)],
      normalizeCoreOptions(),
      undefined,
      undefined,
      throwing
    )

    const result = await service.checkReadiness()

    expect(result).toEqual({ status: 'error', checks: [{ name: 'redis', status: 'down' }] })
    expect(warn).toHaveBeenCalledWith(
      'Health transition sink threw and was ignored: log pipeline down'
    )
  })

  /**
   * A probe that started earlier cannot overwrite one that started later.
   *
   * Readiness is not called one at a time — an orchestrator's probe and a load
   * balancer's health check reach it concurrently — and a dependency that hangs
   * until the bound elapses is exactly what makes the earlier probe finish last.
   * Comparing states alone would then write the outage backwards: the newer
   * probe reports the recovery, and the older one's timeout lands behind it and
   * reports the dependency down again, on evidence that is already stale.
   */
  it('drops an outcome from a probe older than the one already recorded', async () => {
    // Scripted per call rather than reassigned between probes: `runIndicator`
    // defers `check()` onto a microtask, so a behaviour swapped after the call
    // returns would still be the one the "slow" probe reads.
    const script = [down, hangs, up]
    let call = 0
    const indicator = new ScriptedIndicator('database', () => {
      const behaviour = script[call] ?? up
      call += 1
      return behaviour()
    })
    const { service, sink } = serviceWithSink([indicator], optionsWithTimeout(40))

    // Establish the outage, so the next healthy observation is a real recovery.
    await service.checkReadiness()

    // The slow probe starts first and will resolve last, by timing out.
    const slow = service.checkReadiness()
    // The fast probe starts second, sees the dependency answering, finishes first.
    await service.checkReadiness()
    await slow

    expect(sink.transitions).toEqual([
      { name: 'database', isUp: false, cause: { kind: 'reported-down' } },
      { name: 'database', isUp: true }
    ])
  })

  /**
   * Two indicators sharing a name settle on the first outcome of the probe.
   *
   * Nothing stops a consumer binding two under one name: `mergeIndicators`
   * dedupes the discovered set against the explicit one, not the explicit one
   * against itself. The readiness response reports both entries and reads the
   * first as the check's state, so the log has to agree with it — otherwise one
   * probe emits a transition and its immediate reversal, for a name whose state
   * never changed between two probes.
   */
  it('settles on the first outcome when two indicators share a name', async () => {
    const first = new ScriptedIndicator('database', up)
    const second = new ScriptedIndicator('database', down)
    const { service, sink } = serviceWithSink([first, second])

    await service.checkReadiness()
    await service.checkReadiness()

    expect(sink.transitions).toEqual([])
  })

  /**
   * A sink that rejects asynchronously is contained like one that throws.
   *
   * `record` is declared to return `void`, but TypeScript accepts any return
   * value in a void-returning position, so `async record()` compiles — and it is
   * what a consumer writes when the logger it delegates to is async. Its
   * rejection settles after the synchronous guard has exited, so without an
   * explicit catch it becomes an unhandled rejection instead of the contained
   * failure the contract documents.
   */
  it('contains a sink that rejects asynchronously', async () => {
    // Declared `async` against a `void`-returning signature: TypeScript accepts
    // it, which is precisely why the aggregator cannot assume otherwise.
    const rejectingSink: IHealthTransitionSink = {
      record: async (): Promise<void> => {
        throw new Error('log pipeline down')
      }
    }
    const service = new HealthService(
      [new ScriptedIndicator('redis', down)],
      normalizeCoreOptions(),
      undefined,
      undefined,
      rejectingSink
    )

    const result = await service.checkReadiness()
    // Let the rejection settle on the microtask queue it was deferred onto.
    await Promise.resolve()

    expect(result.status).toBe('error')
    expect(warn).toHaveBeenCalledWith(
      'Health transition sink threw and was ignored: log pipeline down'
    )
  })

  /**
   * A sink returning a non-native thenable is contained too.
   *
   * A userland promise library's result is a thenable but not an instance of
   * this realm's `Promise`, so an `instanceof` test would not notice it and its
   * rejection would escape. Detecting `then` is what the language itself does
   * when it assimilates a value, so it recognizes every shape that can carry a
   * deferred failure.
   */
  it('contains a sink returning a rejecting thenable', async () => {
    // Declared as returning a thenable and assigned into a `void`-returning
    // slot with no cast: that assignment is exactly what the compiler permits,
    // and therefore exactly what this seam has to survive.
    const thenableSink: IHealthTransitionSink = {
      record: (): RejectingThenable => ({
        then: (_onFulfilled, onRejected): void => {
          onRejected?.(new Error('userland promise failed'))
        }
      })
    }
    const service = new HealthService(
      [new ScriptedIndicator('redis', down)],
      normalizeCoreOptions(),
      undefined,
      undefined,
      thenableSink
    )

    await service.checkReadiness()
    await Promise.resolve()

    expect(warn).toHaveBeenCalledWith(
      'Health transition sink threw and was ignored: userland promise failed'
    )
  })

  /**
   * A sink returning a promise from another realm is contained too.
   *
   * `Promise` is a per-realm binding, so an `async record()` defined in a plugin
   * loaded through `node:vm` returns a genuine native promise that is not an
   * instance of this realm's constructor. This is the case that made an
   * `instanceof` test insufficient rather than merely narrow.
   *
   * The reported message goes through `String(reason)` rather than
   * `reason.message`: the rejection reason is a foreign `Error`, so it fails
   * this realm's `instanceof Error` as well. That is the summarizer behaving as
   * documented, and it still yields a bounded, readable line.
   */
  it('contains a sink returning a rejected promise from another realm', async () => {
    const foreignSink: IHealthTransitionSink = {
      record: (): RejectingThenable =>
        runInNewContext('Promise.reject(new Error("foreign realm failure"))')
    }
    const service = new HealthService(
      [new ScriptedIndicator('redis', down)],
      normalizeCoreOptions(),
      undefined,
      undefined,
      foreignSink
    )

    await service.checkReadiness()
    // Drained through the macrotask queue rather than one microtask turn:
    // assimilating a foreign promise schedules a job to call its `then`, so the
    // rejection surfaces a turn later than a same-realm one would.
    await flushAsync()

    expect(warn).toHaveBeenCalledWith(
      'Health transition sink threw and was ignored: Error: foreign realm failure'
    )
  })

  /**
   * A sink failing with a non-string `Error.message` is contained too.
   *
   * `message` is writable, so an `Error` can carry a value that reads without
   * throwing and then throws on every string operation. Summarizing it runs
   * inside the failure handler, so a throw there escapes the guard it is part
   * of: on the synchronous path it rejects the readiness probe, and on the
   * asynchronous one it becomes the unhandled rejection the handler exists to
   * prevent.
   */
  it('contains a sink whose error carries a non-string message', async () => {
    const brokenSink: IHealthTransitionSink = {
      record: (): void => {
        throw Object.assign(new Error(), { message: null })
      }
    }
    const service = new HealthService(
      [new ScriptedIndicator('redis', down)],
      normalizeCoreOptions(),
      undefined,
      undefined,
      brokenSink
    )

    const result = await service.checkReadiness()

    expect(result).toEqual({ status: 'error', checks: [{ name: 'redis', status: 'down' }] })
    expect(warn).toHaveBeenCalledWith('Health transition sink threw and was ignored: null')
  })

  /**
   * A sink returning a plain value is not treated as a failure, nor assimilated.
   *
   * `record: (t) => list.push(t)` compiles against a `void` signature and
   * returns a number, which is the concise shape a consumer reaches for. A guard
   * that keyed on "not `undefined`" would assimilate it — allocating to watch
   * for a rejection a number cannot carry — and one that inspected it carelessly
   * would throw on the primitive and report the sink as broken.
   */
  it.each([
    ['a number', (): number => 1],
    ['null', (): null => null],
    ['a string', (): string => 'ok'],
    ['an object without then', (): Record<string, unknown> => ({ ok: true })]
  ])('accepts a sink returning %s without reporting a failure', async (_label, returns) => {
    const service = new HealthService(
      [new ScriptedIndicator('redis', down)],
      normalizeCoreOptions(),
      undefined,
      undefined,
      { record: returns }
    )

    const result = await service.checkReadiness()
    await flushAsync()

    expect(result.status).toBe('error')
    expect(warn).not.toHaveBeenCalledWith(
      expect.stringContaining('Health transition sink threw and was ignored')
    )
  })

  /**
   * A logger that throws cannot take the probe out of rotation.
   *
   * Nest's logger is replaceable, so what the aggregator calls is application
   * code, and it can fail for the very reason a transition is being reported —
   * the sink and the logger sharing a backend that is down. This is the plainest
   * configuration of all: no sink bound, so the logger is the only reporting
   * path, and an uncontained throw there rejects readiness outright.
   */
  it('answers the probe when the logger itself throws', async () => {
    warn.mockImplementation(() => {
      throw new Error('log transport down')
    })
    const service = new HealthService(
      [new ScriptedIndicator('redis', down)],
      normalizeCoreOptions()
    )

    const result = await service.checkReadiness()

    expect(result).toEqual({ status: 'error', checks: [{ name: 'redis', status: 'down' }] })
    expect(warn).toHaveBeenCalled()
  })

  /**
   * A logger that throws while reporting a sink failure is absorbed too.
   *
   * This is the correlated failure: the sink broke, and the fallback that exists
   * to record that also breaks. Synchronously it would reject the probe; from
   * the asynchronous handler it would become an unhandled rejection, replacing
   * the one `containRejection` exists to contain with an identical one.
   */
  it.each([
    [
      'synchronously',
      (): void => {
        throw new Error('sink down')
      }
    ],
    ['asynchronously', async (): Promise<void> => Promise.reject(new Error('sink down'))]
  ])('absorbs a logger that throws while reporting a sink failing %s', async (_label, record) => {
    warn.mockImplementation(() => {
      throw new Error('log transport down')
    })
    const service = new HealthService(
      [new ScriptedIndicator('redis', down)],
      normalizeCoreOptions(),
      undefined,
      undefined,
      { record }
    )

    const result = await service.checkReadiness()
    await flushAsync()

    expect(result).toEqual({ status: 'error', checks: [{ name: 'redis', status: 'down' }] })
  })

  /**
   * With no sink bound the transition lines still reach Nest's logger.
   *
   * Binding a sink routes transitions into a structured surface; it is not what
   * makes them exist. A deployment that wires nothing still gets the record, and
   * a readiness failure is never silent by default.
   *
   * The levels are part of the contract: down is a warning, because an
   * unreachable dependency is what readiness exists to route around, while
   * recovery is an ordinary line since nothing is wrong when it is written.
   */
  it('logs transitions with no sink bound', async () => {
    const indicator = new ScriptedIndicator('redis', down)
    const service = new HealthService([indicator], normalizeCoreOptions())

    await service.checkReadiness()
    indicator.setBehaviour(up)
    await service.checkReadiness()
    await service.checkReadiness()

    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(
      'Health check "redis" went down: the indicator reported it down'
    )
    expect(log).toHaveBeenCalledTimes(1)
    expect(log).toHaveBeenCalledWith('Health check "redis" recovered')
  })

  /**
   * The logged line names a rejection apart from a deliberate `down`.
   *
   * A deployment that binds no sink reads the cause off this text and nowhere
   * else, so each of the three has to survive into it rather than only into the
   * structured event.
   */
  it('names a rejection in the logged line', async () => {
    const service = new HealthService(
      [new ScriptedIndicator('database', rejects('connection refused'))],
      normalizeCoreOptions()
    )

    await service.checkReadiness()

    expect(warn).toHaveBeenCalledWith(
      'Health check "database" went down: the indicator rejected: connection refused'
    )
  })

  /**
   * The logged line carries the bound that elapsed on a timeout.
   *
   * Without a sink this text is the only place the applied bound appears — the
   * response body carries `timedOutAfterMs`, but a probe path is typically
   * excluded from the HTTP log, which is the silence this feature closes.
   */
  it('carries the elapsed bound in the logged line', async () => {
    const service = new HealthService(
      [new ScriptedIndicator('database', hangs)],
      optionsWithTimeout(20)
    )

    await service.checkReadiness()

    expect(warn).toHaveBeenCalledWith(
      'Health check "database" went down: the indicator did not answer within 20ms'
    )
  })

  /**
   * Binding a sink stands the library's own line down.
   *
   * Both destinations are usually the same logger in a consuming application, so
   * keeping the line would put two records of one transition side by side —
   * the noise this feature exists to remove. The sink is handed the cause as
   * structured data, strictly more than the line renders, so what reaches the
   * log after that is the consumer's decision rather than this package's.
   */
  it('stops logging its own line once a sink is bound', async () => {
    const indicator = new ScriptedIndicator('redis', down)
    const { service, sink } = serviceWithSink([indicator])

    await service.checkReadiness()
    indicator.setBehaviour(up)
    await service.checkReadiness()

    expect(sink.transitions).toHaveLength(2)
    expect(warn).not.toHaveBeenCalled()
    expect(log).not.toHaveBeenCalled()
  })
})
