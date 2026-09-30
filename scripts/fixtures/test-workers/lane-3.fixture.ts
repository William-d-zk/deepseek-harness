/** Third lane occupancy probe for the root lane worker-cap spec. */
import { appendFileSync } from 'node:fs'
import { it } from 'vitest'

const probeDirectory = process.env.DSH_TEST_WORKERS_PROBE
if (probeDirectory === undefined) throw new Error('DSH_TEST_WORKERS_PROBE must name the probe directory')

it('stays resident across a peer handoff', async () => {
  const began = Date.now()
  appendFileSync(`${probeDirectory}/lane-3.log`, `START ${began}\n`)
  const residency = Promise.withResolvers<void>()
  setTimeout(residency.resolve, 1_600)
  await residency.promise
  appendFileSync(`${probeDirectory}/lane-3.log`, `END ${Date.now()}\n`)
})
