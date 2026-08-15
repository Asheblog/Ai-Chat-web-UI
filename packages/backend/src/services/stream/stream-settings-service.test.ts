import { StreamSettingsService } from './stream-settings-service'

const makePrisma = (value: string | null) => ({
  systemSetting: {
    findUnique: jest.fn().mockResolvedValue(value === null ? null : { value }),
  },
})

describe('StreamSettingsService', () => {
  afterEach(() => {
    delete process.env.STREAM_KEEPALIVE_INTERVAL_MS
  })

  it('returns the database value when configured', async () => {
    const service = new StreamSettingsService({ prisma: makePrisma('2500') as any })
    await expect(service.resolveKeepaliveIntervalMs()).resolves.toBe(2500)
  })

  it('falls back to the environment variable', async () => {
    process.env.STREAM_KEEPALIVE_INTERVAL_MS = '700'
    const service = new StreamSettingsService({ prisma: makePrisma(null) as any })
    await expect(service.resolveKeepaliveIntervalMs()).resolves.toBe(700)
  })

  it('returns 0 when no keepalive is configured', async () => {
    const service = new StreamSettingsService({ prisma: makePrisma(null) as any })
    await expect(service.resolveKeepaliveIntervalMs()).resolves.toBe(0)
  })
})
