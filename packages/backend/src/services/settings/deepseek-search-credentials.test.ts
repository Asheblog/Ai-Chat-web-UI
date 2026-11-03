jest.mock('../../db', () => ({ prisma: {} }))

import { SecretVaultService } from '../secret-vault'
import { SettingsService } from './settings-service'
import { resolveDeepseekSearchSettings } from './deepseek-search-credentials'

const createFixture = () => {
  const settings = new Map<string, string>()
  const secrets = new Map<number, any>()
  const prisma: any = {
    systemSetting: {
      findUnique: jest.fn(async ({ where }: any) => settings.has(where.key) ? { key: where.key, value: settings.get(where.key) } : null),
      findMany: jest.fn(async () => [...settings].map(([key, value]) => ({ key, value }))),
      upsert: jest.fn(async ({ where, create, update }: any) => { settings.set(where.key, settings.has(where.key) ? update.value : create.value) }),
    },
    secretVault: {
      findUnique: jest.fn(async ({ where }: any) => secrets.get(where.id) ?? null),
      create: jest.fn(async ({ data }: any) => { const row = { id: secrets.size + 1, createdAt: new Date(), updatedAt: new Date(), ...data }; secrets.set(row.id, row); return row }),
      update: jest.fn(async ({ where, data }: any) => { const row = { ...secrets.get(where.id), ...data }; secrets.set(where.id, row); return row }),
      delete: jest.fn(async ({ where }: any) => { secrets.delete(where.id) }),
    },
    $transaction: jest.fn(async (callback: any) => callback(prisma)),
  }
  const vault = new SecretVaultService({ prisma, masterKey: 'test-only-deepseek-master-key' })
  const service = new SettingsService({ prisma, secretVault: vault, getQuotaPolicy: jest.fn(async () => ({ anonymousDailyQuota: 1, anonymousRetentionDays: 1, defaultUserDailyQuota: 1 })), getBattlePolicy: jest.fn(async () => ({ allowAnonymous: false, allowUsers: true, anonymousDailyQuota: 1, userDailyQuota: 1 })) })
  return { settings, secrets, prisma, vault, service }
}

