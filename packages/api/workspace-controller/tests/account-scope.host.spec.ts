import { realpathSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { connectionAccountStorage } from '@deepseek-ai/dsh-client-connection'
import SessionStore from '@deepseek-ai/dsh-session'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import RemoteAccessService from '@deepseek-ai/dsh-api-remote-access'
import { currentConnectionAccount } from '@deepseek-ai/dsh-client-connection'
import WorkspaceRegistry from '@deepseek-ai/dsh-workspace'
import WorkspaceController from '../src/index.ts'
import { MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'

const tempDirs: string[] = []
const roots: Context[] = []

afterEach(() => {
  for (const ctx of roots.splice(0)) void ctx.fiber.dispose()
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** Run `callback` inside the dispatch scope of one logged-in account. */
function asAccount<T>(account: string, callback: () => T): T {
  return connectionAccountStorage.run({ account }, callback)
}

async function harness(admits: {
  readonly sessionAccessible: (account: string, sessionId: string) => boolean
  readonly workspaceAdmissible: (account: string, path: string) => boolean
}): Promise<{ controller: InstanceType<typeof WorkspaceController>; ctx: Context; root: string }> {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'dsh-workspace-account-scope-')))
  tempDirs.push(root)
  const ctx = new Context()
  roots.push(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend())
  const storageDomain = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', storageDomain)
  ctx.provide('storageDomain', storageDomain)
  ctx.provide('sessionPersistence', {
    list: () => Promise.resolve([]),
    delete: async () => true,
  } as never)
  await ctx.plugin(WorkspaceRegistry)
  const dispose = (): void => {}
  ctx.provide('typert', {
    lookups: { configure: () => dispose },
    contexts: { configureHost: () => dispose },
    resources: { register: vi.fn(() => dispose) },
  } as never)
  new RemoteAccessService(ctx, { currentAccount: currentConnectionAccount })
  ctx.remoteAccess.registerAccountPolicy(admits)
  const controller = new WorkspaceController(ctx, { documentsDirectory: root })
  return { controller, ctx, root }
}

describe('WorkspaceController account scope', () => {
  it('refuses workspace registration outside the account boundary', async () => {
    const { controller, root } = await harness({
      sessionAccessible: () => true,
      workspaceAdmissible: (account, path) => account === 'u1' && path === root,
    })

    await expect(asAccount('u1', () => controller.create({ path: root }))).resolves.toMatchObject({ created: true })
    await expect(asAccount('u2', () => controller.create({ path: join(root, 'Apps', 'other') })))
      .rejects.toMatchObject({ code: 'remote-access/denied' })
    await expect(asAccount('u1', () => controller.create({ path: join(root, 'Apps', 'elsewhere') })))
      .rejects.toMatchObject({ code: 'remote-access/denied' })
  })

  it('refuses session accounting operations for sessions the account does not admit', async () => {
    const { controller, ctx } = await harness({
      sessionAccessible: (account, sessionId) => account === 'u1' && sessionId === 'own',
      workspaceAdmissible: () => true,
    })
    const session = ctx.sessions.create()

    await expect(asAccount('u1', () => controller.archiveSession({ sessionId: session.id })))
      .rejects.toMatchObject({ code: 'remote-access/denied' })
    await expect(asAccount('u2', () => controller.archiveSession({ sessionId: session.id })))
      .rejects.toMatchObject({ code: 'remote-access/denied' })
  })

  it('skips the directory check for workspaces the registry does not know', async () => {
    const { controller } = await harness({
      sessionAccessible: () => true,
      workspaceAdmissible: () => true,
    })

    await expect(controller.rename({ workspaceId: 'missing' as never, title: 'nowhere' }))
      .rejects.toThrow()
  })

  it('filters the follow stream to the workspaces and sessions the account admits', async () => {
    const { controller, ctx, root } = await harness({
      sessionAccessible: account => account === 'u1',
      workspaceAdmissible: (account, path) => account === 'u1' && path === root,
    })
    await asAccount('u1', () => controller.create({ path: root }))
    const session = ctx.sessions.create()
    await asAccount('u1', () => controller.archiveSession({ sessionId: session.id }))

    const admitted = await asAccount('u1', () => controller.follow(new AbortController().signal)[Symbol.asyncIterator]().next())
    expect(admitted.value).toMatchObject({
      type: 'baseline',
      value: { items: [expect.objectContaining({ path: root })] },
    })

    const denied = await asAccount('u2', () => controller.follow(new AbortController().signal)[Symbol.asyncIterator]().next())
    expect(denied.value).toMatchObject({
      type: 'baseline',
      value: { items: [], archivedSessionIds: [], pinnedSessionIds: [] },
    })
  })
})
