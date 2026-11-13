import { AppInfoService } from './app-info-service'
import { MAX_SYSTEM_PROMPT_LENGTH } from '../../constants/prompt'

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
    // 单一事实源：接口暴露的必须是后端真正使用的那个上限，写死成别的数字要在这里红
    expect(info.limits.system_prompt_max_length).toBe(MAX_SYSTEM_PROMPT_LENGTH)
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
