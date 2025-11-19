import { SettingsService, type SettingsServiceDeps } from './settings-service'

const buildService = (overrides: Partial<SettingsServiceDeps> = {}) => {
  const prisma = {
    systemSetting: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      upsert: jest.fn(),
      deleteMany: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  }

  const getQuotaPolicy = jest.fn(async () => ({
    anonymousDailyQuota: 10,
    anonymousRetentionDays: 5,
    defaultUserDailyQuota: 100,
  }))
  const invalidateQuotaPolicyCache = jest.fn()
  const invalidateReasoningMaxOutputTokensDefaultCache = jest.fn()
  const invalidateTaskTraceConfig = jest.fn()
  const syncSharedAnonymousQuota = jest.fn(async () => {})
  const replaceProfileImage = overrides.replaceProfileImage
    ? overrides.replaceProfileImage
    : jest.fn(async () => 'path/avatar.png')

  const service = new SettingsService({
    prisma: prisma as any,
    getQuotaPolicy,
    invalidateQuotaPolicyCache,
    invalidateReasoningMaxOutputTokensDefaultCache,
    invalidateTaskTraceConfig,
    syncSharedAnonymousQuota,
    replaceProfileImage,
    ...overrides,
  })

  return {
    prisma,
    getQuotaPolicy,
    invalidateQuotaPolicyCache,
    invalidateReasoningMaxOutputTokensDefaultCache,
    invalidateTaskTraceConfig,
    syncSharedAnonymousQuota,
    replaceProfileImage,
    service,
  }
}

describe('SettingsService', () => {
  it('caches brand text until invalidated', async () => {
    const { prisma, service } = buildService()
    prisma.systemSetting.findUnique.mockResolvedValueOnce({ value: 'TestBrand' })
    const first = await service.getBrandingText()
    const second = await service.getBrandingText()
    expect(first).toBe('TestBrand')
    expect(second).toBe('TestBrand')
    expect(prisma.systemSetting.findUnique).toHaveBeenCalledTimes(1)
    service.invalidateBrandingCache()
    prisma.systemSetting.findUnique.mockResolvedValueOnce({ value: 'Another' })
    const third = await service.getBrandingText()
    expect(third).toBe('Another')
  })

  it('updates quotas and invalidates caches', async () => {
    const {
      service,
      prisma,
      invalidateQuotaPolicyCache,
      syncSharedAnonymousQuota,
      invalidateReasoningMaxOutputTokensDefaultCache,
    } = buildService()
    await service.updateSystemSettings({
      brand_text: 'NewBrand',
      registration_enabled: true,
      anonymous_daily_quota: 50,
      anonymous_retention_days: 4,
      reasoning_max_output_tokens_default: 64000,
      reset_quota_cache: true,
    })
    expect(prisma.systemSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: 'brand_text' },
        update: { value: 'NewBrand' },
      }),
    )
    expect(prisma.systemSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: 'anonymous_daily_quota' },
        update: { value: '50' },
      }),
    )
    expect(invalidateQuotaPolicyCache).toHaveBeenCalled()
    expect(syncSharedAnonymousQuota).toHaveBeenCalled()
    expect(invalidateReasoningMaxOutputTokensDefaultCache).toHaveBeenCalled()
  })
  it('throws SettingsServiceError when assistant avatar payload invalid', async () => {
    const { service } = buildService({
      replaceProfileImage: jest.fn(async () => {
        throw new Error('invalid data')
      }) as any,
    })
    await expect(
      service.updateSystemSettings({ assistant_avatar: { data: 'xxx', mime: 'image/png' } }),
    ).rejects.toThrow('Invalid assistant avatar payload')
  })
})
