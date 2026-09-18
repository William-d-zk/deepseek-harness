/**
 * Page-feedback protocol types: annotation lifecycle, audit events, and the
 * service surface shared by the store, HTTP carrier, model tools, and the
 * optional ego-browser resolver.
 *
 * Ported from AliothStudio's `scripts/feedback` protocol; the state machine
 * and audit-event semantics are identical so that an AliothStudio dev loop
 * and a harness agent consuming the same server observe the same transitions.
 * @module @deepseek-ai/dsh-page-feedback
 */

/** Annotation lifecycle; terminal states have no outgoing transitions. */
export const ANNOTATION_STATUSES = ['pending', 'acknowledged', 'resolved', 'dismissed'] as const
export type AnnotationStatus = (typeof ANNOTATION_STATUSES)[number]

/** Allowed transitions; terminal states have no exits. */
export const STATUS_TRANSITIONS: Record<AnnotationStatus, readonly AnnotationStatus[]> = {
  pending: ['acknowledged', 'resolved', 'dismissed'],
  acknowledged: ['pending', 'resolved', 'dismissed'],
  resolved: [],
  dismissed: [],
}

/** Source tier of a write; used for audit attribution. */
export type AuditSource = 'browser' | 'cli' | 'model'

/** One browser/viewer session pinning the origin that annotations came from. */
export interface FeedbackSession {
  id: string
  origin: string
  url: string
  createdAt: number
}

/** The on-page annotation a human left on a page element. */
export interface Annotation {
  id: string
  sessionId: string
  origin: string
  url: string
  comment: string
  element: string
  /** CSS path from the top document; ` >>> ` / ` |> ` markers cross shadow roots / same-origin frames. */
  elementPath: string
  cssClasses: string
  /** Top-document match count for `elementPath`: 1 unique, >1 ambiguous, 0 unresolvable. */
  pathMatchCount?: number
  /** Whether the resolved element IS this annotation's target (false = honestly ambiguous, never faked unique). */
  pathMatchesTarget?: boolean
  /** Re-render-stable attribute anchor (data-testid/data-test/data-qa/#id/[name]/[aria-label]) with its boundary prefix. */
  stableSelector?: string
  /** Table column header for a `td`, by colSpan-accumulated column order — disambiguates same-value cells. */
  columnHeader?: string
  /** First cell text of the annotation's row; identifies which row was annotated. */
  rowKey?: string
  /** React `ComponentName#key` chain (cap 8, best-effort) identifying list/virtualized rows. */
  reactKeyPath?: string[]
  /** Scroll offset of the element's own window; makes the viewport-relative bounding box reproducible. */
  scroll?: { x: number; y: number }
  /** Viewport size of the element's own window, paired with `scroll`. */
  viewport?: { width: number; height: number }
  status: AnnotationStatus
  reply: string | null
  createdAt: number
  updatedAt: number
}

/** Payload of a fresh annotation from the overlay. */
export interface AddAnnotationInput {
  sessionId?: string
  origin: string
  url: string
  comment: string
  element?: string
  /** CSS path from the top document; ` >>> ` / ` |> ` markers cross shadow roots / same-origin frames. */
  elementPath?: string
  cssClasses?: string
  /** Top-document match count for `elementPath`: 1 unique, >1 ambiguous, 0 unresolvable. */
  pathMatchCount?: number
  /** Whether the resolved element IS the posted target (false = honestly ambiguous, never faked unique). */
  pathMatchesTarget?: boolean
  /** Re-render-stable attribute anchor (data-testid/data-test/data-qa/#id/[name]/[aria-label]) with its boundary prefix. */
  stableSelector?: string
  /** Table column header for a `td`, by colSpan-accumulated column order — disambiguates same-value cells. */
  columnHeader?: string
  /** First cell text of the annotated row; identifies which row was clicked. */
  rowKey?: string
  /** React `ComponentName#key` chain (cap 8, best-effort) identifying list/virtualized rows. */
  reactKeyPath?: string[]
  /** Scroll offset of the element's own window; makes the viewport-relative bounding box reproducible. */
  scroll?: { x: number; y: number }
  /** Viewport size of the element's own window, paired with `scroll`. */
  viewport?: { width: number; height: number }
}

/** Kind of audit event recorded in `annotation_events`. */
export type AnnotationEventKind = 'created' | 'status_changed' | 'reply_written' | 'verification_written'

