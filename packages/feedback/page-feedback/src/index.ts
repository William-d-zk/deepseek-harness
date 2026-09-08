/**
 * `@deepseek-ai/dsh-page-feedback` — visual page-annotation feedback loop.
 *
 * Humans leave on-page annotations (via the overlay served by a carrier or
 * injected into a prototype); agents and product surfaces consume them through
 * the `ctx.pageFeedback` service: a persistent store with the
 * `pending ⇄ acknowledged → resolved | dismissed` state machine, audit events
 * for concurrent-consumer traceability, and a long-poll watch seam. Resolve
 * may attach ego-browser verification evidence (screenshots + console JSON)
 * recorded on the annotation for later audit.
 *
 * This package is the store/capability only — it owns no HTTP port. A carrier
 * (product web server or a dev-tool server) exposes the store to browsers and
 * tools; see the group README for composition guidance.
 * @module @deepseek-ai/dsh-page-feedback
 */

import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'
import { createPageFeedbackStore } from './store.ts'
import type { PageFeedbackService } from './types.ts'

export const name = 'page-feedback'
export const inject: readonly string[] = []

export type * from './types.ts'
export { ANNOTATION_STATUSES, STATUS_TRANSITIONS } from './types.ts'
export type { PageFeedbackService } from './types.ts'
export { createPageFeedbackStore } from './store.ts'

/** Default per-user state directory (matches the harness feedback sibling). */
export function defaultDbPath(): string {
  return resolve(homedir(), '.dsh', 'feedback-page.db')
}

export interface Config {
  /** SQLite database path; defaults to `~/.dsh/feedback-page.db`. */
  dbPath?: string
}

export const Config: s<Config> = s.object({
  dbPath: s.string().default(''),
})

declare module '@deepseek-ai/cordis' {
  interface Context {
    pageFeedback: PageFeedbackService
  }
}

export function apply(ctx: Context, config: Config): void {
  const dbPath =
    config.dbPath != null && config.dbPath !== ''
      ? config.dbPath
      : process.env.DSH_PAGE_FEEDBACK_DB_PATH ?? defaultDbPath()
  ctx.provide('pageFeedback', createPageFeedbackStore(dbPath))
  ctx.logger.info(`page-feedback: annotation store at ${dbPath}`)
}
