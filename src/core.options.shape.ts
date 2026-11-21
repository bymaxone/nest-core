/**
 * @fileoverview What the options of `BymaxCoreModule` are read by: the table of every option, and
 * inside each block the table of its own options.
 * @layer Configuration
 */
import type { BymaxCoreModuleOptions } from './core.options'
import {
  BODY_DEPTH_KEYS,
  ENVELOPE_KEYS,
  HEALTH_KEYS,
  METRICS_KEYS,
  OPTION_KEYS,
  TELEMETRY_KEYS,
  TIMING_KEYS
} from './core.options.keys'
import { OPENAPI_KEYS, SERVER_KEYS } from './core.options.openapi'
import { HANDLER_TIMEOUT_KEYS } from './handler-timeout/handler-timeout.options'
import type { Shape } from './read-options'
import { SHUTDOWN_KEYS } from './shutdown/shutdown.options'

/**
 * What `normalizeCoreOptions` reads by name: every option of the module, and the options inside each
 * block. The compiler keeps it complete, as it does each table it is built from.
 */
export const OPTION_SHAPE = {
  ...OPTION_KEYS,
  envelope: ENVELOPE_KEYS,
  timing: TIMING_KEYS,
  bodyDepth: BODY_DEPTH_KEYS,
  health: HEALTH_KEYS,
  metrics: METRICS_KEYS,
  handlerTimeout: HANDLER_TIMEOUT_KEYS,
  shutdown: SHUTDOWN_KEYS,
  openapi: { ...OPENAPI_KEYS, servers: [SERVER_KEYS] },
  telemetry: TELEMETRY_KEYS
} satisfies Record<keyof BymaxCoreModuleOptions | 'isGlobal', Shape | readonly [Shape] | 0>
