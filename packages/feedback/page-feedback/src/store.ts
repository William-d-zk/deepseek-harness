/**
 * SQLite-backed page-annotation store (node:sqlite, zero runtime deps beyond
 * the validator). Every state write appends an audit row to
 * `annotation_events` so concurrent consumers (web UI, model tools, multiple
 * agents) can trace status drift and reply overwrites.
 *
 * Audit semantics (ported from AliothStudio add-feedback-audit-events):
 * - `created`            on addAnnotation
 * - `status_changed`     only when the status actually changes (idempotent
 *                        same-status PATCH records nothing)
 * - `reply_written`      snapshots the previous reply on any PATCH carrying
 *                        one (overwrites never lose history)
 * - `verification_written` snapshots the previous verification payload
 * Source attribution is a write-time parameter (browser/cli/model).
 * @module @deepseek-ai/dsh-page-feedback
 */

import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  STATUS_TRANSITIONS,
  type AddAnnotationInput,
  type Annotation,
  type AnnotationEvent,
  type AnnotationStatus,
  type AuditSource,
  type FeedbackSession,
  type PageFeedbackService,
} from './types.ts'

interface Waiter {
  settled: boolean
  timer: NodeJS.Timeout
  resolve: (batch: Annotation[]) => void
}

function toAnnotation(row: Record<string, unknown>): Annotation {
  return {
    id: row.id as string,
    sessionId: row.session_id as string,
    origin: row.origin as string,
    url: row.url as string,
    comment: row.comment as string,
    element: row.element as string,
    elementPath: row.element_path as string,
    cssClasses: row.css_classes as string,
    status: row.status as AnnotationStatus,
    reply: (row.reply as string | null) ?? null,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  }
}

function toEvent(row: Record<string, unknown>): AnnotationEvent {
  return {
    id: row.id as string,
    annotationId: row.annotation_id as string,
    kind: row.kind as AnnotationEvent['kind'],
    from: (row.from_value as string | null) ?? null,
    to: (row.to_value as string | null) ?? null,
    source: row.source as AuditSource,
    at: row.at as number,
  }
}

/** One queryable, versioned verification snapshot (history keeps old ones). */
interface VerificationRow {
  annotation_id: string
  payload: string
  at: number
}

