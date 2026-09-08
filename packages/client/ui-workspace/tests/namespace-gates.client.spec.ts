// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { workspaceNamespaceFilter, workspacePathInNamespace } from '../src/client/navigation.ts'

// The gate flags are deployment opt-in: the dsh-alioth web gate script writes
// them; these tests pin the default-off reading and the namespace matching
// the workspace lists rely on.
afterEach(() => {
  globalThis.localStorage.clear()
})

describe('workspacePathInNamespace', () => {
  it('matches the namespace as a whole path segment', () => {
    expect(workspacePathInNamespace('/apps/ns1/alpha', 'ns1')).toBe(true)
    expect(workspacePathInNamespace('/apps/ns1', 'ns1')).toBe(true)
    expect(workspacePathInNamespace('/ns1/alpha', 'ns1')).toBe(true)
  })

  it('rejects neighbors that only share a segment prefix or suffix', () => {
    expect(workspacePathInNamespace('/apps/ns1extra/alpha', 'ns1')).toBe(false)
    expect(workspacePathInNamespace('/apps/xns1/alpha', 'ns1')).toBe(false)
    expect(workspacePathInNamespace('/apps/ns1x', 'ns1')).toBe(false)
  })

  it('rejects paths outside the namespace and the empty path', () => {
    expect(workspacePathInNamespace('/apps/other/alpha', 'ns1')).toBe(false)
    expect(workspacePathInNamespace('', 'ns1')).toBe(false)
  })
})

describe('workspaceNamespaceFilter', () => {
  it('stays off while the deployment flag is unset or blank', () => {
    expect(workspaceNamespaceFilter()).toBeUndefined()
    globalThis.localStorage.setItem('dsh.uiWorkspace.namespaceFilter', '')
    expect(workspaceNamespaceFilter()).toBeUndefined()
  })

  it('returns the caller namespace once the gate script records it', () => {
    globalThis.localStorage.setItem('dsh.uiWorkspace.namespaceFilter', 'ns1')
    expect(workspaceNamespaceFilter()).toBe('ns1')
  })
})
