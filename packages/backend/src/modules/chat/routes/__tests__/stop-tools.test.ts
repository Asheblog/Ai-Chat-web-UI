import { Hono } from 'hono'
import { registerChatStreamRoutes } from '../stream'
import {
  getStreamMetaByKey,
  registerStreamMeta,
  releaseStreamMeta,
  updateStreamMetaController,
} from '../../stream-state'

const mockActorState = {
  current: {
    type: 'user',
    id: 1,
    role: 'USER',
    status: 'ACTIVE',
    username: 'tester',
    identifier: 'user:1',
  } as Record<string, unknown>,
}

jest.mock('../../../../middleware/auth', () => ({
  actorMiddleware: async (c: any, next: any) => {
    c.set('actor', mockActorState.current)
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
    } as any,
  )
  return app
}

const postStopTools = (app: Hono, body: Record<string, unknown>) =>
  app.request('http://localhost/stream/stop-tools', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

const registerLiveRun = (params?: {
  sessionId?: number
  actorIdentifier?: string
  clientMessageId?: string
  assistantMessageId?: number
}) => {
  const meta = registerStreamMeta({
    sessionId: params?.sessionId ?? 11,
    actorIdentifier: params?.actorIdentifier ?? 'user:1',
    clientMessageId: params?.clientMessageId ?? 'client-stop-1',
    assistantMessageId: params?.assistantMessageId ?? 101,
  })
  if (!meta) throw new Error('failed to register stream meta')
  const controller = new AbortController()
  updateStreamMetaController(meta, controller)
  return { meta, controller }
}

beforeEach(() => {
  mockActorState.current = {
    type: 'user',
    id: 1,
    role: 'USER',
    status: 'ACTIVE',
    username: 'tester',
    identifier: 'user:1',
  }
})

describe('POST /stream/stop-tools', () => {
  it('accepts the stop for the live run without cancelling it', async () => {
    const { meta, controller } = registerLiveRun()
    const app = makeApp()

    const res = await postStopTools(app, { sessionId: 11, clientMessageId: 'client-stop-1' })

    expect(res.status).toBe(200)
    const payload = await res.json()
    expect(payload).toMatchObject({
      success: true,
      data: {
        accepted: true,
        reason: 'stop_tools',
        target: { sessionId: 11, clientMessageId: 'client-stop-1', streamKey: meta.streamKey, via: 'active' },
      },
    })
    expect(meta.stopToolsRequested).toBe(true)
    expect(meta.cancelled).toBe(false)
    expect(controller.signal.aborted).toBe(false)
    releaseStreamMeta(meta)
  })

  it('is idempotent while the same run stays active', async () => {
    const { meta } = registerLiveRun({ clientMessageId: 'client-stop-2', assistantMessageId: 102 })
    const app = makeApp()

    await postStopTools(app, { sessionId: 11, clientMessageId: 'client-stop-2' })
    const res = await postStopTools(app, { sessionId: 11, clientMessageId: 'client-stop-2' })

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      success: true,
      data: { accepted: true, reason: 'already_requested' },
    })
    releaseStreamMeta(meta)
  })

  it('reports no active run after the run finished and never touches later runs', async () => {
    const { meta } = registerLiveRun({ clientMessageId: 'client-stop-3', assistantMessageId: 103 })
    releaseStreamMeta(meta)
    const app = makeApp()

    const res = await postStopTools(app, { sessionId: 11, clientMessageId: 'client-stop-3' })

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      success: true,
      data: { accepted: false, reason: 'no_active_run' },
    })

    const next = registerLiveRun({ clientMessageId: 'client-stop-3', assistantMessageId: 104 })
    expect(next.meta.stopToolsRequested).toBe(false)
    releaseStreamMeta(next.meta)
  })

  it('refuses to stop a run owned by another actor', async () => {
    const { meta, controller } = registerLiveRun({
      actorIdentifier: 'user:2',
      clientMessageId: 'client-stop-4',
      assistantMessageId: 105,
    })
    const app = makeApp()

    const res = await postStopTools(app, { sessionId: 11, clientMessageId: 'client-stop-4' })

    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ success: false, error: 'Stream not found' })
    expect(meta.stopToolsRequested).toBe(false)
    expect(controller.signal.aborted).toBe(false)
    releaseStreamMeta(meta)
  })

  it('resolves the live run from a numeric message id and accepts string ids', async () => {
    const { meta } = registerLiveRun({ clientMessageId: 'client-stop-5', assistantMessageId: 106 })
    const app = makeApp()

    const res = await postStopTools(app, { sessionId: 11, messageId: '106', clientMessageId: 'client-stop-5' })

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      success: true,
      data: { accepted: true, target: { messageId: 106 } },
    })
    releaseStreamMeta(meta)
  })

  it('rejects a body without a session id at schema level', async () => {
    const app = makeApp()
    const res = await postStopTools(app, { clientMessageId: 'client-stop-6' })
    expect(res.status).toBe(400)
  })
})

describe('removed fake stop endpoint', () => {
  it('no longer registers POST /chat/stop', async () => {
    const { registerChatControlRoutes } = await import('../control')
    const app = new Hono()
    registerChatControlRoutes(app, { prisma: {} as any })
    const res = await app.request('http://localhost/stop', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: 11 }),
    })
    expect(res.status).toBe(404)
    expect(getStreamMetaByKey('client:client-stop-6')).toBeNull()
  })
})