/** Create the store; `dbPath` may point to a temp file in tests. */
export function createPageFeedbackStore(dbPath: string): PageFeedbackService {
  mkdirSync(dirname(dbPath), { recursive: true })
  const db = new DatabaseSync(dbPath)
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      origin TEXT NOT NULL,
      url TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS annotations (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      origin TEXT NOT NULL,
      url TEXT NOT NULL,
      comment TEXT NOT NULL,
      element TEXT NOT NULL DEFAULT '',
      element_path TEXT NOT NULL DEFAULT '',
      css_classes TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      reply TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS annotation_events (
      id TEXT PRIMARY KEY,
      annotation_id TEXT NOT NULL REFERENCES annotations(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      from_value TEXT,
      to_value TEXT,
      source TEXT NOT NULL DEFAULT 'browser',
      at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS verification (
      annotation_id TEXT PRIMARY KEY REFERENCES annotations(id) ON DELETE CASCADE,
      payload TEXT NOT NULL,
      at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_events_annotation ON annotation_events(annotation_id, at);
  `)

  const insertSession = db.prepare('INSERT INTO sessions (id, origin, url, created_at) VALUES (?, ?, ?, ?)')
  const findSession = db.prepare('SELECT * FROM sessions WHERE origin = ? AND url = ? LIMIT 1')
  const insertAnnotation = db.prepare(
    `INSERT INTO annotations
       (id, session_id, origin, url, comment, element, element_path, css_classes, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  const selectPending = db.prepare(
    "SELECT * FROM annotations WHERE status IN ('pending', 'acknowledged') ORDER BY created_at DESC",
  )
  const selectById = db.prepare('SELECT * FROM annotations WHERE id = ? LIMIT 1')
  const updateStatus = db.prepare('UPDATE annotations SET status = ?, reply = ?, updated_at = ? WHERE id = ?')
  const countAll = db.prepare('SELECT count(*) AS n FROM annotations')
  const deleteStale = db.prepare(
    "DELETE FROM annotations WHERE status IN ('resolved', 'dismissed') AND updated_at <= ?",
  )
  const insertEvent = db.prepare(
    'INSERT INTO annotation_events (id, annotation_id, kind, from_value, to_value, source, at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
  const selectEvents = db.prepare(
    'SELECT * FROM annotation_events WHERE annotation_id = ? ORDER BY rowid ASC',
  )
  const upsertVerification = db.prepare(
    `INSERT INTO verification (annotation_id, payload, at) VALUES (?, ?, ?)
     ON CONFLICT(annotation_id) DO UPDATE SET payload = excluded.payload, at = excluded.at`,
  )
  const selectVerification = db.prepare('SELECT * FROM verification WHERE annotation_id = ? LIMIT 1')

  const waiters = new Set<Waiter>()

  const recordEvent = (
    annotationId: string,
    kind: AnnotationEvent['kind'],
    from: string | null,
    to: string | null,
    source: AuditSource,
  ): void => {
    insertEvent.run(randomUUID(), annotationId, kind, from, to, source, Date.now())
  }

  const wake = (): void => {
    const batch = selectPending.all().map(toAnnotation)
    for (const waiter of waiters) {
      /* v8 ignore next -- wake() settles+deletes each waiter, so a settled entry is never observable here; stale-waiter race guard only */
      if (waiter.settled) continue
      waiter.settled = true
      clearTimeout(waiter.timer)
      waiters.delete(waiter)
      waiter.resolve(batch)
    }
  }

  const service: PageFeedbackService = {
    health() {
      return {
        ok: true,
        annotations: (countAll.get() as { n: number }).n,
        pending: selectPending.all().length,
      }
    },

    ensureSession(origin: string, url: string): FeedbackSession {
      const existing = findSession.get(origin, url) as Record<string, unknown> | undefined
      if (existing !== undefined) {
        return {
          id: existing.id as string,
          origin: existing.origin as string,
          url: existing.url as string,
          createdAt: existing.created_at as number,
        }
      }
      const session = { id: randomUUID(), origin, url, createdAt: Date.now() }
      insertSession.run(session.id, session.origin, session.url, session.createdAt)
      return session
    },

    addAnnotation(input: AddAnnotationInput, source: AuditSource = 'browser'): Annotation {
      if (input.comment.trim() === '') {
        throw new Error('pageFeedback.addAnnotation: comment must not be empty')
      }
      const session =
        input.sessionId !== undefined && input.sessionId !== ''
          ? { id: input.sessionId }
          : service.ensureSession(input.origin, input.url)
      const now = Date.now()
      const annotation: Annotation = {
        id: randomUUID(),
        sessionId: session.id,
        origin: input.origin,
        url: input.url,
        comment: input.comment.trim(),
        element: input.element ?? '',
        elementPath: input.elementPath ?? '',
        cssClasses: input.cssClasses ?? '',
        status: 'pending',
        reply: null,
        createdAt: now,
        updatedAt: now,
      }
      insertAnnotation.run(
        annotation.id, annotation.sessionId, annotation.origin, annotation.url,
        annotation.comment, annotation.element, annotation.elementPath, annotation.cssClasses,
        annotation.status, annotation.createdAt, annotation.updatedAt,
      )
      recordEvent(annotation.id, 'created', null, null, source)
      wake()
      return annotation
    },

    pending() {
      return selectPending.all().map(toAnnotation)
    },

    get(id: string) {
      const row = selectById.get(id) as Record<string, unknown> | undefined
      return row === undefined ? null : toAnnotation(row)
    },

    setStatus(id, status, reply, source: AuditSource = 'model'): Annotation {
      const current = service.get(id)
      if (current === null) {
        throw new Error(`pageFeedback.setStatus: annotation ${id} not found`)
      }
      let nextStatus = current.status
      if (status !== undefined && status !== current.status) {
        if (!STATUS_TRANSITIONS[current.status].includes(status)) {
          throw new Error(
            `pageFeedback.setStatus: ${current.status} → ${status} is not an allowed transition`,
          )
        }
        nextStatus = status
      }
      if (nextStatus !== current.status) {
        recordEvent(id, 'status_changed', current.status, nextStatus, source)
      }
      if (reply !== undefined && reply !== current.reply) {
        recordEvent(id, 'reply_written', current.reply, reply, source)
      }
      const now = Date.now()
      updateStatus.run(nextStatus, reply ?? current.reply, now, id)
      const updated = service.get(id)
      /* v8 ignore next -- sync UPDATE cannot lose the row; the follow-up get() always finds it */
      if (updated === null) throw new Error('pageFeedback.setStatus: update lost the row')
      return updated
    },

    history(id: string): AnnotationEvent[] {
      return selectEvents.all(id).map(toEvent)
    },

    watch(timeoutMs: number): Promise<Annotation[]> {
      return new Promise<Annotation[]>((resolveWatch) => {
        const waiter: Waiter = {
          settled: false,
          timer: setTimeout(() => {
            /* v8 ignore next -- wake() clears the timer while settling; timer never races a settled waiter */
            if (waiter.settled) return
            waiter.settled = true
            waiters.delete(waiter)
            resolveWatch(selectPending.all().map(toAnnotation))
          }, Math.max(0, Math.min(timeoutMs, 60_000))),
          resolve: resolveWatch,
        }
        waiters.add(waiter)
      })
    },

    prune(olderThanMs: number) {
      const result = deleteStale.run(Date.now() - olderThanMs)
      return Number(result.changes)
    },

    writeVerification(id, evidence, source: AuditSource = 'model'): AnnotationEvent[] {
      if (service.get(id) === null) {
        throw new Error(`pageFeedback.writeVerification: annotation ${id} not found`)
      }
      const existing = selectVerification.get(id) as VerificationRow | undefined
      const payload = JSON.stringify(evidence)
      upsertVerification.run(id, payload, Date.now())
      recordEvent(id, 'verification_written', existing?.payload ?? null, payload, source)
      return service.history(id)
    },
  }

  return service
}