/** One immutable audit row; the chain is the trace for concurrent consumers. */
export interface AnnotationEvent {
  id: string
  annotationId: string
  kind: AnnotationEventKind
  /** Absent for `created`; present for state/reply/verification writes. */
  from: string | null
  /** Absent for `created`; present for state/reply/verification writes. */
  to: string | null
  source: AuditSource
  at: number
}

/** Resolve verification evidence (optional ego-browser capture). */
export interface VerificationEvidence {
  mode: 'capture' | 'prototype'
  evidenceDir: string
  files: string[]
  exitCode: number
  element?: {
    found: boolean
    rect: { x: number; y: number; width: number; height: number } | null
    screenshot: string | null
    error?: string
    /** Path matches counted inside the page (1 = unique; >1 = ambiguous, `rect` is the first match). */
    matches?: number
    /** How the element was located: the self-verified `elementPath`, or a re-render-stable `stableSelector`. */
    matchedBy?: string
    /** True when a ` >>> ` / ` |> ` boundary hop failed to resolve (host gone or ambiguous). */
    boundaryBroken?: boolean
  }
  anomalies: string[]
}

/**
 * The store surface mounted on `ctx.pageFeedback`: annotation lifecycle,
 * append-only audit chain, long-poll watch, and resolve evidence.
 */
export interface PageFeedbackService {
  /**
   * Report store liveness and the current annotation counts.
   * @returns `ok: true` while the store answers, `annotations` for every stored row,
   * and `pending` for the rows still open (`pending` or `acknowledged`).
   */
  health(): { ok: boolean; annotations: number; pending: number }
  /**
   * Return the viewer session for one page, creating it on first use.
   * @param origin - origin the page's annotations are pinned to.
   * @param url - page URL inside that origin.
   * @returns the stored session for this `(origin, url)` pair, or a new one whose
   * `createdAt` is now.
   */
  ensureSession(origin: string, url: string): FeedbackSession
  /**
   * Record a new annotation as `pending` and wake every pending watcher.
   * @param input - comment plus page and element locators; a blank comment is
   * rejected, and a non-empty `sessionId` joins that stored session instead of
   * resolving one from the input origin and URL.
   * @param source - audit attribution tier; the overlay posts as `browser`.
   * @returns the stored annotation with its `created` audit row appended.
   */
  addAnnotation(input: AddAnnotationInput, source?: AuditSource): Annotation
  /**
   * List the open annotations, newest first.
   * @returns every `pending` or `acknowledged` annotation, ordered by creation
   * time descending.
   */
  pending(): Annotation[]
  /**
   * Read one annotation.
   * @param id - annotation id.
   * @returns the stored annotation, or `null` when no row carries the id.
   */
  get(id: string): Annotation | null
  /**
   * Apply a status, a reply, or both, appending one audit row per change.
   * @param id - annotation id; an unknown id is an error.
   * @param status - desired status; `undefined` keeps the current one, an
   * illegal transition is an error, and the current status records no event.
   * @param reply - reply text; `undefined` keeps the stored reply.
   * @param source - audit attribution tier; model consumers post as `model`.
   * @returns the annotation after the write.
   */
  setStatus(
    id: string,
    status: AnnotationStatus | undefined,
    reply: string | undefined,
    source?: AuditSource,
  ): Annotation
  /**
   * Read one annotation's audit chain.
   * @param id - annotation id.
   * @returns every audit row for the annotation in insertion order, which is
   * causal order even for same-millisecond writes.
   */
  history(id: string): AnnotationEvent[]
  /**
   * Wait for the next new annotation, or for the timeout.
   * @param timeoutMs - upper bound in milliseconds, clamped to `[0, 60000]`.
   * @returns the open annotations at wake time: the batch that includes the
   * added annotation, or the current batch once the timeout elapses.
   */
  watch(timeoutMs: number): Promise<Annotation[]>
  /**
   * Drop terminal annotations older than a cutoff.
   * @param olderThanMs - age in milliseconds; annotations whose last update is
   * at or before `now - olderThanMs` are deleted with their audit rows.
   * @returns the number of deleted annotations.
   */
  prune(olderThanMs: number): number
  /**
   * Replace the stored verification evidence for one annotation.
   * @param id - annotation id; an unknown id is an error.
   * @param evidence - current snapshot; the previous payload stays in the audit chain.
   * @param source - audit attribution tier; model consumers post as `model`.
   * @returns the annotation's full audit chain after the write.
   */
  writeVerification(id: string, evidence: VerificationEvidence, source?: AuditSource): AnnotationEvent[]
}