describe('DeepSeek search credentials', () => {
  test('encrypts a dedicated search key, preserves omitted keys, rotates and explicitly clears', async () => {
    const { service, settings, secrets, vault } = createFixture()
    await service.updateSystemSettings({ web_search_api_key_deepseek: ' search-key-test ' })
    const id = Number(settings.get('web_search_deepseek_secret_id'))
    expect(id).toBeGreaterThan(0)
    expect(settings.has('web_search_api_key_deepseek')).toBe(false)
    expect(secrets.get(id).encryptedValue).not.toContain('search-key-test')
    expect(vault.decrypt(secrets.get(id).encryptedValue)).toBe('search-key-test')
    await service.updateSystemSettings({ web_search_deepseek_fetch_enable: true })
    expect(settings.get('web_search_deepseek_secret_id')).toBe(String(id))
    await service.updateSystemSettings({ web_search_api_key_deepseek: 'rotated-search-key' })
    expect(secrets.size).toBe(1)
    expect(vault.decrypt(secrets.get(id).encryptedValue)).toBe('rotated-search-key')
    await service.updateSystemSettings({ web_search_api_key_deepseek: '' })
    expect(settings.get('web_search_deepseek_secret_id')).toBe('')
    expect(secrets.size).toBe(0)
  })

  test('resolves only the dedicated system search credential without mutating the settings snapshot', async () => {
    const { service, settings, vault } = createFixture()
    await service.updateSystemSettings({ web_search_api_key_deepseek: 'runtime-search-key' })
    const snapshot = Object.fromEntries(settings)
    const result = await resolveDeepseekSearchSettings(snapshot, vault, {})
    expect(result.web_search_api_key_deepseek).toBe('runtime-search-key')
    expect(snapshot).not.toHaveProperty('web_search_api_key_deepseek')
  })

  test('isolates invalid search references without inheriting a user or model credential or blocking chat', async () => {
    const { vault, secrets } = createFixture()
    secrets.set(9, { id: 9, scope: 'user', scopeId: '1', kind: 'api_key', refType: 'connection', refId: '9', encryptedValue: vault.encrypt('private-model-key') })
    await expect(resolveDeepseekSearchSettings({ web_search_deepseek_secret_id: '9', chat_system_prompt: 'keep chat working' }, vault, {})).resolves.toMatchObject({ web_search_api_key_deepseek: '', chat_system_prompt: 'keep chat working' })
  })

  test('uses only the explicit search environment key and does not fall back after a broken vault reference', async () => {
    const { vault } = createFixture()
    expect(await resolveDeepseekSearchSettings({}, vault, { WEB_SEARCH_API_KEY_DEEPSEEK: ' env-search-key ' })).toMatchObject({ web_search_api_key_deepseek: 'env-search-key' })
    await expect(resolveDeepseekSearchSettings({ web_search_deepseek_secret_id: '99' }, vault, { WEB_SEARCH_API_KEY_DEEPSEEK: 'env-key' })).resolves.toMatchObject({ web_search_api_key_deepseek: '' })
  })

  test('settings reads expose availability and Fetch state to both roles, never keys or vault references', async () => {
    const { service } = createFixture()
    await service.updateSystemSettings({ web_search_api_key_deepseek: 'hidden-key', web_search_deepseek_fetch_enable: true, web_search_enabled_engines: ['deepseek'] })
    for (const role of ['ADMIN', 'USER'] as const) {
      const result = await service.getSystemSettings({ type: 'user', role, identifier: 'user:1' } as any)
      expect(result).toMatchObject({ web_search_has_api_key_deepseek: true, web_search_has_api_key: true, web_search_deepseek_fetch_enable: true, web_search_enabled_engines: ['deepseek'] })
      expect(result).not.toHaveProperty('web_search_api_key_deepseek')
      expect(result).not.toHaveProperty('web_search_deepseek_secret_id')
      expect(JSON.stringify(result)).not.toContain('hidden-key')
    }
  })

  test('fails before persisting any settings when encryption fails', async () => {
    const { service, vault, prisma } = createFixture()
    jest.spyOn(vault, 'encrypt').mockImplementation(() => { throw new Error('encryption unavailable') })
    await expect(service.updateSystemSettings({ web_search_api_key_deepseek: 'key', web_search_agent_enable: true })).rejects.toThrow('encryption unavailable')
    expect(prisma.systemSetting.upsert).not.toHaveBeenCalled()
    expect(prisma.secretVault.create).not.toHaveBeenCalled()
  })

  test.each(['99', 'invalid'])('allows the administrator to replace a broken reference %p', async reference => {
    const { service, settings, vault } = createFixture()
    settings.set('web_search_deepseek_secret_id', reference)
    await service.updateSystemSettings({ web_search_api_key_deepseek: 'replacement-key' })
    await expect(resolveDeepseekSearchSettings(Object.fromEntries(settings), vault, {})).resolves.toMatchObject({ web_search_api_key_deepseek: 'replacement-key' })
  })

  test('replacing or clearing a foreign reference never modifies that secret', async () => {
    const { service, settings, secrets, vault } = createFixture()
    const foreign = { id: 9, scope: 'user', scopeId: '1', kind: 'api_key', refType: 'connection', refId: '9', encryptedValue: vault.encrypt('foreign-model-key') }
    secrets.set(9, foreign)
    settings.set('web_search_deepseek_secret_id', '9')
    await service.updateSystemSettings({ web_search_api_key_deepseek: '' })
    expect(settings.get('web_search_deepseek_secret_id')).toBe('')
    expect(secrets.get(9)).toEqual(foreign)
    settings.set('web_search_deepseek_secret_id', '9')
    await service.updateSystemSettings({ web_search_api_key_deepseek: 'search-key' })
    expect(settings.get('web_search_deepseek_secret_id')).not.toBe('9')
    expect(secrets.get(9)).toEqual(foreign)
  })
})
