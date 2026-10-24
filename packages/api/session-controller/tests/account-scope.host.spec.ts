import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import { connectionAccountStorage } from '@deepseek-ai/dsh-client-connection'
import SessionStore from '@deepseek-ai/dsh-session'
import { describe, expect, it, onTestFinished } from 'vitest'
import { createSessionTestController } from './test-remote.ts'

/** Run `callback` inside the dispatch scope of one logged-in account. */
function asAccount<T>(account: string, callback: () => T): T {
  return connectionAccountStorage.run({ account }, callback)
}

async function context(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  onTestFinished(() => ctx.fiber.dispose())
  return ctx
}

const defaults = {
  defaultModelSelection: () => ({ provider: 'p', model: 'm' }),
  cwd: '/default',
}

describe('SessionController account scope', () => {
  it('denies point operations for an account the policy does not admit', async () => {
    const ctx = await context()
    const controller = createSessionTestController(ctx, defaults)
    const session = ctx.sessions.create()
    ctx.remoteAccess.registerAccountPolicy({
      sessionAccessible: (account, sessionId) => account === 'u1' && sessionId === String(session.id),
      workspaceAdmissible: () => true,
    })

    await expect(asAccount('u1', () => controller.projections({ sessionId: session.id }, new AbortController().signal)))
      .resolves.toMatchObject({ kind: 'sequenced' })
    await expect(asAccount('u2', () => controller.projections({ sessionId: session.id }, new AbortController().signal)))
      .rejects.toMatchObject({ code: 'remote-access/denied', details: { reason: 'account-scope' } })
  })

  it('guards every session-addressed read and write', async () => {
    const ctx = await context()
    const controller = createSessionTestController(ctx, defaults)
    const session = ctx.sessions.create()
    ctx.remoteAccess.registerAccountPolicy({
      sessionAccessible: () => false,
      workspaceAdmissible: () => true,
    })

    asAccount('u2', () => {
      expect(() => controller.cancel({ sessionId: session.id })).toThrow(
        expect.objectContaining({ code: 'remote-access/denied' }),
      )
      expect(() => controller.follow({
        address: { kind: 'session', sessionId: session.id },
      }, new AbortController().signal)).toThrow(
        expect.objectContaining({ code: 'remote-access/denied' }),
      )
    })
    asAccount('u2', () => {
      expect(() => controller.page({
        address: { kind: 'session', sessionId: session.id },
        throughSeq: 0,
      }, new AbortController().signal)).toThrow(
        expect.objectContaining({ code: 'remote-access/denied' }),
      )
    })
  })

  it('filters list and search rows to the sessions the account admits', async () => {
    const ctx = await context()
    const controller = createSessionTestController(ctx, defaults)
    const session = ctx.sessions.create()
    ctx.remoteAccess.registerAccountPolicy({
      sessionAccessible: (account, sessionId) => account === 'u1' && sessionId === String(session.id),
      workspaceAdmissible: () => true,
    })

    const seen = asAccount('u1', () => controller.list({}, new AbortController().signal))
    await expect(seen).resolves.toEqual({ items: [expect.objectContaining({ sessionId: session.id })] })
    await expect(asAccount('u2', () => controller.list({}, new AbortController().signal))).resolves.toEqual({ items: [] })
    await expect(asAccount('u2', () => controller.search({ query: 'anything' }, new AbortController().signal)))
      .resolves.toMatchObject({ items: [] })
  })

  it('hands the workspace hint to the policy for unmirrored sessions', async () => {
    const ctx = await context()
    const session = ctx.sessions.create()
    ctx.provide('workspaceRegistry', {
      list: () => [{ path: '/ws/alice/app', sessionIds: [session.id] }],
    } as never)
    const controller = createSessionTestController(ctx, defaults)
    ctx.remoteAccess.registerAccountPolicy({
      sessionAccessible: (account, _sessionId, hints) => account === 'U-alice' && hints?.workspacePath === '/ws/alice/app',
      workspaceAdmissible: () => true,
    })

    await expect(asAccount('U-alice', () => controller.projections({ sessionId: session.id }, new AbortController().signal)))
      .resolves.toBeDefined()
    await expect(asAccount('U-bob', () => controller.projections({ sessionId: session.id }, new AbortController().signal)))
      .rejects.toMatchObject({ code: 'remote-access/denied' })
  })

  it('honors the desktop-open deployment switch', async () => {
    const ctx = await context()
    const controller = createSessionTestController(ctx, { ...defaults, openWorkspacePath: false })

    expect(controller.canOpenWorkspacePath()).toBe(false)
    await expect(controller.openWorkspacePath({ path: '/workspace/report.html' }, new AbortController().signal))
      .rejects.toMatchObject({ code: 'session/desktop-open-disabled' })
    await expect(controller.workspacePathApplications({ path: '/file.mp3' }, new AbortController().signal))
      .resolves.toEqual([])
  })

  it('honors the default-model-initialization deployment switch', async () => {
    const ctx = await context()
    const controller = createSessionTestController(ctx, { ...defaults, initializeDefaultModel: false })

    await expect(controller.initializeDefaultModel())
      .rejects.toMatchObject({ code: 'session/default-model-init-disabled' })
  })
})
