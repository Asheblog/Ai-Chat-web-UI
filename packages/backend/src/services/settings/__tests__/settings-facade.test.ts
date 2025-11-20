import { SettingsFacade } from '../settings-facade'

const createMocks = () => {
  const settingsService = {
    getBrandingText: jest.fn(),
    getSystemSettings: jest.fn(),
    updateSystemSettings: jest.fn(),
  }
  const personalSettingsService = {
    getPersonalSettings: jest.fn(),
    updatePersonalSettings: jest.fn(),
  }
  const healthService = {
    check: jest.fn(),
  }
  const appInfoService = {
    getAppInfo: jest.fn(),
  }
  const syncSharedAnonymousQuota = jest.fn()
  const invalidateQuotaPolicyCache = jest.fn()

  const facade = new SettingsFacade({
    settingsService: settingsService as any,
    personalSettingsService: personalSettingsService as any,
    healthService: healthService as any,
    appInfoService: appInfoService as any,
    syncSharedAnonymousQuota,
    invalidateQuotaPolicyCache,
  })

  const actor = {
    type: 'user' as const,
    id: 1,
    username: 'admin',
    role: 'ADMIN' as const,
    status: 'ACTIVE' as const,
    identifier: 'user:1',
  }

  return {
    facade,
    settingsService,
    personalSettingsService,
    healthService,
    appInfoService,
    syncSharedAnonymousQuota,
    invalidateQuotaPolicyCache,
    actor,
  }
}

describe('SettingsFacade', () => {
  test('delegates brand text loading', async () => {
    const mocks = createMocks()
    mocks.settingsService.getBrandingText.mockResolvedValue('AIChat')

    const result = await mocks.facade.getBrandingText()

    expect(result).toBe('AIChat')
    expect(mocks.settingsService.getBrandingText).toHaveBeenCalled()
  })

  test('gets and updates system settings via services', async () => {
    const mocks = createMocks()
    mocks.settingsService.getSystemSettings.mockResolvedValue({ flag: true })

    const systemSettings = await mocks.facade.getSystemSettings(mocks.actor as any)
    await mocks.facade.updateSystemSettings({ brand_text: 'new' })

    expect(systemSettings).toEqual({ flag: true })
    expect(mocks.settingsService.getSystemSettings).toHaveBeenCalledWith(mocks.actor)
    expect(mocks.settingsService.updateSystemSettings).toHaveBeenCalledWith({ brand_text: 'new' })
  })

  test('resets anonymous quota and invalidates cache', async () => {
    const mocks = createMocks()

    const result = await mocks.facade.resetAnonymousQuota({ resetUsed: true })

    expect(result.success).toBe(true)
    expect(mocks.syncSharedAnonymousQuota).toHaveBeenCalledWith({ resetUsed: true })
    expect(mocks.invalidateQuotaPolicyCache).toHaveBeenCalled()
  })

  test('handles personal settings through delegated service', async () => {
    const mocks = createMocks()
    mocks.personalSettingsService.getPersonalSettings.mockResolvedValue({ theme: 'light' })
    mocks.personalSettingsService.updatePersonalSettings.mockResolvedValue({ theme: 'dark' })

    const result = await mocks.facade.getPersonalSettings({ userId: 2, request: new Request('http://localhost') })
    const updated = await mocks.facade.updatePersonalSettings({
      userId: 2,
      payload: { theme: 'dark' },
      request: new Request('http://localhost'),
    })

    expect(result).toEqual({ theme: 'light' })
    expect(updated).toEqual({ theme: 'dark' })
    expect(mocks.personalSettingsService.getPersonalSettings).toHaveBeenCalled()
    expect(mocks.personalSettingsService.updatePersonalSettings).toHaveBeenCalled()
  })

  test('returns app info and health status', async () => {
    const mocks = createMocks()
    mocks.appInfoService.getAppInfo.mockResolvedValue({ version: '1.0.0' })
    mocks.healthService.check.mockResolvedValue({ status: 'ok' })

    const appInfo = await mocks.facade.getAppInfo()
    const health = await mocks.facade.checkHealth()

    expect(appInfo).toEqual({ version: '1.0.0' })
    expect(health).toEqual({ status: 'ok' })
    expect(mocks.appInfoService.getAppInfo).toHaveBeenCalled()
    expect(mocks.healthService.check).toHaveBeenCalled()
  })
})
