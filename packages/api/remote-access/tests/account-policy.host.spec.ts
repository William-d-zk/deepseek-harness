import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { connectionAccountStorage, currentConnectionAccount } from '@deepseek-ai/dsh-client-connection'
import RemoteAccessService, { type RemoteAccountPolicy } from '../src/index.ts'

/** Run `callback` inside the dispatch scope of one logged-in account. */
function asAccount<T>(account: string, callback: () => T): T {
  return connectionAccountStorage.run({ account }, callback)
}

function service(internals?: { readonly currentAccount?: () => string | null }): {
  readonly access: RemoteAccessService
  readonly dispose: () => Promise<void>
} {
  const ctx = new Context()
  const access = new RemoteAccessService(ctx, internals)
  return { access, dispose: () => ctx.fiber.dispose() }
}

function policy(overrides: Partial<RemoteAccountPolicy> = {}): RemoteAccountPolicy {
  return {
    sessionAccessible: () => true,
    workspaceAdmissible: () => true,
    ...overrides,
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('remoteAccess.registerAccountPolicy', () => {
  it('registers one policy and removes it with the disposer', async () => {
    const { access, dispose } = service({ currentAccount: () => 'u1' })
    const disposePolicy = access.registerAccountPolicy(policy({ sessionAccessible: () => false }))
    expect(asAccount('u1', () => access.admitsSession('s-1'))).toBe(false)
    disposePolicy()
    expect(asAccount('u1', () => access.admitsSession('s-1'))).toBe(true)
    await dispose()
  })

  it('refuses a second registration', async () => {
    const { access, dispose } = service()
    access.registerAccountPolicy(policy())
    expect(() => access.registerAccountPolicy(policy())).toThrow('already registered')
    await dispose()
  })

  it('survives disposal of an unregistered policy handle', async () => {
    const { access, dispose } = service()
    const disposePolicy = access.registerAccountPolicy(policy())
    disposePolicy()
    disposePolicy()
    await dispose()
  })
})

describe('remoteAccess.admitsSession', () => {
  it('allows dispatches without a login account and deployments without a policy', async () => {
    const unscoped = service({ currentAccount: () => null })
    unscoped.access.registerAccountPolicy(policy({ sessionAccessible: () => false }))
    expect(unscoped.access.admitsSession('s-1')).toBe(true)
    await unscoped.dispose()

    const { access, dispose } = service({ currentAccount: () => 'u1' })
    expect(asAccount('u1', () => access.admitsSession('s-1'))).toBe(true)
    await dispose()
  })

  it('asks the policy with the dispatch account and its answer decides', async () => {
    // The real connection account context scopes every call, so two
    // dispatches of different accounts get different answers for one Session.
    // The reader is injected synchronously; the default reader's module load
    // has its own test below.
    const { access, dispose } = service({ currentAccount: currentConnectionAccount })
    access.registerAccountPolicy(policy({
      sessionAccessible: (account, sessionId) => account === 'u1' && sessionId === 'own',
    }))
    expect(asAccount('u1', () => access.admitsSession('own'))).toBe(true)
    expect(asAccount('u1', () => access.admitsSession('other'))).toBe(false)
    expect(asAccount('u2', () => access.admitsSession('own'))).toBe(false)
    await dispose()
  })

  it('denies fail-closed when the policy throws', async () => {
    const { access, dispose } = service({ currentAccount: () => 'u1' })
    access.registerAccountPolicy(policy({ sessionAccessible: () => { throw new Error('policy blew up') } }))
    expect(asAccount('u1', () => access.admitsSession('s-1'))).toBe(false)
    await dispose()
  })

  it('reads the connection account context once its module has loaded', async () => {
    const { access, dispose } = service()
    access.registerAccountPolicy(policy({ sessionAccessible: () => false }))
    await new Promise((resolve) => { setTimeout(resolve, 0) })
    expect(access.admitsSession('s-1')).toBe(true)
    expect(asAccount('u1', () => access.admitsSession('s-1'))).toBe(false)
    await dispose()
  })
})

describe('remoteAccess.admitsWorkspacePath', () => {
  it('allows dispatches without a login account and deployments without a policy', async () => {
    const unscoped = service({ currentAccount: () => null })
    unscoped.access.registerAccountPolicy(policy({ workspaceAdmissible: () => false }))
    expect(unscoped.access.admitsWorkspacePath('/w')).toBe(true)
    await unscoped.dispose()

    const { access, dispose } = service({ currentAccount: () => 'u1' })
    expect(asAccount('u1', () => access.admitsWorkspacePath('/w'))).toBe(true)
    await dispose()
  })

  it('asks the policy with the dispatch account and its answer decides', async () => {
    const { access, dispose } = service({ currentAccount: () => 'u1' })
    const seen: Array<[string, string]> = []
    access.registerAccountPolicy(policy({
      workspaceAdmissible: (account, path) => {
        seen.push([account, path])
        return path === '/admitted'
      },
    }))
    expect(asAccount('u1', () => access.admitsWorkspacePath('/admitted'))).toBe(true)
    expect(asAccount('u1', () => access.admitsWorkspacePath('/elsewhere'))).toBe(false)
    expect(seen).toEqual([['u1', '/admitted'], ['u1', '/elsewhere']])
    await dispose()
  })

  it('denies fail-closed when the policy throws', async () => {
    const { access, dispose } = service({ currentAccount: () => 'u1' })
    access.registerAccountPolicy(policy({ workspaceAdmissible: () => { throw new Error('down') } }))
    expect(asAccount('u1', () => access.admitsWorkspacePath('/w'))).toBe(false)
    await dispose()
  })
})
