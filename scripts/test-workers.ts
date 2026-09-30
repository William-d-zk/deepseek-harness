/** Bounds the forked Node processes the root Vitest lanes keep alive at once. */

/** Environment variable overriding the lane worker cap. */
export const TEST_MAX_WORKERS_ENV = 'DSH_TEST_MAX_WORKERS'

/**
 * Default cap for the root lanes. Each spec file forks its own Node process,
 * the client lanes each hold a Vite transform graph, and the aggregate
 * inventory is thousands of files, so peak resident memory tracks the worker
 * count: on the reference host (12 CPUs, 24 GiB, other applications resident)
 * the parallelism Vitest derives from the host exhausted memory, while this
 * conservative start keeps a full run inside the machine's budget.
 * `DSH_TEST_MAX_WORKERS` raises it for one run; revisit the default after a
 * low-concurrency full-suite measurement.
 */
export const DEFAULT_TEST_MAX_WORKERS = 4

/**
 * Read one positive-integer setting, refusing malformed input instead of
 * silently falling back to a default.
 * @param name - environment variable name, also reported by the refusal.
 * @param fallback - value used when the variable is unset or empty.
 * @returns the configured value, or the fallback.
 */
export function positiveIntFromEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback

  const value = Number(raw)
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer, got ${JSON.stringify(raw)}.`)
  }
  return value
}

/**
 * Concurrent-file budget for the root lanes, from `DSH_TEST_MAX_WORKERS`.
 * @param parallelism - the host's available parallelism.
 * @returns the configured cap, or the default bounded by the host.
 */
export function resolveTestMaxWorkers(parallelism: number): number {
  return positiveIntFromEnv(TEST_MAX_WORKERS_ENV, Math.max(1, Math.min(DEFAULT_TEST_MAX_WORKERS, parallelism)))
}
