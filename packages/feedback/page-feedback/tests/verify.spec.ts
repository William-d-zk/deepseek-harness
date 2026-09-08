import { describe, expect, it } from 'vitest'
import { runVerifier, defaultVerifierCommand, verifierCommandOf } from '../src/verify.ts'

/** A runnable stand-in for ego-browser: `node -e <code>`. */
const nodeRunner = (code: string) => `${process.execPath} -e ${JSON.stringify(code)}`

describe('page-feedback verifier seam', () => {
  it('defaults to the ego-browser command', () => {
    expect(defaultVerifierCommand()).toBe('ego-browser')
  })

  it('verifierCommandOf prefers a non-empty env override', () => {
    expect(verifierCommandOf({ PAGE_FEEDBACK_VERIFIER: 'my-runner' })).toBe('my-runner')
    expect(verifierCommandOf({ PAGE_FEEDBACK_VERIFIER: '' })).toBe('ego-browser')
    expect(verifierCommandOf({})).toBe('ego-browser')
  })

  it('parses a successful capture stdout into evidence', async () => {
    const evidence = await runVerifier(
      { url: 'http://x', outDir: '/tmp/e' },
      nodeRunner(
        'console.log(JSON.stringify({ screenshots: [{ path: \'/tmp/e/desktop.png\' }, { path: \'/tmp/e/mobile.png\' }] }))',
      ),
    )
    expect(evidence.mode).toBe('capture')
    expect(evidence.exitCode).toBe(0)
    expect(evidence.files).toEqual(['/tmp/e/desktop.png', '/tmp/e/mobile.png'])
    expect(evidence.anomalies).toEqual([])
  })

  it('reports a non-zero exit as an anomaly and keeps stderr detail', async () => {
    const evidence = await runVerifier(
      { url: 'http://x', outDir: '/tmp' },
      nodeRunner('console.error(\'boom\'); process.exit(2)'),
    )
    expect(evidence.exitCode).toBe(2)
    expect(evidence.anomalies.some(a => a.includes('verifier exit 2'))).toBe(true)
  })

  it('reports an unrunnable verifier binary as a non-zero exit', async () => {
    const evidence = await runVerifier({ url: 'http://x', outDir: '/tmp' }, 'no-such-binary-xyz')
    expect(evidence.exitCode).not.toBe(0)
    expect(evidence.anomalies.length).toBeGreaterThan(0)
  })

  it('records an anomaly when verifier stdout is not JSON', async () => {
    const evidence = await runVerifier(
      { url: 'http://x', outDir: '/tmp' },
      nodeRunner('console.log(\'not json at all\')'),
    )
    expect(evidence.anomalies.some(a => a.includes('not JSON'))).toBe(true)
    expect(evidence.files).toEqual([])
  })

  it('handles valid JSON without a screenshots field', async () => {
    const evidence = await runVerifier(
      { url: 'http://x', outDir: '/tmp' },
      nodeRunner('console.log(JSON.stringify({ note: \'no shots\' }))'),
    )
    expect(evidence.exitCode).toBe(0)
    expect(evidence.files).toEqual([])
    expect(evidence.anomalies).toEqual([])
  })

  it('uses PAGE_FEEDBACK_VERIFIER env when no binary is passed', async () => {
    const previous = process.env.PAGE_FEEDBACK_VERIFIER
    process.env.PAGE_FEEDBACK_VERIFIER = nodeRunner('console.log(JSON.stringify({ screenshots: [] }))')
    try {
      const evidence = await runVerifier({ url: 'http://x', outDir: '/tmp' })
      expect(evidence.exitCode).toBe(0)
    } finally {
      if (previous === undefined) delete process.env.PAGE_FEEDBACK_VERIFIER
      else process.env.PAGE_FEEDBACK_VERIFIER = previous
    }
  })

})
