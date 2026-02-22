jest.mock('../../middleware/auth', () => ({
  actorMiddleware: async (c: any, next: any) => {
    const role = (c.req.header('x-role') || 'ADMIN').toUpperCase()
    c.set('actor', {
      type: 'user',
      id: 1,
      role,
      status: 'ACTIVE',
      username: 'tester',
      identifier: 'user:1',
    })
    c.set('user', {
      id: 1,
      username: 'tester',
      role,
      status: 'ACTIVE',
    })
    await next()
  },
  requireUserActor: async (_c: any, next: any) => next(),
  adminOnlyMiddleware: async (c: any, next: any) => {
    const actor = c.get('actor')
    if (!actor || actor.role !== 'ADMIN') {
      return c.json({ success: false, error: 'Admin required' }, 403)
    }
    await next()
  },
}))

jest.mock('../../db', () => ({
  prisma: {
    systemSetting: {
      findUnique: jest.fn(),
    },
  },
}))

import { createBattleApi } from '../battle'

const createServiceMock = () =>
  ({
    triggerRetentionCleanupIfDue: jest.fn(async () => {}),
    clearAllRunsAndSharesGlobal: jest.fn(),
  }) as any

describe('battle api - admin clear all', () => {
  it('管理员可全局清空并返回统计字段', async () => {
    const service = createServiceMock()
    service.clearAllRunsAndSharesGlobal.mockResolvedValue({
      deletedRuns: 3,
      deletedResults: 12,
      deletedShares: 3,
      deletedImages: 9,
      vacuumScheduled: true,
      vacuumMode: 'async',
    })

    const app = createBattleApi({ battleService: service })
    const res = await app.request('http://localhost/admin/runs/all', {
      method: 'DELETE',
      headers: { 'x-role': 'ADMIN' },
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data).toEqual({
      deletedRuns: 3,
      deletedResults: 12,
      deletedShares: 3,
      deletedImages: 9,
      vacuumScheduled: true,
      vacuumMode: 'async',
    })
    expect(service.clearAllRunsAndSharesGlobal).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'ADMIN' }),
    )
  })

  it('非管理员请求返回 403', async () => {
    const service = createServiceMock()
    const app = createBattleApi({ battleService: service })
    const res = await app.request('http://localhost/admin/runs/all', {
      method: 'DELETE',
      headers: { 'x-role': 'USER' },
    })

    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.success).toBe(false)
    expect(service.clearAllRunsAndSharesGlobal).not.toHaveBeenCalled()
  })

  it('服务异常时返回 500', async () => {
    const service = createServiceMock()
    service.clearAllRunsAndSharesGlobal.mockRejectedValue(new Error('boom'))

    const app = createBattleApi({ battleService: service })
    const res = await app.request('http://localhost/admin/runs/all', {
      method: 'DELETE',
      headers: { 'x-role': 'ADMIN' },
    })

    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.success).toBe(false)
    expect(body.error).toBe('Failed to clear battle runs globally')
  })
})

