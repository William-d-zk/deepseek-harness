/** Lane occupancy probe for the worker-cap spec (scripts/test-workers.spec.ts). */
import { appendFileSync } from 'node:fs'
import { it } from 'vitest'

const probe = process.env.DSH_TEST_WORKERS_PROBE
if (probe === undefined) throw new Error('DSH_TEST_WORKERS_PROBE must name the probe directory')

it('occupies its lane long enough to overlap a peer', async () => {
  const start = Date.now()
  appendFileSync(`${probe}/lane-1.log`, `START ${start}\n`)
  const hold = Promise.withResolvers<void>()
  setTimeout(hold.resolve, 1_000)
  await hold.promise
  appendFileSync(`${probe}/lane-1.log`, `END ${Date.now()}\n`)
})
