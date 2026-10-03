import { describe, expect, it } from 'vitest'
import { builtDeclarationPath } from './doc-typecheck-paths.ts'

describe('builtDeclarationPath', () => {
  it('maps package source directories and exact entry files to built declarations', () => {
    expect(builtDeclarationPath('./packages/*/*/src')).toBe('./packages/*/*/lib/types')
    expect(builtDeclarationPath('./packages/runtime-diagnostics/invariants/src/index.ts'))
      .toBe('./packages/runtime-diagnostics/invariants/lib/types/index.d.ts')
    expect(builtDeclarationPath('./packages/core/session/src/invariant.ts'))
      .toBe('./packages/core/session/lib/types/invariant.d.ts')
  })

  it('keeps aliases pinned into this checkout install (node_modules) as-is', () => {
    expect(builtDeclarationPath('./apps/web/node_modules/playwright'))
      .toBe('./apps/web/node_modules/playwright')
    expect(builtDeclarationPath('./node_modules/vitest')).toBe('./node_modules/vitest')
  })

  it('rejects aliases without a supported source target', () => {
    expect(() => builtDeclarationPath('./packages/runtime-diagnostics/invariants/source/index.ts'))
      .toThrow('cannot map workspace source path')
  })
})
