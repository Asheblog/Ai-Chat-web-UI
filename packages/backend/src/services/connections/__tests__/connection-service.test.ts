import { ConnectionService, ConnectionServiceError } from '../connection-service'
import type { ConnectionRepository } from '../../../repositories/connection-repository'
import type { SecretVaultService } from '../../secret-vault'

const now = new Date('2026-06-12T08:00:00.000Z')

const baseConnection = {
  id: 1,
  ownerUserId: null,
  provider: 'openai' as const,
  vendor: null,
  baseUrl: 'https://api.openai.com/v1',
  enable: true,
  authType: 'bearer' as const,
  secretVaultId: 100 as number | null,
  apiKeyLabel: '主分组',
  headersJson: '',
  azureApiVersion: null,
  prefixId: null,
  tagsJson: '[]',
  modelIdsJson: '["gpt-4o"]',
  defaultCapabilitiesJson: '{}',
  connectionType: 'external' as const,
  createdAt: now,
  updatedAt: now,
}

const buildService = (opts?: { withSecretVault?: boolean }) => {
  const repository: jest.Mocked<ConnectionRepository> = {
    listSystemConnections: jest.fn(),
    createSystemConnection: jest.fn(),
    findSystemConnectionById: jest.fn(),
    updateSystemConnection: jest.fn(),
    deleteSystemConnection: jest.fn(),
    deleteModelCatalogByConnectionId: jest.fn(),
  }
  const refreshModelCatalog = jest.fn().mockResolvedValue(undefined)
  const fetchModelsForConnection = jest.fn().mockResolvedValue([
    { id: 'gpt-4o', rawId: 'gpt-4o', name: 'gpt-4o', provider: 'openai', channelName: 'openai', connectionBaseUrl: 'https://api.openai.com/v1', connectionType: 'external', tags: [] },
  ])
  const verifyConnection = jest.fn().mockResolvedValue(undefined)
  const logger = { warn: jest.fn(), error: jest.fn() }

  let secretVault: jest.Mocked<Pick<SecretVaultService, 'createSecret' | 'decryptById' | 'deleteSecret'>> | undefined
  if (opts?.withSecretVault !== false) {
    secretVault = {
      createSecret: jest.fn().mockResolvedValue({ id: 200 }),
      decryptById: jest.fn().mockResolvedValue('decrypted-key'),
      deleteSecret: jest.fn().mockResolvedValue(undefined),
    }
  }

  const service = new ConnectionService({
    repository,
    secretVault: secretVault as any,
    refreshModelCatalog,
    fetchModelsForConnection,
    verifyConnection,
    logger,
  })

  return { service, repository, secretVault, refreshModelCatalog, fetchModelsForConnection, verifyConnection, logger }
}

