/** Second lane occupancy probe; a distinct span keeps the overlap sweep honest. */
import { appendFileSync } from 'node:fs'
import { it } from 'vitest'

const probeDir = process.env.DSH_TEST_WORKERS_PROBE
if (probeDir === undefined) throw new Error('DSH_TEST_WORKERS_PROBE must name the probe directory')

it('records a span that overlaps a concurrent lane', async () => {
  const opened = Date.now()
  appendFileSync(`${probeDir}/lane-2.log`, `START ${opened}\n`)
  const span = Promise.withResolvers<void>()
  setTimeout(span.resolve, 1_300)
  await span.promise
  appendFileSync(`${probeDir}/lane-2.log`, `END ${Date.now()}\n`)
})
