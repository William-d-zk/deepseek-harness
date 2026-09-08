/**
 * Optional resolve verification seam. `page-feedback` does not run a browser
 * itself: a consumer (AliothStudio dev loop, dsh web deployment, a harness
 * agent tool) that wants screenshots + console evidence on resolve calls the
 * configured verifier command, then records the result with
 * `pageFeedback.writeVerification(id, evidence)`.
 *
 * The default `ego-browser` verifier shells out to the global ego-browser CLI
 * (capture three viewports + element check when an elementPath is known). The
 * exact command is deployable policy; any program that prints the JSON shape
 * below on stdout may stand in.
 * @module @deepseek-ai/dsh-page-feedback
 */

import { spawn } from 'node:child_process'
import type { VerificationEvidence } from './types.ts'

export interface ResolveVerifyInput {
  url: string
  /** Element CSS path for the focused element check (optional). */
  elementPath?: string
  /** Expect the element to be gone (deletion-class annotation). */
  expectGone?: boolean
  /** Evidence output directory. */
  outDir: string
}

/** Default verifier command (ego-browser is the AliothStudio-family runner). */
export function defaultVerifierCommand(): string {
  return 'ego-browser'
}

/** Resolve the effective verifier command: env override, else the default. */
export function verifierCommandOf(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env.PAGE_FEEDBACK_VERIFIER
  return fromEnv !== undefined && fromEnv !== '' ? fromEnv : defaultVerifierCommand()
}

/**
 * Run the configured verifier and return the captured evidence. The command
 * is any executable invocation the deployer controls; a shell runs it so
 * `PAGE_FEEDBACK_VERIFIER` may carry arguments (`ego-browser capture` style).
 */
export function runVerifier(
  input: ResolveVerifyInput,
  /* v8 ignore next -- default arg reads process.env via verifierCommandOf (covered
     separately); concurrent lanes cannot isolate process env here */
  command = verifierCommandOf(),
): Promise<VerificationEvidence> {
  return new Promise<VerificationEvidence>((resolve, reject) => {
    const child = spawn(command, ['capture', input.url, '--out', input.outDir], {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    /* v8 ignore next 2 -- shell:true reports missing binaries via exit 127 on stderr;
       this fires only for spawn-level failures the shell cannot start at all */
    child.on('error', (error) => {
      reject(new Error(`page-feedback verifier "${command}" not runnable: ${error.message}`))
    })
    child.on('close', (code) => {
      const anomalies: string[] = []
      if (code !== 0) anomalies.push(`verifier exit ${String(code)}: ${stderr.trim().slice(0, 200)}`)
      const parsed = stdout.trim()
      let files: string[] = []
      try {
        const json = JSON.parse(parsed) as { screenshots?: Array<{ path: string }> }
        files = (json.screenshots ?? []).map(s => s.path)
      } catch {
        if (parsed.length > 0) anomalies.push('verifier stdout was not JSON')
      }
      /* v8 ignore next -- child close() always carries an exit code */
      const exitCode = code ?? -1
      resolve({
        mode: 'capture',
        evidenceDir: input.outDir,
        files,
        exitCode,
        anomalies,
      })
    })
  })
}
