import { HealthService, HealthServiceError } from './health-service'

describe('HealthService', () => {
  it('returns healthy when query succeeds', async () => {
    const prisma = { $queryRaw: jest.fn().mockResolvedValueOnce([]) }
    const now = () => new Date('2024-01-01T00:00:00Z')
    const memoryUsage = jest.fn(() => ({ rss: 1 } as any))
    const svc = new HealthService({
      prisma: prisma as any,
      now,
      version: 'v-test',
      memoryUsage,
    })
    const result = await svc.check()
    expect(prisma.$queryRaw).toHaveBeenCalled()
    expect(result).toEqual(
      expect.objectContaining({
        status: 'healthy',
        version: 'v-test',
        timestamp: '2024-01-01T00:00:00.000Z',
        database: 'connected',
      }),
    )
    expect(result.memory).toEqual({ rss: 1 })
  })

  it('throws HealthServiceError on failure', async () => {
    const prisma = { $queryRaw: jest.fn().mockRejectedValue(new Error('db down')) }
    const svc = new HealthService({ prisma: prisma as any })
    await expect(svc.check()).rejects.toBeInstanceOf(HealthServiceError)
  })
})
