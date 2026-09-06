jest.mock('../../db', () => ({
  prisma: {},
}))

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
  const getBattlePolicy = jest.fn(async () => ({
    allowAnonymous: true,
    allowUsers: true,
    anonymousDailyQuota: 20,
    userDailyQuota: 200,
  }))
  const invalidateQuotaPolicyCache = jest.fn()
  const invalidateBattlePolicyCache = jest.fn()
  const invalidateReasoningMaxOutputTokensDefaultCache = jest.fn()
  const invalidateTaskTraceConfig = jest.fn()
  const syncSharedAnonymousQuota = jest.fn(async () => {})
  const replaceProfileImage = overrides.replaceProfileImage
    ? overrides.replaceProfileImage
    : jest.fn(async () => 'path/avatar.png')

  const service = new SettingsService({
    prisma: prisma as any,
    getQuotaPolicy,
    getBattlePolicy,
    invalidateQuotaPolicyCache,
    invalidateBattlePolicyCache,
    invalidateReasoningMaxOutputTokensDefaultCache,
    invalidateTaskTraceConfig,
    syncSharedAnonymousQuota,
    replaceProfileImage,
    ...overrides,
  })

  return {
    prisma,
    getQuotaPolicy,
    getBattlePolicy,
    invalidateQuotaPolicyCache,
    invalidateBattlePolicyCache,
    invalidateReasoningMaxOutputTokensDefaultCache,
    invalidateTaskTraceConfig,
    syncSharedAnonymousQuota,
    replaceProfileImage,
    service,
  }
}

