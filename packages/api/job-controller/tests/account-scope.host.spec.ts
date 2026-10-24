import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import { unsupportedInbox } from '@deepseek-ai/dsh-agent-loop-testkit'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { JobId } from '@deepseek-ai/dsh-jobs'
import LocalJobRegistry from '@deepseek-ai/dsh-jobs-local'
import SessionStore from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import type { Session } from '@deepseek-ai/dsh-session'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { describe, expect, it } from 'vitest'
import { JobController } from '../src/index.ts'

async function registerAgent(ctx: Context, session: Session): Promise<Agent> {
  const agent = {
    id: session.id,
    session,
    inbox: unsupportedInbox(),
    status: 'idle',
    ctx,
  } as Agent
  await ctx.agents.register(agent)
  return agent
}

async function harness(admitsSession: (sessionId: string) => boolean): Promise<{
  ctx: Context
  session: Session
  agent: Agent
  controller: JobController
}> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(LocalJobRegistry)
  ctx.jobs.attachController('account-scope-test')
  await ctx.plugin(TypertRegistry)
  await ctx.plugin(JobController, {})
  ctx.provide('remoteAccess', { admitsSession } as never)
  const session = ctx.sessions.create()
  const agent = await registerAgent(ctx, session)
  return { ctx, session, agent, controller: ctx.jobController }
}

describe('JobController account scope', () => {
  it('denies roster, output, and kill for a session the policy does not admit', async () => {
    const { controller, session } = await harness(() => false)

    expect(() => controller.list({ sessionId: session.id }, new AbortController().signal)).toThrow(
      expect.objectContaining({ code: 'remote-access/denied' }),
    )
    expect(() => controller.follow({ sessionId: session.id, jobId: JobId('job-1') }, new AbortController().signal)).toThrow(
      expect.objectContaining({ code: 'remote-access/denied' }),
    )
    expect(() => controller.kill({ sessionId: session.id, jobId: JobId('job-1') })).toThrow(
      expect.objectContaining({ code: 'remote-access/denied' }),
    )
  })

  it('lets an admitted session run the same fenced reads', async () => {
    const { controller, session } = await harness(() => true)

    const frames = controller.list({ sessionId: session.id }, new AbortController().signal)
    const first = await frames[Symbol.asyncIterator]().next()
    expect(first.value).toMatchObject({ type: 'rows', jobs: [] })
  })
})
