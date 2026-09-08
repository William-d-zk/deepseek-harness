import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { apply, defaultDbPath } from '../src/index.ts'

const envBackup = process.env.DSH_PAGE_FEEDBACK_DB_PATH
const roots: string[] = []

afterEach(() => {
  if (envBackup === undefined) delete process.env.DSH_PAGE_FEEDBACK_DB_PATH
  else process.env.DSH_PAGE_FEEDBACK_DB_PATH = envBackup
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true })
})

function freshRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'pf-ctx-'))
  roots.push(root)
  return root
}

describe('page-feedback plugin', () => {
  it('apply mounts ctx.pageFeedback with an explicit dbPath', async () => {
    const ctx = new Context()
    const dir = freshRoot()
    try {
      const fiber = await ctx.plugin((c: Context, config: { dbPath?: string }) => { apply(c, config) }, {
        dbPath: join(dir, 'f.db'),
      })
      const store = ctx.pageFeedback
      expect(store.health().ok).toBe(true)
      const ann = store.addAnnotation({ origin: 'o', url: 'u', comment: 'x' })
      expect(store.get(ann.id)?.comment).toBe('x')
      await fiber.dispose()
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('apply falls back to env then the per-user default', async () => {
    const ctx = new Context()
    const dir = freshRoot()
    process.env.DSH_PAGE_FEEDBACK_DB_PATH = join(dir, 'env.db')
    try {
      const fiber = await ctx.plugin((c: Context, config: { dbPath?: string }) => { apply(c, config) }, {})
      expect(ctx.pageFeedback.health().ok).toBe(true)
      await fiber.dispose()
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('apply uses the per-user default when neither config nor env is set', async () => {
    const ctx = new Context()
    delete process.env.DSH_PAGE_FEEDBACK_DB_PATH
    try {
      const fiber = await ctx.plugin((c: Context, config: { dbPath?: string }) => { apply(c, config) }, {})
      expect(ctx.pageFeedback.health().ok).toBe(true)
      await fiber.dispose()
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('defaultDbPath points under the per-user .dsh dir', () => {
    const p = defaultDbPath()
    expect(p.endsWith('feedback-page.db')).toBe(true)
    expect(p.includes('.dsh')).toBe(true)
  })
})
