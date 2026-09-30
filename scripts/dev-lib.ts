/**
 * Keep this workspace's built `lib/` artifacts fresh while you edit the harness.
 *
 * The consumer checkouts (dsh-alioth, dsh-chess) list this tree as a pnpm
 * workspace member, so they resolve every `@deepseek-ai/dsh-*` import through
 * the linked package directory — and that directory's `exports` points at
 * `lib/`. A source edit therefore reaches them only once `lib/` is rewritten;
 * this watch keeps both faces' type declarations and runtime bundles current,
 * which is what lets them follow this fork without a publish or an install.
 *
 *   pnpm run dev:lib              # host and client faces
 *   pnpm run dev:lib -- --poll    # fixed-interval watchers for network mounts
 *
 * The desktop bundle that closes `build:lib:host` stays out of the loop: it
 * packages the Electron app rather than the packages a consumer imports.
 * @module scripts/dev-lib
 */
import { StageSupervisor, spawnStage } from './dev-web.ts'

/** Type programs whose emitted `lib/types` the consumers' typecheck reads. */
const TYPE_PROGRAMS = ['tsconfig.host.json', 'tsconfig.client.json'] as const

/**
 * Grace period per escalation step. tsc and tsdown both finish the build they
 * are in before exiting, so the first signal is enough on an idle loop.
 */
const STOP_GRACE_MS = 6_000

/** Polling interval selected by a bare `--poll`. */
const DEFAULT_POLL_INTERVAL = 500

/**
 * Watch both faces' types and runtime bundles until interrupted.
 * @returns the exit code the loop settles on.
 */
async function main(): Promise<number> {
  const arguments_ = process.argv.slice(2)
  const unknown = arguments_.filter(argument => argument !== '--poll' && !argument.startsWith('--poll='))
  if (unknown.length > 0) {
    console.error(`dev-lib: unknown argument(s): ${unknown.join(' ')}`)
    console.error('dev-lib: usage: pnpm run dev:lib [--poll[=ms]]')
    return 1
  }
  const pollArgument = arguments_.find(argument => argument === '--poll' || argument.startsWith('--poll='))
  const pollInterval = pollArgument === undefined ? undefined
    : pollArgument === '--poll' ? DEFAULT_POLL_INTERVAL
      : Number(pollArgument.slice('--poll='.length))
  if (pollInterval !== undefined && (!Number.isSafeInteger(pollInterval) || pollInterval < 1)) {
    console.error(`dev-lib: --poll must be a positive integer number of milliseconds, got ${String(pollArgument?.slice('--poll='.length))}`)
    return 1
  }

  // Shutdown is requested once, by a terminal signal or by a stage exiting on
  // its own; `signal` stays unset for SIGINT because the terminal's process
  // group already delivered it to every stage.
  const shutdown = Promise.withResolvers<number>()
  const requested: { code?: number; signal?: NodeJS.Signals } = {}
  const requestShutdown = (code: number, signal: NodeJS.Signals | undefined): void => {
    if (requested.code !== undefined) return
    requested.code = code
    if (signal !== undefined) requested.signal = signal
    shutdown.resolve(code)
  }
  const supervisor = new StageSupervisor((stage, code) => {
    console.error(`dev-lib: ${stage} exited (code ${String(code)}); stopping the other stages`)
    requestShutdown(1, 'SIGTERM')
  })
  // Persistent listeners, not `once`: the tsdown watchers bundle signal-exit,
  // which re-raises a signal whenever it finds no other listener left and would
  // terminate this process in the middle of the teardown below.
  process.on('SIGINT', () => { requestShutdown(130, undefined) })
  process.on('SIGTERM', () => { requestShutdown(0, 'SIGTERM') })

  // tsc has no polling interval flag, so `--poll` selects its fixed-interval
  // watchers rather than an interval; without them a network mount where
  // inotify never fires keeps emitting stale `lib/types` for the consumers.
  const tscWatchFiles = pollInterval === undefined
    ? []
    : ['--watchFile', 'fixedPollingInterval', '--watchDirectory', 'fixedPollingInterval']
  spawnStage(supervisor, `tsc -b ${TYPE_PROGRAMS.join(' ')} --watch`, 'tsc', [
    '-b', ...TYPE_PROGRAMS, '--watch', '--preserveWatchOutput', ...tscWatchFiles,
  ], true)
  spawnStage(supervisor, 'tsdown --watch --env.DSH_BUILD_FACE host', 'tsdown', ['--watch', '--env.DSH_BUILD_FACE', 'host'], true)
  spawnStage(supervisor, 'tsdown --watch --env.DSH_BUILD_FACE client', 'tsdown', ['--watch', '--env.DSH_BUILD_FACE', 'client'], true)
  console.log(
    'dev-lib: watching lib/types (tsconfig.host.json, tsconfig.client.json)'
    + ' and the host and client lib bundles for the consumer checkouts'
    + (pollInterval === undefined ? '' : `, with fixed polling every ${String(pollInterval)}ms`),
  )

  const exitCode = await shutdown.promise
  await supervisor.stop({ signal: requested.signal, graceMs: STOP_GRACE_MS })
  return exitCode
}

if (import.meta.main) process.exit(await main())
