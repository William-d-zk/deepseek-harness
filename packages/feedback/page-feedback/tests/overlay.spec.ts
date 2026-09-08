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

  it('is syntactically valid JavaScript (parses in a bare vm context)', () => {
    // The string references DOM globals at runtime, but parse-only succeeds in
    // a pristine context — catches template-literal escapes that would break
    // the served overlay.
    expect(() => new vm.Script(OVERLAY_JS)).not.toThrow()
  })
})
