/**
 * DSH_TEST_MAX_WORKERS bounds how many spec files a root lane runs at once
 * (scripts/test-workers.ts owns the default and its host bound). Four probe
 * fixtures record their own spans, so the cap is observable as a peak overlap:
 * the default keeps the whole probe set resident together, an explicit 2 never
 * holds more than two, and a malformed value must fail at config load before
 * any fixture runs.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { availableParallelism, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_TEST_MAX_WORKERS, TEST_MAX_WORKERS_ENV } from './test-workers.ts'

const root = resolve(import.meta.dirname, '..')
const vitestCli = fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url))
const lanes = ['lane-1', 'lane-2', 'lane-3', 'lane-4']
const fixtures = lanes.map(lane => `scripts/fixtures/test-workers/${lane}.fixture.ts`)
/** A bounded probe run takes seconds; a misconfigured child must fail fast, not sweep the inventory. */
const CHILD_TIMEOUT_MS = 30_000
/** Budget per case: it covers the child's own cap plus spawn, transform, and the assertions. */
const CASE_TIMEOUT_MS = 90_000

let temporaryRoot = ''
let configPath = ''
let probeDirectory = ''

beforeEach(() => {
  temporaryRoot = mkdtempSync(join(tmpdir(), 'dsh-test-workers-'))
  probeDirectory = join(temporaryRoot, 'probes')
  mkdirSync(probeDirectory)
  configPath = join(temporaryRoot, 'vitest.config.ts')
  // The sibling package.json keeps Vite bundling the config as ESM. Both the
  // top level and the project carry the probe inventory: an empty or dropped
  // project include falls back to the top-level one, and any fallback to the
  // repository inventory would fork a worker per spec file. Only the
  // thread-safe project stays live, because a second project would add its own
  // worker budget to the measured overlap.
  writeFileSync(join(temporaryRoot, 'package.json'), '{ "type": "module" }\n', 'utf8')
  writeFileSync(configPath, [
    `import base from ${JSON.stringify(resolve(root, 'vitest.config.ts').split('\\').join('/'))}`,
    'export default {',
    '  ...base,',
    '  test: {',
    '    ...base.test,',
    `    include: ${JSON.stringify(fixtures)},`,
    '    projects: (base.test.projects ?? [])',
    "      .filter(project => project.test?.name === 'thread-safe')",
    `      .map(project => ({ ...project, test: { ...project.test, include: ${JSON.stringify(fixtures)} } })),`,
    '  },',
    '}',
    '',
  ].join('\n'), 'utf8')
})
afterEach(() => {
  if (temporaryRoot !== '') rmSync(temporaryRoot, { recursive: true, force: true })
  temporaryRoot = ''
})

/** Spans the child run recorded, in lane order; missing lanes are absent. */
function recordedSpans(): Array<{ start: number; end: number }> {
  return lanes.flatMap((lane) => {
    const log = join(probeDirectory, `${lane}.log`)
    if (!existsSync(log)) return []

    const [start, end] = readFileSync(log, 'utf8').trim().split('\n')
    return [{ start: Number(/^START (\d+)$/.exec(start ?? '')?.[1]), end: Number(/^END (\d+)$/.exec(end ?? '')?.[1]) }]
  })
}

/** Highest number of spans that are resident at one instant. */
function peakOverlap(spans: Array<{ start: number; end: number }>): number {
  const events = spans.flatMap(span => [{ at: span.start, occupied: 1 }, { at: span.end, occupied: -1 }])
  events.sort((left, right) => left.at - right.at || left.occupied - right.occupied)

  let live = 0
  let peak = 0
  for (const event of events) {
    live += event.occupied
    peak = Math.max(peak, live)
  }
  return peak
}

function runFixtures(maxWorkers: string | undefined): { status: number | null; output: string } {
  const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: '1', DSH_TEST_WORKERS_PROBE: probeDirectory }
  for (const name of Object.keys(env)) {
    // The parent worker's Vitest state, the coverage coordinator's variables,
    // and any inherited cap describe this process, not the child.
    if (name.startsWith('VITEST') || name.startsWith('DSH_COVERAGE_') || name === 'GITHUB_ACTIONS' || name === TEST_MAX_WORKERS_ENV) {
      Reflect.deleteProperty(env, name)
    }
  }
  if (maxWorkers !== undefined) env[TEST_MAX_WORKERS_ENV] = maxWorkers

  const child = spawnSync(process.execPath, [vitestCli, 'run', '--config', configPath], {
    cwd: root,
    env,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    timeout: CHILD_TIMEOUT_MS,
    killSignal: 'SIGKILL',
  })
  if (child.error !== undefined) throw child.error
  expect(child.signal, 'the child Vitest run ended through a signal').toBeNull()
  return { status: child.status, output: `${child.stdout}\n${child.stderr}` }
}

describe('lane worker cap', () => {
  it('keeps the whole probe set resident under the default cap', { timeout: CASE_TIMEOUT_MS }, () => {
    const { status, output } = runFixtures(undefined)

    expect(output).toMatch(/Test Files\s+4 passed/)
    expect(status).toBe(0)
    const spans = recordedSpans()
    expect(spans).toHaveLength(lanes.length)
    expect(peakOverlap(spans)).toBe(Math.max(1, Math.min(DEFAULT_TEST_MAX_WORKERS, availableParallelism(), lanes.length)))
  })

  it('holds at most the configured number of probe files at once', { timeout: CASE_TIMEOUT_MS }, () => {
    const { status } = runFixtures('2')

    expect(status).toBe(0)
    const spans = recordedSpans()
    expect(spans).toHaveLength(lanes.length)
    expect(peakOverlap(spans)).toBe(2)
  })

  it('refuses a malformed cap at config load before any fixture runs', { timeout: CASE_TIMEOUT_MS }, () => {
    const { status, output } = runFixtures('0')

    expect(output).toContain(`${TEST_MAX_WORKERS_ENV} must be a positive integer, got "0".`)
    expect(status).toBe(1)
    expect(recordedSpans()).toEqual([])
  })
})
