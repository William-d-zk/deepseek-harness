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
  elementPath: string
  cssClasses: string
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
  elementPath?: string
  cssClasses?: string
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
  }
  anomalies: string[]
}

/** The service surface mounted on `ctx.pageFeedback`. */
export interface PageFeedbackService {
  health(): { ok: boolean; annotations: number; pending: number }
  ensureSession(origin: string, url: string): FeedbackSession
  addAnnotation(input: AddAnnotationInput, source?: AuditSource): Annotation
  pending(): Annotation[]
  get(id: string): Annotation | null
  setStatus(
    id: string,
    status: AnnotationStatus | undefined,
    reply: string | undefined,
    source?: AuditSource,
  ): Annotation
  history(id: string): AnnotationEvent[]
  watch(timeoutMs: number): Promise<Annotation[]>
  prune(olderThanMs: number): number
  /** Record verification evidence; returns the stored event count for the id. */
  writeVerification(id: string, evidence: VerificationEvidence, source?: AuditSource): AnnotationEvent[]
}
