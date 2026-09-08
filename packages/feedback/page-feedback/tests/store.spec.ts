import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPageFeedbackStore } from '../src/store.ts'
import type { PageFeedbackService } from '../src/index.ts'

function freshStore(): PageFeedbackService {
  const dir = mkdtempSync(join(tmpdir(), 'page-feedback-'))
  return createPageFeedbackStore(join(dir, 'feedback.db'))
}

describe('page-feedback store', () => {
  it('sessions are idempotent per (origin, url); annotations land pending', () => {
    const store = freshStore()
    const a = store.ensureSession('http://localhost:3100', 'http://localhost:3100/page')
    const b = store.ensureSession('http://localhost:3100', 'http://localhost:3100/page')
    expect(b.id).toBe(a.id)
    const ann = store.addAnnotation({ origin: a.origin, url: a.url, comment: '按钮间距' })
    expect(ann.status).toBe('pending')
    expect(ann.sessionId).toBe(a.id)
    expect(store.health().pending).toBe(1)
  })

  it('rejects blank comments', () => {
    const store = freshStore()
    expect(() =>
      store.addAnnotation({ origin: 'o', url: 'u', comment: '   ' }),
    ).toThrow(/comment must not be empty/)
  })

  it('state machine: pending→ack→resolved; terminal has no exits; idempotent same-status', () => {
    const store = freshStore()
    const ann = store.addAnnotation({ origin: 'o', url: 'u', comment: 'c' })
    const acked = store.setStatus(ann.id, 'acknowledged', '处理中', 'model')
    expect(acked.status).toBe('acknowledged')
    // same-status PATCH is idempotent — no status_changed event
    store.setStatus(ann.id, 'acknowledged', undefined, 'model')
    const resolved = store.setStatus(ann.id, 'resolved', '已修复', 'model')
    expect(resolved.status).toBe('resolved')
    expect(() => store.setStatus(ann.id, 'pending', undefined, 'model')).toThrow(/not an allowed transition/)
  })

  it('audit chain records created / status_changed / reply_written with attribution', () => {
    const store = freshStore()
    const ann = store.addAnnotation({ origin: 'o', url: 'u', comment: 'c' }, 'browser')
    store.setStatus(ann.id, 'acknowledged', '处理中', 'model')
    store.setStatus(ann.id, 'resolved', '已修复：对齐', 'cli')
    const events = store.history(ann.id)
    const kinds = events.map(e => e.kind)
    expect(kinds[0]).toBe('created')
    expect(kinds).toContain('status_changed')
    expect(kinds).toContain('reply_written')
    const created = events.find(e => e.kind === 'created')
    expect(created?.source).toBe('browser')
    const replies = events.filter(e => e.kind === 'reply_written')
    expect(replies).toHaveLength(2)
    expect(replies[1]?.from).toBe('处理中')
    expect(replies[1]?.to).toBe('已修复：对齐')
    expect(replies[1]?.source).toBe('cli')
  })

  it('history is chronological and verification write keeps prior snapshot', () => {
    const store = freshStore()
    const ann = store.addAnnotation({ origin: 'o', url: 'u', comment: 'c' })
    store.writeVerification(ann.id, { mode: 'capture', evidenceDir: '/e1', files: [], exitCode: 0, anomalies: [] }, 'cli')
    store.writeVerification(ann.id, { mode: 'capture', evidenceDir: '/e2', files: ['a.png'], exitCode: 0, anomalies: [] }, 'cli')
    const events = store.history(ann.id)
    const vEvents = events.filter(e => e.kind === 'verification_written')
    expect(vEvents).toHaveLength(2)
    expect(vEvents[0]?.to).toContain('/e1')
    expect(vEvents[1]?.from).toContain('/e1')
    expect(vEvents[1]?.to).toContain('/e2')
    // chronological order
    for (let i = 1; i < events.length; i++) {
      expect(events[i]!.at).toBeGreaterThanOrEqual(events[i - 1]!.at)
    }
  })

  it('watch resolves early on a new annotation and times out to the current batch', async () => {
    const store = freshStore()
    const pending = store.watch(60_000)
    store.addAnnotation({ origin: 'o', url: 'u', comment: 'n1' })
    const batch = await pending
    expect(batch.some(a => a.comment === 'n1')).toBe(true)
    const timedOut = await store.watch(10)
    expect(Array.isArray(timedOut)).toBe(true)
  })

  it('prune drops only terminal annotations older than the cutoff', () => {
    const store = freshStore()
    const a = store.addAnnotation({ origin: 'o', url: 'u', comment: 'old resolved' })
    const b = store.addAnnotation({ origin: 'o', url: 'u', comment: 'pending kept' })
    store.setStatus(a.id, 'resolved', undefined, 'model')
    const pruned = store.prune(24 * 3600 * 1000)
    expect(pruned).toBe(0) // nothing older than 24h yet
    expect(store.get(b.id)).not.toBeNull()
  })

  it('setStatus on missing id throws; get returns null for unknown', () => {
    const store = freshStore()
    expect(store.get('nope')).toBeNull()
    expect(() => store.setStatus('nope', 'resolved', undefined, 'model')).toThrow(/not found/)
  })

  it('prune removes stale terminal rows by updated_at', () => {
    const store = freshStore()
    // add + resolve, then simulate staleness by resolving with an old cutoff impossible path:
    // prune(0) removes everything terminal regardless of age
    const a = store.addAnnotation({ origin: 'o', url: 'u', comment: 'x' })
    store.setStatus(a.id, 'dismissed', 'wontfix', 'model')
    expect(store.prune(0)).toBe(1)
    expect(store.get(a.id)).toBeNull()
  })

  it('addAnnotation honours an explicit sessionId; pending() lists current batch', () => {
    const store = freshStore()
    const sess = store.ensureSession('http://o', 'http://o/p')
    const ann = store.addAnnotation({
      sessionId: sess.id,
      origin: 'http://o',
      url: 'http://o/p',
      comment: 'explicit session',
      element: 'button',
      elementPath: 'body > button',
      cssClasses: 'btn',
    })
    expect(ann.sessionId).toBe(sess.id)
    expect(ann.element).toBe('button')
    const pending = store.pending()
    expect(pending.length).toBeGreaterThanOrEqual(1)
    expect(pending.some(x => x.id === ann.id)).toBe(true)
    expect(store.health().annotations).toBeGreaterThanOrEqual(1)
  })

  it('writeVerification on a missing id throws', () => {
    const store = freshStore()
    expect(() =>
      store.writeVerification('missing', { mode: 'capture', evidenceDir: '/x', files: [], exitCode: 0, anomalies: [] }),
    ).toThrow(/not found/)
  })

  it('reply-only setStatus keeps status and records reply_written', () => {
    const store = freshStore()
    const ann = store.addAnnotation({ origin: 'o', url: 'u', comment: 'c' })
    const updated = store.setStatus(ann.id, undefined, 'note only', 'cli')
    expect(updated.status).toBe('pending')
    expect(updated.reply).toBe('note only')
    const kinds = store.history(ann.id).map(e => e.kind)
    expect(kinds).toContain('reply_written')
  })
})