describe('SettingsService', () => {
  test.each([true, false])('excludes retired connections and models from setup diagnostics (enabled=%s)', async (enable) => {
    const rows = [{ id: 1, provider: 'ollama', enable }, { id: 2, provider: 'azure_openai', enable }]
    const prisma = {
      systemSetting: { findUnique: jest.fn().mockResolvedValue(null) },
      connectionGroup: { findMany: jest.fn(async ({ where }: any) => rows.filter((row) => !where.provider || where.provider.in.includes(row.provider))) },
      modelCatalog: { count: jest.fn().mockResolvedValue(2) },
    }
    const { service } = buildService({ prisma: prisma as any })
    const result = await service.getSetupStatus()
    expect(result.canComplete).toBe(false)
    expect(result.diagnostics).toMatchObject({ totalSystemConnections: 0, enabledSystemConnections: 0, totalModels: 0, chatModels: 0 })
    expect(prisma.modelCatalog.count).not.toHaveBeenCalled()
  })

  test('counts supported connections and scopes setup model counts to their enabled IDs', async () => {
    const rows = [
      { id: 1, provider: 'ollama', enable: false },
      { id: 2, provider: 'openai', enable: true },
      { id: 3, provider: 'google_genai', enable: false },
    ]
    const prisma = {
      systemSetting: { findUnique: jest.fn().mockResolvedValue(null) },
      connectionGroup: { findMany: jest.fn(async ({ where }: any) => rows.filter((row) => !where.provider || where.provider.in.includes(row.provider))) },
      modelCatalog: { count: jest.fn().mockResolvedValue(1) },
    }
    const { service } = buildService({ prisma: prisma as any })
    const result = await service.getSetupStatus()
    expect(result.canComplete).toBe(true)
    expect(result.diagnostics).toMatchObject({ totalSystemConnections: 2, enabledSystemConnections: 1, totalModels: 1, chatModels: 1 })
    for (const [args] of prisma.modelCatalog.count.mock.calls) expect(args.where.connectionGroupId.in).toEqual([2])
  })

  it('caches public branding until invalidated', async () => {
    const { prisma, service } = buildService()
    prisma.systemSetting.findMany.mockResolvedValueOnce([{ key: 'brand_text', value: 'TestBrand' }])
    const first = await service.getBrandingText()
    const second = await service.getBrandingText()
    expect(first).toBe('TestBrand')
    expect(second).toBe('TestBrand')
    expect(prisma.systemSetting.findMany).toHaveBeenCalledTimes(1)
    service.invalidateBrandingCache()
    prisma.systemSetting.findMany.mockResolvedValueOnce([
      { key: 'brand_text', value: 'Another' },
      { key: 'brand_primary', value: '#AABBCC' },
    ])
    const third = await service.getPublicBranding()
    expect(third.brand_text).toBe('Another')
    expect(third.brand_primary).toBe('#AABBCC')
    expect(third.brand_background).toBe('')
  })

  it('persists brand theme colors and clears empty values', async () => {
    const { service, prisma } = buildService()
    await service.updateSystemSettings({
      brand_primary: '#aabbcc',
      brand_background: '',
      brand_surface: null,
    })
    expect(prisma.systemSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: 'brand_primary' },
        update: { value: '#AABBCC' },
      }),
    )
    expect(prisma.systemSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: 'brand_background' },
        update: { value: '' },
      }),
    )
    expect(prisma.systemSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: 'brand_surface' },
        update: { value: '' },
      }),
    )
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
      chat_dynamic_skill_runtime_enabled: true,
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
    expect(prisma.systemSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: 'chat_dynamic_skill_runtime_enabled' },
        update: { value: 'true' },
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

  it('stores assistant avatar payload with replaceProfileImage', async () => {
    const { service, prisma, replaceProfileImage } = buildService()
    await service.updateSystemSettings({ assistant_avatar: { data: 'xxx', mime: 'image/png' } })

    expect(replaceProfileImage).toHaveBeenCalledWith(
      { data: 'xxx', mime: 'image/png' },
      { currentPath: undefined },
    )
    expect(prisma.systemSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: 'assistant_avatar_path' },
        update: { value: 'path/avatar.png' },
      }),
    )
  })

  it('reads battle_retention_days with db/env/default fallback', async () => {
    const previous = process.env.BATTLE_RETENTION_DAYS
    process.env.BATTLE_RETENTION_DAYS = '21'
    try {
      const { service, prisma } = buildService()
      prisma.systemSetting.findMany.mockResolvedValueOnce([])

      const adminActor = {
        type: 'user',
        id: 1,
        username: 'admin',
        role: 'ADMIN',
        status: 'ACTIVE',
        identifier: 'user:1',
      } as any

      const first = await service.getSystemSettings(adminActor)
      expect(first.battle_retention_days).toBe(21)

      prisma.systemSetting.findMany.mockResolvedValueOnce([
        { key: 'battle_retention_days', value: '33' },
      ])
      const second = await service.getSystemSettings(adminActor)
      expect(second.battle_retention_days).toBe(33)
    } finally {
      if (typeof previous === 'undefined') {
        delete process.env.BATTLE_RETENTION_DAYS
      } else {
        process.env.BATTLE_RETENTION_DAYS = previous
      }
    }
  })

  it('updates battle_retention_days', async () => {
    const { service, prisma } = buildService()
    await service.updateSystemSettings({ battle_retention_days: 45 })
    expect(prisma.systemSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: 'battle_retention_days' },
        update: { value: '45' },
      }),
    )
  })

  it('defaults image transcription reasoning keys when unset', async () => {
    const previousEnabled = process.env.IMAGE_TRANSCRIPTION_REASONING_ENABLED
    const previousEffort = process.env.IMAGE_TRANSCRIPTION_REASONING_EFFORT
    delete process.env.IMAGE_TRANSCRIPTION_REASONING_ENABLED
    delete process.env.IMAGE_TRANSCRIPTION_REASONING_EFFORT
    try {
      const { service, prisma } = buildService()
      prisma.systemSetting.findMany.mockResolvedValueOnce([])

      const adminActor = {
        type: 'user',
        id: 1,
        username: 'admin',
        role: 'ADMIN',
        status: 'ACTIVE',
        identifier: 'user:1',
      } as any

      const settings = await service.getSystemSettings(adminActor)
      expect(settings.image_transcription_reasoning_enabled).toBe(false)
      expect(settings.image_transcription_reasoning_effort).toBe('unset')
      expect(settings).not.toHaveProperty('image_transcription_ollama_think')
    } finally {
      if (typeof previousEnabled === 'undefined') {
        delete process.env.IMAGE_TRANSCRIPTION_REASONING_ENABLED
      } else {
        process.env.IMAGE_TRANSCRIPTION_REASONING_ENABLED = previousEnabled
      }
      if (typeof previousEffort === 'undefined') {
        delete process.env.IMAGE_TRANSCRIPTION_REASONING_EFFORT
      } else {
        process.env.IMAGE_TRANSCRIPTION_REASONING_EFFORT = previousEffort
      }
    }
  })

  it('exposes image transcription reasoning keys to non-admin users', async () => {
    const { service, prisma } = buildService()
    prisma.systemSetting.findMany.mockResolvedValueOnce([
      { key: 'image_transcription_reasoning_enabled', value: 'true' },
      { key: 'image_transcription_reasoning_effort', value: 'medium' },
      { key: 'image_transcription_ollama_think', value: 'true' },
    ])

    const userActor = {
      type: 'user',
      id: 2,
      username: 'user',
      role: 'USER',
      status: 'ACTIVE',
      identifier: 'user:2',
    } as any

    const settings = await service.getSystemSettings(userActor)
    expect(settings.image_transcription_reasoning_enabled).toBe(true)
    expect(settings.image_transcription_reasoning_effort).toBe('medium')
    expect(settings).not.toHaveProperty('image_transcription_ollama_think')
  })

  it('updates image transcription reasoning keys', async () => {
    const { service, prisma } = buildService()
    await service.updateSystemSettings({
      image_transcription_reasoning_enabled: true,
      image_transcription_reasoning_effort: 'high',
    })
    expect(prisma.systemSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: 'image_transcription_reasoning_enabled' },
        update: { value: 'true' },
      }),
    )
    expect(prisma.systemSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: 'image_transcription_reasoning_effort' },
        update: { value: 'high' },
      }),
    )
    expect(prisma.systemSetting.upsert).not.toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: 'image_transcription_ollama_think' },
        update: { value: 'true' },
      }),
    )
  })
})
