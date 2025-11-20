import { AppInfoService } from './app-info-service'

describe('AppInfoService', () => {
  it('returns app info with registration enabled', async () => {
    const prisma = {
      systemSetting: {
        findUnique: jest.fn().mockResolvedValue({ value: 'true' }),
      },
    }
    const service = new AppInfoService({ prisma: prisma as any, version: 'v-test' })
    const info = await service.getAppInfo()
    expect(info.mode).toBe('multi')
    expect(info.features.registration).toBe(true)
    expect(info.version).toBe('v-test')
  })

  it('returns restricted mode when registration disabled', async () => {
    const prisma = {
      systemSetting: {
        findUnique: jest.fn().mockResolvedValue({ value: 'false' }),
      },
    }
    const service = new AppInfoService({ prisma: prisma as any })
    const info = await service.getAppInfo()
    expect(info.mode).toBe('restricted')
    expect(info.features.registration).toBe(false)
  })
})
