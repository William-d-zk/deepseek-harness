/** Fourth lane occupancy probe; the sweep reads its START/END pair like the rest. */
import { appendFileSync } from 'node:fs'
import { it } from 'vitest'

const probeRoot = process.env.DSH_TEST_WORKERS_PROBE
if (probeRoot === undefined) throw new Error('DSH_TEST_WORKERS_PROBE must name the probe directory')

it('holds its lane for the sweep window', async () => {
  const openedAt = Date.now()
  appendFileSync(`${probeRoot}/lane-4.log`, `START ${openedAt}\n`)
  const window = Promise.withResolvers<void>()
  setTimeout(window.resolve, 1_900)
  await window.promise
  appendFileSync(`${probeRoot}/lane-4.log`, `END ${Date.now()}\n`)
})
