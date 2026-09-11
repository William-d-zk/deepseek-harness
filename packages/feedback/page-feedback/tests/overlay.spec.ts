import { describe, expect, it } from 'vitest'
import vm from 'node:vm'
import { OVERLAY_JS, OVERLAY_MARKER } from '../src/overlay.ts'

describe('page-feedback overlay asset', () => {
  it('exports a marker and a self-contained IIFE string', () => {
    expect(OVERLAY_MARKER).toBe('__dshPageFeedback')
    expect(OVERLAY_JS).toContain('(function () {')
    expect(OVERLAY_JS).toContain('})()')
    expect(OVERLAY_JS).not.toMatch(/@alioth|AliothStudio/)
  })

  it('POSTs to the carrier annotation endpoint with elementPath + cssClasses', () => {
    expect(OVERLAY_JS).toContain("'/api/feedback/annotations'")
    expect(OVERLAY_JS).toContain('elementPath: path')
    expect(OVERLAY_JS).toContain('cssClasses:')
    expect(OVERLAY_JS).toContain('comment: comment')
    expect(OVERLAY_JS).toContain("headers: { 'Content-Type': 'application/json' }")
  })

  it('pins same-fragment siblings with :nth-child(n) so paths stay unique', () => {
    expect(OVERLAY_JS).toContain("':nth-child(' + index + ')'")
    expect(OVERLAY_JS).toContain('same > 0')
  })

  it('carries nearby text and field metadata for agent-side semantic location', () => {
    expect(OVERLAY_JS).toContain('fieldLabel')
    expect(OVERLAY_JS).toContain('fieldName')
    expect(OVERLAY_JS).toContain('nearbyText')
  })

  it('guards against double injection and derives the base URL defensively', () => {
    expect(OVERLAY_JS).toContain('window.__dshPageFeedback) return')
    expect(OVERLAY_JS).toContain('window.__dshPageFeedback = true')
    expect(OVERLAY_JS).toContain('window.location.hostname || \'localhost\'')
  })

  it('self-verifies the emitted path and escalates to forced :nth-child(n) when ambiguous', () => {
    expect(OVERLAY_JS).toContain('resolveElementPath')
    expect(OVERLAY_JS).toContain('matchesTarget')
    expect(OVERLAY_JS).toContain('forceIndex || same > 0')
    expect(OVERLAY_JS).toContain('second.matches > 0')
  })

  it('encodes shadow/frame boundaries with the shared marker protocol', () => {
    expect(OVERLAY_JS).toContain("' >>> '")
    expect(OVERLAY_JS).toContain("' |> '")
    expect(OVERLAY_JS).toContain('/\\s*(?:>>>|\\|>)\\s*/')
    expect(OVERLAY_JS).toContain('MAX_PATH_DEPTH = 64')
  })

  it('descends every non-final boundary hop through shadowRoot / contentDocument', () => {
    expect(OVERLAY_JS).toContain('matches[0].shadowRoot')
    expect(OVERLAY_JS).toContain('matches[0].contentDocument')
    expect(OVERLAY_JS).toContain('matches.length !== 1')
  })

  it('offers a re-render-stable attribute anchor in candidate order', () => {
    expect(OVERLAY_JS).toContain("['data-testid', 'data-test', 'data-qa']")
    expect(OVERLAY_JS).toContain("attrLit('aria-label'")
    expect(OVERLAY_JS).toContain('stableSelector(target)')
  })

  it('reads table row/column semantics for grid targets', () => {
    expect(OVERLAY_JS).toContain("closest('tr')")
    expect(OVERLAY_JS).toContain('colSpan')
    expect(OVERLAY_JS).toContain('tHead')
    expect(OVERLAY_JS).toContain('meta.columnHeader')
    expect(OVERLAY_JS).toContain('meta.rowKey')
  })

  it('collects the React key chain best-effort', () => {
    expect(OVERLAY_JS).toContain('__reactFiber$')
    expect(OVERLAY_JS).toContain('payload.reactKeyPath = keyPath')
  })

  it('records the scroll/viewport frame the bounding box lives in', () => {
    expect(OVERLAY_JS).toContain('payload.scroll = {')
    expect(OVERLAY_JS).toContain('payload.viewport = {')
    expect(OVERLAY_JS).toContain('target.ownerDocument && target.ownerDocument.defaultView')
  })

  it('POSTs the self-verification verdict and the optional semantic anchors', () => {
    expect(OVERLAY_JS).toContain('pathMatchCount: resolution.matchCount')
    expect(OVERLAY_JS).toContain('pathMatchesTarget: resolution.matchesTarget')
    expect(OVERLAY_JS).toContain('if (anchors) payload.stableSelector = anchors')
    expect(OVERLAY_JS).toContain('if (table.rowKey) payload.rowKey = table.rowKey')
  })

  it('picks the composed-path target and ignores its own chrome', () => {
    expect(OVERLAY_JS).toContain('event.composedPath ? event.composedPath()[0] : event.target')
    expect(OVERLAY_JS).toContain("target.closest('.afb-box,.afb-hint,.afb-toast')")
  })

  it('is syntactically valid JavaScript (parses in a bare vm context)', () => {
    // The string references DOM globals at runtime, but parse-only succeeds in
    // a pristine context — catches template-literal escapes that would break
    // the served overlay.
    expect(() => new vm.Script(OVERLAY_JS)).not.toThrow()
  })
})