describe('ConnectionService', () => {
  describe('createSystemConnection with Secret Vault', () => {
    it('creates connection then writes Vault then persists secretVaultId for bearer auth', async () => {
      const { service, repository, secretVault, refreshModelCatalog } = buildService()
      repository.createSystemConnection
        .mockResolvedValueOnce({ ...baseConnection, id: 9, secretVaultId: null } as any)
        .mockResolvedValueOnce({ ...baseConnection, id: 10, secretVaultId: null } as any)

      const payload = {
        provider: 'openai' as const,
        baseUrl: 'https://api.openai.com/v1/',
        authType: 'bearer' as const,
        tags: [{ name: 'vision' }],
        apiKeys: [
          { apiKeyLabel: '组 A', apiKey: 'key-a', modelIds: ['gpt-4o'] },
          { apiKeyLabel: '组 B', apiKey: 'key-b', modelIds: ['gpt-4.1-mini'] },
        ],
      }

      const created = await service.createSystemConnection(payload)

      // Step 1: connections created without secretVaultId (null in shared data)
      expect(repository.createSystemConnection).toHaveBeenCalledTimes(2)
      // Step 2: secret vault entries created with the apiKey values
      expect(secretVault!.createSecret).toHaveBeenCalledTimes(2)
      expect(secretVault!.createSecret).toHaveBeenNthCalledWith(1, expect.objectContaining({
        scope: 'system', kind: 'api_key', value: 'key-a', refType: 'connection',
      }))
      expect(secretVault!.createSecret).toHaveBeenNthCalledWith(2, expect.objectContaining({
        value: 'key-b',
      }))
      // Step 3: secretVaultId persisted on connection
      expect(repository.updateSystemConnection).toHaveBeenCalledTimes(2)
      expect(repository.updateSystemConnection).toHaveBeenNthCalledWith(1, 9, { secretVaultId: 200 })
      expect(refreshModelCatalog).toHaveBeenCalledTimes(2)
      expect(created.apiKeys).toHaveLength(2)
      expect(created.apiKeys[0]!.hasStoredApiKey).toBe(true)
      expect(created.apiKeys[0]!.apiKeyMasked).toBe('****')
    })

    it('authType=none creates no Secret Vault entry and needs no apiKey', async () => {
      const { service, repository, secretVault } = buildService()
      repository.createSystemConnection.mockResolvedValueOnce({ ...baseConnection, id: 1, authType: 'none', secretVaultId: null } as any)

      await service.createSystemConnection({
        provider: 'ollama',
        baseUrl: 'http://localhost:11434',
        authType: 'none',
        apiKeys: [{ apiKeyLabel: 'local', modelIds: [] }],
      })

      expect(secretVault!.createSecret).not.toHaveBeenCalled()
    })

    it('bearer without apiKey throws validation error', async () => {
      const { service } = buildService()

      await expect(service.createSystemConnection({
        provider: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        authType: 'bearer',
        apiKeys: [{ apiKeyLabel: 'K', modelIds: ['gpt-4o'] }],
      })).rejects.toThrow(ConnectionServiceError)
    })
  })

  describe('updateSystemConnection with Secret Vault', () => {
    it('bearer without apiKey preserves existing secretVaultId', async () => {
      const { service, repository, secretVault } = buildService()
      repository.listSystemConnections.mockResolvedValue([
        { ...baseConnection, id: 7, apiKeyLabel: '组 A', secretVaultId: 100 } as any,
      ])
      repository.updateSystemConnection.mockResolvedValue({
        ...baseConnection, id: 7, apiKeyLabel: '组 A', secretVaultId: 100,
        modelIdsJson: '["gpt-4o","gpt-4.1-mini"]',
      } as any)

      const updated = await service.updateSystemConnection(7, {
        provider: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        authType: 'bearer',
        apiKeys: [{ id: 7, apiKeyLabel: '组 A', modelIds: ['gpt-4o', 'gpt-4.1-mini'] }],
      })

      expect(secretVault!.createSecret).not.toHaveBeenCalled()
      expect(secretVault!.deleteSecret).not.toHaveBeenCalled()
      expect(updated.apiKeys).toHaveLength(1)
    })

    it('bearer with new apiKey replaces Vault secret and updates secretVaultId', async () => {
      const { service, repository, secretVault } = buildService()
      repository.listSystemConnections.mockResolvedValue([
        { ...baseConnection, id: 7, apiKeyLabel: '组 A', secretVaultId: 100 } as any,
      ])
      repository.updateSystemConnection.mockResolvedValue({
        ...baseConnection, id: 7, apiKeyLabel: '组 A', secretVaultId: 300,
        modelIdsJson: '["gpt-4o"]',
      } as any)

      const updated = await service.updateSystemConnection(7, {
        provider: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        authType: 'bearer',
        apiKeys: [{ id: 7, apiKeyLabel: '组 A', apiKey: 'new-key', modelIds: ['gpt-4o'] }],
      })

      expect(secretVault!.deleteSecret).toHaveBeenCalledWith(100)
      expect(secretVault!.createSecret).toHaveBeenCalledWith(expect.objectContaining({
        value: 'new-key', label: '组 A', refType: 'connection',
      }))
      expect(updated.apiKeys).toHaveLength(1)
    })

    it('after bearer key update, refreshModelCatalog receives connection with new secretVaultId', async () => {
      const { service, repository, secretVault, refreshModelCatalog } = buildService()
      repository.listSystemConnections.mockResolvedValue([
        { ...baseConnection, id: 7, apiKeyLabel: '组 A', secretVaultId: 100 } as any,
      ])
      // Return connection with OLD secretVaultId from the main update (no secretVaultId in update payload)
      repository.updateSystemConnection.mockResolvedValue({
        ...baseConnection, id: 7, apiKeyLabel: '组 A', secretVaultId: 100,
        modelIdsJson: '["gpt-4o"]',
      } as any)
      secretVault!.createSecret.mockResolvedValue({ id: 666 })

      await service.updateSystemConnection(7, {
        provider: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        authType: 'bearer',
        apiKeys: [{ id: 7, apiKeyLabel: '组 A', apiKey: 'replacement-key', modelIds: ['gpt-4o'] }],
      })

      // refreshModelCatalog should receive connection with new secretVaultId=666,
      // not the old secretVaultId=100
      expect(refreshModelCatalog).toHaveBeenCalledTimes(1)
      const passedConnection = refreshModelCatalog.mock.calls[0][0]
      expect(passedConnection).toBeDefined()
      expect(passedConnection.secretVaultId).toBe(666)
    })

    it('bearer without apiKey and without existing secretVaultId throws', async () => {
      const { service, repository } = buildService()
      repository.listSystemConnections.mockResolvedValue([
        { ...baseConnection, id: 7, apiKeyLabel: '组 A', secretVaultId: null } as any,
      ])
      repository.updateSystemConnection.mockResolvedValue({ ...baseConnection, id: 7, apiKeyLabel: '组 A', secretVaultId: null } as any)

      await expect(service.updateSystemConnection(7, {
        provider: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        authType: 'bearer',
        apiKeys: [{ id: 7, apiKeyLabel: '组 A', modelIds: ['gpt-4o'] }],
      })).rejects.toThrow(ConnectionServiceError)
    })
  })

  describe('verifyConnectionConfig with Secret Vault', () => {
    it('new key uses payload apiKey plaintext directly', async () => {
      const { service, repository } = buildService()
      repository.listSystemConnections.mockResolvedValue([])

      const result = await service.verifyConnectionConfig({
        provider: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        authType: 'bearer',
        apiKeys: [{ apiKeyLabel: 'K', apiKey: 'sk-new-key', modelIds: ['gpt-4o'] }],
      })

      // New key → verifyConnection should receive the plaintext apiKey from payload
      expect(result.results[0]?.success).toBe(true)
    })

    it('existing key without apiKey decrypts via secretVaultId', async () => {
      const { service, repository, secretVault } = buildService()
      repository.listSystemConnections.mockResolvedValue([
        { ...baseConnection, id: 1, secretVaultId: 100 } as any,
      ])

      const result = await service.verifyConnectionConfig({
        provider: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        authType: 'bearer',
        apiKeys: [{ id: 1, apiKeyLabel: '组 A', modelIds: ['gpt-4o'] }],
      })

      expect(secretVault!.decryptById).toHaveBeenCalledWith(100)
      expect(result.results[0]?.success).toBe(true)
    })

    it('existing key with Vault decrypt failure returns failure result', async () => {
      const { service, repository, secretVault } = buildService()
      repository.listSystemConnections.mockResolvedValue([
        { ...baseConnection, id: 1, secretVaultId: 100 } as any,
      ])
      secretVault!.decryptById.mockRejectedValue(new Error('Vault corrupted'))

      const result = await service.verifyConnectionConfig({
        provider: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        authType: 'bearer',
        apiKeys: [{ id: 1, apiKeyLabel: '组 A', modelIds: ['gpt-4o'] }],
      })

      expect(result.results[0]?.success).toBe(false)
      expect(result.results[0]?.error).toContain('Vault corrupted')
    })
  })

  describe('without Secret Vault', () => {
    it('throws when creating bearer connection without Secret Vault', async () => {
      const { service, repository } = buildService({ withSecretVault: false })
      repository.createSystemConnection.mockResolvedValue({ ...baseConnection, id: 1, secretVaultId: null } as any)

      await expect(
        service.createSystemConnection({
          provider: 'openai',
          baseUrl: 'https://api.openai.com/v1',
          authType: 'bearer',
          apiKeys: [{ apiKeyLabel: 'K', apiKey: 'some-key', modelIds: ['gpt-4o'] }],
        }),
      ).rejects.toThrow(ConnectionServiceError)
    })
  })

  describe('common', () => {
    it('lists connections with hasStoredApiKey based on secretVaultId', async () => {
      const { service, repository } = buildService()
      repository.listSystemConnections.mockResolvedValue([
        { ...baseConnection, id: 1, secretVaultId: 100, apiKeyLabel: '有密钥' } as any,
        { ...baseConnection, id: 2, secretVaultId: null, apiKeyLabel: '无密钥' } as any,
      ])

      const groups = await service.listSystemConnections()

      expect(groups).toHaveLength(1)
      expect(groups[0]?.apiKeys).toHaveLength(2)
      expect(groups[0]?.apiKeys[0]?.hasStoredApiKey).toBe(true)
      expect(groups[0]?.apiKeys[0]?.apiKeyMasked).toBe('****')
      expect(groups[0]?.apiKeys[1]?.hasStoredApiKey).toBe(false)
      expect(groups[0]?.apiKeys[1]?.apiKeyMasked).toBeNull()
    })

    it('deletes all connections in the same endpoint group', async () => {
      const { service, repository } = buildService()
      repository.listSystemConnections.mockResolvedValue([
        { ...baseConnection, id: 5, secretVaultId: 100 } as any,
        { ...baseConnection, id: 6, secretVaultId: 101 } as any,
      ])

      await service.deleteSystemConnection(5)

      expect(repository.deleteSystemConnection).toHaveBeenCalledTimes(2)
    })

    it('throws when updating a missing endpoint group', async () => {
      const { service, repository } = buildService()
      repository.listSystemConnections.mockResolvedValue([])

      await expect(
        service.updateSystemConnection(999, {
          provider: 'openai',
          baseUrl: 'https://api.openai.com/v1',
          apiKeys: [{ apiKeyLabel: 'K', modelIds: ['gpt-4o'] }],
        }),
      ).rejects.toThrow(ConnectionServiceError)
    })
  })
})
