import { Hono } from 'hono'
import { registerChatStreamRoutes } from '../stream'
import {
  cancelResearchPlanApprovalsForSession,
  registerResearchPlanApproval,
  waitForResearchPlanApproval,
} from '../../research-plan-approval'

jest.mock('../../../../middleware/auth', () => ({
  actorMiddleware: async (c: any, next: any) => {
    c.set('actor', {
      type: 'user',
      id: 1,
      role: 'USER',
      status: 'ACTIVE',
      username: 'tester',
      identifier: 'user:1',
    })
    await next()
  },
}))

const makeApp = () => {
  const app = new Hono()
  registerChatStreamRoutes(
    app,
    {
      prisma: {
        message: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      },
      chatService: {},
      chatRequestBuilder: {},
      reasoningCompatibilityService: {},
      providerRequester: {},
      nonStreamFallbackService: {},
      assistantProgressService: {},
      streamUsageService: {},
      streamTraceService: {},
      streamSseService: {},
      conversationCompressionService: {},
      visionProxyService: {},
    } as any,
  )
  return app
}

beforeEach(() => {
  cancelResearchPlanApprovalsForSession(1)
})

describe('POST /stream/research-plan/respond', () => {
  it('approves a pending plan for the owning actor', async () => {
    const entry = registerResearchPlanApproval({
      sessionId: 1,
      actorId: 'user:1',
      toolCallId: 'call-route-1',
      messageId: 10,
    })
    const waiting = waitForResearchPlanApproval(entry, { timeoutMs: 5000 })
    const app = makeApp()

    const res = await app.request('http://localhost/stream/research-plan/respond', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionId: 1,
        toolCallId: 'call-route-1',
        decision: 'approve',
      }),
    })

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ success: true })
    await expect(waiting).resolves.toMatchObject({ decision: 'approve' })
  })

  it('rejects adjust without feedback at schema level', async () => {
    const app = makeApp()
    const res = await app.request('http://localhost/stream/research-plan/respond', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionId: 1,
        toolCallId: 'call-missing',
        decision: 'adjust',
      }),
    })

    expect(res.status).toBe(400)
  })

  it('returns 404 for unknown approvals', async () => {
    const app = makeApp()
    const res = await app.request('http://localhost/stream/research-plan/respond', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionId: 1,
        toolCallId: 'call-missing',
        decision: 'cancel',
      }),
    })

    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toMatchObject({
      success: false,
      error: expect.any(String),
    })
  })
})
