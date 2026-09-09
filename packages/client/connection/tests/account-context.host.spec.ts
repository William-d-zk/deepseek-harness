/** Behavior of the host-login account context (resolver + dispatch scope). */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { currentConnectionAccount, connectionAccountStorage, withResolvedAccount } from '../src/account-context.ts'
import { HostConnectionService } from '../src/rpc-host.ts'

describe('account context scope', () => {
  it('defaults to null outside any dispatch', () => {
    expect(currentConnectionAccount()).toBe(null)
  })

  it('carries the resolved account through async work inside the scope', async () => {
    let observedDuring: string | null = 'unset'
    await withResolvedAccount({ cookie: 'alioth_session=abc' }, (headers) => {
      expect(headers.cookie).toBe('alioth_session=abc')
      return 'U-demo'
    }, async () => {
      observedDuring = currentConnectionAccount()
      await Promise.resolve()
      expect(currentConnectionAccount()).toBe('U-demo')
    })
    expect(observedDuring).toBe('U-demo')
    expect(currentConnectionAccount()).toBe(null)
  })

  it('scopes null when no resolver is registered', async () => {
    await withResolvedAccount({}, undefined, () => {
      expect(currentConnectionAccount()).toBe(null)
      return Promise.resolve()
    })
  })

  it('tolerates a throwing or rejecting resolver as anonymous', async () => {
    await withResolvedAccount({}, () => { throw new Error('resolver exploded') }, () => {
      expect(currentConnectionAccount()).toBe(null)
      return Promise.resolve()
    })
    await withResolvedAccount({}, () => Promise.reject(new Error('async exploded')), () => {
      expect(currentConnectionAccount()).toBe(null)
      return Promise.resolve()
    })
  })

  it('runs concurrent dispatches with independent accounts (no cross-talk)', async () => {
    const seen: string[] = []
    await Promise.all(['U-a', 'U-b'].map(account =>
      withResolvedAccount({}, () => account, async () => {
        await new Promise(resolve => setTimeout(resolve, Math.random() * 5))
        seen.push(currentConnectionAccount() ?? 'null')
      })))
    expect(seen.sort()).toEqual(['U-a', 'U-b'])
  })

  it('supports manual scoping for tests and host callers', async () => {
    await connectionAccountStorage.run({ account: 'U-manual' }, async () => {
      expect(currentConnectionAccount()).toBe('U-manual')
    })
  })
})

describe('HostConnectionService account resolver registration', () => {
  function service(): HostConnectionService {
    const ctx = new Context()
    return new HostConnectionService(ctx, ['127.0.0.1'], undefined as never)
  }

  it('resolves null before any registration', async () => {
    expect(await service().resolveAccount({ cookie: 'alioth_session=abc' })).toBe(null)
  })

  it('uses the registered resolver and clears it on disposal', async () => {
    const s = service()
    const dispose = s.registerAccountResolver((headers) => {
      const token = headers.cookie?.split('alioth_session=')[1]
      return token === 'secret' ? 'U-isahl' : null
    })
    expect(await s.resolveAccount({ cookie: 'alioth_session=secret' })).toBe('U-isahl')
    expect(await s.resolveAccount({ cookie: 'alioth_session=other' })).toBe(null)
    dispose()
    expect(await s.resolveAccount({ cookie: 'alioth_session=secret' })).toBe(null)
  })

  it('accepts async resolvers', async () => {
    const s = service()
    s.registerAccountResolver(async headers =>
      (await Promise.resolve(headers.cookie))?.includes('alioth_user=isahl') ? 'U-isahl' : null)
    expect(await s.resolveAccount({ cookie: 'alioth_user=isahl' })).toBe('U-isahl')
    expect(await s.resolveAccount({ cookie: 'alioth_user=demoadmin' })).toBe(null)
  })

  it('a later registration replaces the earlier one', async () => {
    const s = service()
    const first = s.registerAccountResolver(() => 'U-first')
    const second = s.registerAccountResolver(() => 'U-second')
    expect(await s.resolveAccount({})).toBe('U-second')
    first()
    // Disposing the replaced resolver must not clear the active one.
    expect(await s.resolveAccount({})).toBe('U-second')
    second()
    expect(await s.resolveAccount({})).toBe(null)
  })
})
