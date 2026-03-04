jest.mock('../../middleware/auth', () => ({
  actorMiddleware: async (c: any, next: any) => {
    c.set('actor', {
      type: 'user',
      id: 1,
      role: 'ADMIN',
      status: 'ACTIVE',
      username: 'tester',
      identifier: 'user:1',
    })
    c.set('user', {
      id: 1,
      username: 'tester',
      role: 'ADMIN',
      status: 'ACTIVE',
    })
    await next()
  },
  requireUserActor: async (_c: any, next: any) => next(),
  adminOnlyMiddleware: async (_c: any, next: any) => next(),
}))

jest.mock('../../db', () => ({
  prisma: {
    systemSetting: {
      findUnique: jest.fn(),
    },
  },
}))

import { prisma } from '../../db'
import { createBattleApi } from '../battle'

const prismaMock = prisma as any

const createServiceMock = () =>
  ({
    triggerRetentionCleanupIfDue: jest.fn(async () => {}),
    executeRun: jest.fn(async (_actor: any, _payload: any, options?: { emitEvent?: (event: any) => void }) => {
      options?.emitEvent?.({
        type: 'run_start',
        payload: { id: 99 },
      })
      options?.emitEvent?.({ type: 'run_complete', payload: { id: 99, summary: {} } })
    }),
    cancelAttempt: jest.fn(async () => ({ status: 'cancelled' })),
    retryAttempt: jest.fn(async () => ({ status: 'retrying' })),
    rejudgeWithNewAnswer: jest.fn(async (_actor: any, _params: any, options?: { emitEvent?: (event: any) => void }) => {
      options?.emitEvent?.({
        type: 'rejudge_complete',
        payload: { completed: 0, total: 0 },
      })
    }),
  }) as any

const makeMultiPayload = (overrides?: Record<string, unknown>) => ({
  mode: 'multi_model',
  title: 'multi',
  prompt: { text: 'Q' },
  expectedAnswer: { text: 'A' },
  judge: { modelId: 'judge' },
  runsPerModel: 1,
  passK: 1,
  models: [{ modelId: 'model-a' }],
  ...overrides,
})

const makeSinglePayload = (overrides?: Record<string, unknown>) => ({
  mode: 'single_model_multi_question',
  title: 'single',
  judge: { modelId: 'judge' },
  model: { modelId: 'model-a' },
  questions: [
    {
      prompt: { text: 'Q1' },
      expectedAnswer: { text: 'A1' },
      runsPerQuestion: 1,
      passK: 1,
    },
  ],
  ...overrides,
})

describe('battle api - mode routing', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    prismaMock.systemSetting.findUnique.mockResolvedValue(null)
  })

  it('multi_model: passK > runsPerModel 时返回 400', async () => {
    const service = createServiceMock()
    const app = createBattleApi({ battleService: service })
    const res = await app.request('http://localhost/stream', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(makeMultiPayload({ runsPerModel: 1, passK: 2 })),
    })

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.success).toBe(false)
    expect(body.error).toBe('passK must be <= runsPerModel')
    expect(service.executeRun).not.toHaveBeenCalled()
  })

  it('single_model_multi_question: 题目 passK > runsPerQuestion 会被 schema 拦截', async () => {
    const service = createServiceMock()
    const app = createBattleApi({ battleService: service })
    const res = await app.request('http://localhost/stream', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(
        makeSinglePayload({
          questions: [
            {
              prompt: { text: 'Q1' },
              expectedAnswer: { text: 'A1' },
              runsPerQuestion: 1,
              passK: 2,
            },
          ],
        }),
      ),
    })

    expect(res.status).toBe(400)
    const text = await res.text()
    expect(text).toContain('question passK must be <= runsPerQuestion')
    expect(service.executeRun).not.toHaveBeenCalled()
  })

  it('single_model_multi_question: 有效请求会进入 executeRun', async () => {
    const service = createServiceMock()
    const app = createBattleApi({ battleService: service })
    const res = await app.request('http://localhost/stream', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(makeSinglePayload()),
    })

    expect(res.status).toBe(200)
    await res.text()
    expect(service.executeRun).toHaveBeenCalledTimes(1)
    expect(service.executeRun).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, type: 'user' }),
      expect.objectContaining({ mode: 'single_model_multi_question' }),
      expect.any(Object),
    )
  })

  it('attempt cancel 会透传 questionIndex', async () => {
    const service = createServiceMock()
    const app = createBattleApi({ battleService: service })
    const res = await app.request('http://localhost/runs/7/attempts/cancel', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        connectionId: 2,
        rawId: 'gpt-4o-mini',
        questionIndex: 3,
        attemptIndex: 2,
      }),
    })

    expect(res.status).toBe(200)
    expect(service.cancelAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, type: 'user' }),
      expect.objectContaining({
        runId: 7,
        connectionId: 2,
        rawId: 'gpt-4o-mini',
        questionIndex: 3,
        attemptIndex: 2,
      }),
    )
  })

  it('attempt retry 会透传 questionIndex', async () => {
    const service = createServiceMock()
    const app = createBattleApi({ battleService: service })
    const res = await app.request('http://localhost/runs/8/attempts/retry', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        connectionId: 3,
        rawId: 'claude-3-5-sonnet',
        questionIndex: 4,
        attemptIndex: 1,
      }),
    })

    expect(res.status).toBe(200)
    expect(service.retryAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, type: 'user' }),
      expect.objectContaining({
        runId: 8,
        connectionId: 3,
        rawId: 'claude-3-5-sonnet',
        questionIndex: 4,
        attemptIndex: 1,
      }),
    )
  })

  it('rejudge SSE 会透传 questionIndices', async () => {
    const service = createServiceMock()
    const app = createBattleApi({ battleService: service })
    const res = await app.request('http://localhost/runs/9/rejudge', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        expectedAnswer: { text: 'new answer' },
        questionIndices: [1, 3],
      }),
    })

    expect(res.status).toBe(200)
    await res.text()
    expect(service.rejudgeWithNewAnswer).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, type: 'user' }),
      expect.objectContaining({
        runId: 9,
        questionIndices: [1, 3],
      }),
      expect.any(Object),
    )
  })
})
