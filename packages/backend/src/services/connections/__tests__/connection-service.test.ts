import { ConnectionService, ConnectionServiceError } from '../connection-service'
import type { ConnectionRepository } from '../../../repositories/connection-repository'
import type { SecretVaultService } from '../../secret-vault'

const now = new Date('2026-06-12T08:00:00.000Z')

const baseGroup = {
  id: 1,
  ownerUserId: null,
  displayName: 'OpenAI',
  provider: 'openai' as const,
  vendor: null,
  baseUrl: 'https://api.openai.com/v1',
  enable: true,
  authType: 'bearer' as const,
  headersJson: '',
  prefixId: null,
  tagsJson: '[]',
  defaultCapabilitiesJson: '{}',
  connectionType: 'external' as const,
  createdAt: now,
  updatedAt: now,
}

const baseCredential = {
  id: 1,
  connectionGroupId: 1,
  enable: true,
  secretVaultId: 100 as number | null,
  apiKeyLabel: '主分组',
  modelIdsJson: '["gpt-4o"]',
  createdAt: now,
  updatedAt: now,
}

const groupWithCredentials = (
  groupOverrides: Partial<typeof baseGroup> = {},
  credentials: Array<Partial<typeof baseCredential>> = [{ ...baseCredential }],
) => {
  const group = { ...baseGroup, ...groupOverrides }
  return {
    ...group,
    credentials: credentials.map((cred, index) => ({
      ...baseCredential,
      id: cred.id ?? index + 1,
      connectionGroupId: group.id,
      ...cred,
    })),
  }
}

const buildService = (opts?: { withSecretVault?: boolean }) => {
  const repository: jest.Mocked<ConnectionRepository> = {
    listSystemGroups: jest.fn(),
    findSystemGroupById: jest.fn(),
    createSystemGroup: jest.fn(),
    updateSystemGroup: jest.fn(),
    deleteSystemGroup: jest.fn(),
    createCredential: jest.fn(),
    updateCredential: jest.fn(),
    deleteCredential: jest.fn(),
    deleteModelCatalogByConnectionGroupId: jest.fn(),
  }
  const refreshModelCatalog = jest.fn().mockResolvedValue(undefined)
  const fetchModelsForConnection = jest.fn().mockResolvedValue([
    {
      id: 'gpt-4o',
      rawId: 'gpt-4o',
      name: 'gpt-4o',
      provider: 'openai',
      channelName: 'openai',
      connectionBaseUrl: 'https://api.openai.com/v1',
      connectionType: 'external',
      tags: [],
    },
  ])
  const verifyConnection = jest.fn().mockResolvedValue(undefined)
  const logger = { warn: jest.fn(), error: jest.fn(), info: jest.fn() }

  let secretVault: jest.Mocked<
    Pick<SecretVaultService, 'createSecret' | 'decryptById' | 'deleteSecret'>
  > | undefined
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

  return {
    service,
    repository,
    secretVault,
    refreshModelCatalog,
    fetchModelsForConnection,
    verifyConnection,
    logger,
  }
}

describe('ConnectionService', () => {
  test.each(['azure_openai', 'ollama'])('rejects retired %s before writes, verification or import', async (provider) => {
    const { service, repository, verifyConnection } = buildService()
    repository.listSystemGroups.mockResolvedValue([])
    const payload = { displayName: 'Retired', provider, baseUrl: 'https://example.com', apiKeys: [{ apiKey: 'test' }] } as any
    await expect(service.createSystemConnection(payload)).rejects.toThrow(/Unsupported provider/)
    await expect(service.updateSystemConnection(1, payload)).rejects.toThrow(/Unsupported provider/)
    await expect(service.verifyConnectionConfig(payload)).rejects.toThrow(/Unsupported provider/)
    await expect(service.importSystemConnections({ schemaVersion: 2, connections: [payload] })).rejects.toThrow(/Unsupported provider/)
    expect(repository.createSystemGroup).not.toHaveBeenCalled()
    expect(repository.updateSystemGroup).not.toHaveBeenCalled()
    expect(verifyConnection).not.toHaveBeenCalled()
  })

  test('hides retired records and rejects converting them into a supported provider', async () => {
    const { service, repository, secretVault } = buildService()
    const retired = { ...groupWithCredentials(), provider: 'ollama' }
    repository.listSystemGroups.mockResolvedValue([retired, groupWithCredentials({ id: 2 })] as any)
    repository.findSystemGroupById.mockResolvedValue(retired as any)
    expect((await service.listSystemConnections()).map((group) => group.id)).toEqual([2])
    expect((await service.exportSystemConnections()).connections).toHaveLength(1)
    expect(secretVault?.decryptById).toHaveBeenCalledTimes(1)
    await expect(service.updateSystemConnection(1, { displayName: 'Converted', provider: 'openai', baseUrl: 'https://example.com', apiKeys: [{ apiKey: 'test' }] })).rejects.toThrow(/Unsupported provider/)
    expect(repository.updateSystemGroup).not.toHaveBeenCalled()
  })

  describe('createSystemConnection with Secret Vault', () => {
    it('creates group then credentials, writes Vault, and refreshes catalog once', async () => {
      const { service, repository, secretVault, refreshModelCatalog } = buildService()
      repository.listSystemGroups.mockResolvedValue([])
      repository.createSystemGroup.mockResolvedValue({ ...baseGroup, id: 9, displayName: 'Prod' } as any)
      repository.createCredential
        .mockResolvedValueOnce({
          ...baseCredential,
          id: 91,
          connectionGroupId: 9,
          secretVaultId: null,
          apiKeyLabel: '组 A',
        } as any)
        .mockResolvedValueOnce({
          ...baseCredential,
          id: 92,
          connectionGroupId: 9,
          secretVaultId: null,
          apiKeyLabel: '组 B',
        } as any)
      repository.findSystemGroupById.mockResolvedValue(
        groupWithCredentials(
          { id: 9, displayName: 'Prod' },
          [
            { id: 91, apiKeyLabel: '组 A', secretVaultId: 200 },
            { id: 92, apiKeyLabel: '组 B', secretVaultId: 200 },
          ],
        ) as any,
      )

      const payload = {
        displayName: 'Prod',
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

      expect(repository.createSystemGroup).toHaveBeenCalledTimes(1)
      expect(repository.createSystemGroup).toHaveBeenCalledWith(
        expect.objectContaining({ displayName: 'Prod', ownerUserId: null }),
      )
      expect(repository.createCredential).toHaveBeenCalledTimes(2)
      expect(secretVault!.createSecret).toHaveBeenCalledTimes(2)
      expect(repository.updateCredential).toHaveBeenCalledTimes(2)
      expect(repository.updateCredential).toHaveBeenNthCalledWith(1, 91, { secretVaultId: 200 })
      expect(refreshModelCatalog).toHaveBeenCalledTimes(1)
      expect(created.id).toBe(9)
      expect(created.displayName).toBe('Prod')
      expect(created.connectionIds).toEqual([91, 92])
      expect(created.apiKeys).toHaveLength(2)
      expect(created.apiKeys[0]!.hasStoredApiKey).toBe(true)
    })

    it('rejects empty displayName', async () => {
      const { service } = buildService()

      await expect(
        service.createSystemConnection({
          displayName: '  ',
          provider: 'openai',
          baseUrl: 'https://api.openai.com/v1',
          authType: 'bearer',
          apiKeys: [{ apiKeyLabel: 'K', apiKey: 'key', modelIds: ['gpt-4o'] }],
        }),
      ).rejects.toThrow(ConnectionServiceError)
    })

    it('rejects duplicate system displayName with 409', async () => {
      const { service, repository } = buildService()
      repository.listSystemGroups.mockResolvedValue([
        groupWithCredentials({ id: 1, displayName: 'Prod' }) as any,
      ])

      await expect(
        service.createSystemConnection({
          displayName: 'Prod',
          provider: 'openai',
          baseUrl: 'https://api.openai.com/v1',
          authType: 'bearer',
          apiKeys: [{ apiKeyLabel: 'K', apiKey: 'key', modelIds: ['gpt-4o'] }],
        }),
      ).rejects.toMatchObject({ statusCode: 409 })
    })

    it('authType=none creates no Secret Vault entry and needs no apiKey', async () => {
      const { service, repository, secretVault, refreshModelCatalog } = buildService()
      repository.listSystemGroups.mockResolvedValue([])
      repository.createSystemGroup.mockResolvedValue({
        ...baseGroup,
        id: 1,
        authType: 'none',
        displayName: 'Local',
      } as any)
      repository.createCredential.mockResolvedValueOnce({
        ...baseCredential,
        id: 1,
        authType: undefined,
        secretVaultId: null,
      } as any)
      repository.findSystemGroupById.mockResolvedValue(
        groupWithCredentials(
          { id: 1, displayName: 'Local', authType: 'none' },
          [{ id: 1, secretVaultId: null }],
        ) as any,
      )

      await service.createSystemConnection({
        displayName: 'Local',
        provider: 'openai',
        baseUrl: 'http://localhost:8080/v1',
        authType: 'none',
        apiKeys: [{ apiKeyLabel: 'local', modelIds: [] }],
      })

      expect(secretVault!.createSecret).not.toHaveBeenCalled()
      expect(refreshModelCatalog).toHaveBeenCalledTimes(1)
    })

    it('bearer without apiKey throws validation error', async () => {
      const { service, repository } = buildService()
      repository.listSystemGroups.mockResolvedValue([])

      await expect(
        service.createSystemConnection({
          displayName: 'OpenAI',
          provider: 'openai',
          baseUrl: 'https://api.openai.com/v1',
          authType: 'bearer',
          apiKeys: [{ apiKeyLabel: 'K', modelIds: ['gpt-4o'] }],
        }),
      ).rejects.toThrow(ConnectionServiceError)
    })
  })

  describe('updateSystemConnection with Secret Vault', () => {
    it('bearer without apiKey preserves existing secretVaultId and refreshes once', async () => {
      const { service, repository, secretVault, refreshModelCatalog } = buildService()
      const existing = groupWithCredentials(
        { id: 7, displayName: 'OpenAI' },
        [{ id: 7, apiKeyLabel: '组 A', secretVaultId: 100 }],
      )
      repository.findSystemGroupById.mockResolvedValue(existing as any)
      repository.listSystemGroups.mockResolvedValue([existing as any])
      repository.updateSystemGroup.mockResolvedValue({ ...baseGroup, id: 7 } as any)
      repository.updateCredential.mockResolvedValue({
        ...baseCredential,
        id: 7,
        apiKeyLabel: '组 A',
        secretVaultId: 100,
        modelIdsJson: '["gpt-4o","gpt-4.1-mini"]',
      } as any)

      const updated = await service.updateSystemConnection(7, {
        displayName: 'OpenAI',
        provider: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        authType: 'bearer',
        apiKeys: [{ id: 7, apiKeyLabel: '组 A', modelIds: ['gpt-4o', 'gpt-4.1-mini'] }],
      })

      expect(secretVault!.createSecret).not.toHaveBeenCalled()
      expect(secretVault!.deleteSecret).not.toHaveBeenCalled()
      expect(repository.updateSystemGroup).toHaveBeenCalledWith(
        7,
        expect.objectContaining({ displayName: 'OpenAI' }),
      )
      expect(refreshModelCatalog).toHaveBeenCalledTimes(1)
      expect(updated.apiKeys).toHaveLength(1)
    })

    it('bearer with new apiKey replaces Vault secret and updates secretVaultId', async () => {
      const { service, repository, secretVault, refreshModelCatalog } = buildService()
      const existing = groupWithCredentials(
        { id: 7, displayName: 'OpenAI' },
        [{ id: 7, apiKeyLabel: '组 A', secretVaultId: 100 }],
      )
      repository.findSystemGroupById.mockResolvedValue(existing as any)
      repository.listSystemGroups.mockResolvedValue([existing as any])
      repository.updateSystemGroup.mockResolvedValue({ ...baseGroup, id: 7 } as any)
      repository.updateCredential.mockResolvedValue({
        ...baseCredential,
        id: 7,
        apiKeyLabel: '组 A',
        secretVaultId: 300,
      } as any)

      const updated = await service.updateSystemConnection(7, {
        displayName: 'OpenAI',
        provider: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        authType: 'bearer',
        apiKeys: [{ id: 7, apiKeyLabel: '组 A', apiKey: 'new-key', modelIds: ['gpt-4o'] }],
      })

      expect(secretVault!.deleteSecret).toHaveBeenCalledWith(100)
      expect(secretVault!.createSecret).toHaveBeenCalledWith(
        expect.objectContaining({ value: 'new-key', label: '组 A', refType: 'connection' }),
      )
      expect(refreshModelCatalog).toHaveBeenCalledTimes(1)
      expect(updated.apiKeys).toHaveLength(1)
    })

    it('after bearer key update, refresh receives credential with new secretVaultId', async () => {
      const { service, repository, secretVault, refreshModelCatalog } = buildService()
      const existing = groupWithCredentials(
        { id: 7, displayName: 'OpenAI' },
        [{ id: 7, apiKeyLabel: '组 A', secretVaultId: 100 }],
      )
      repository.findSystemGroupById.mockResolvedValue(existing as any)
      repository.listSystemGroups.mockResolvedValue([existing as any])
      repository.updateSystemGroup.mockResolvedValue({ ...baseGroup, id: 7 } as any)
      repository.updateCredential
        .mockResolvedValueOnce({
          ...baseCredential,
          id: 7,
          apiKeyLabel: '组 A',
          secretVaultId: 100,
        } as any)
        .mockResolvedValueOnce({
          ...baseCredential,
          id: 7,
          apiKeyLabel: '组 A',
          secretVaultId: 666,
        } as any)
      secretVault!.createSecret.mockResolvedValue({ id: 666 })

      await service.updateSystemConnection(7, {
        displayName: 'OpenAI',
        provider: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        authType: 'bearer',
        apiKeys: [{ id: 7, apiKeyLabel: '组 A', apiKey: 'replacement-key', modelIds: ['gpt-4o'] }],
      })

      expect(refreshModelCatalog).toHaveBeenCalledTimes(1)
      const [, credential] = refreshModelCatalog.mock.calls[0]
      expect(credential.secretVaultId).toBe(666)
    })

    it('bearer without apiKey and without existing secretVaultId throws', async () => {
      const { service, repository } = buildService()
      const existing = groupWithCredentials(
        { id: 7, displayName: 'OpenAI' },
        [{ id: 7, apiKeyLabel: '组 A', secretVaultId: null }],
      )
      repository.findSystemGroupById.mockResolvedValue(existing as any)
      repository.listSystemGroups.mockResolvedValue([existing as any])
      repository.updateSystemGroup.mockResolvedValue({ ...baseGroup, id: 7 } as any)
      repository.updateCredential.mockResolvedValue({
        ...baseCredential,
        id: 7,
        apiKeyLabel: '组 A',
        secretVaultId: null,
      } as any)

      await expect(
        service.updateSystemConnection(7, {
          displayName: 'OpenAI',
          provider: 'openai',
          baseUrl: 'https://api.openai.com/v1',
          authType: 'bearer',
          apiKeys: [{ id: 7, apiKeyLabel: '组 A', modelIds: ['gpt-4o'] }],
        }),
      ).rejects.toThrow(ConnectionServiceError)
    })

    it('resolves legacy credential id to its group (dual-read)', async () => {
      const { service, repository } = buildService()
      const existing = groupWithCredentials(
        { id: 3, displayName: 'OpenAI' },
        [{ id: 77, apiKeyLabel: '组 A', secretVaultId: 100 }],
      )
      repository.findSystemGroupById
        .mockResolvedValueOnce(null)
        .mockResolvedValue(existing as any)
      repository.listSystemGroups.mockResolvedValue([existing as any])
      repository.updateSystemGroup.mockResolvedValue({ ...baseGroup, id: 3 } as any)
      repository.updateCredential.mockResolvedValue({
        ...baseCredential,
        id: 77,
        connectionGroupId: 3,
        secretVaultId: 100,
      } as any)

      const updated = await service.updateSystemConnection(77, {
        displayName: 'OpenAI',
        provider: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        authType: 'bearer',
        apiKeys: [{ id: 77, apiKeyLabel: '组 A', modelIds: ['gpt-4o'] }],
      })

      expect(repository.updateSystemGroup).toHaveBeenCalledWith(3, expect.any(Object))
      expect(updated.id).toBe(3)
    })
  })

  describe('verifyConnectionConfig with Secret Vault', () => {
    it('new key uses payload apiKey plaintext directly', async () => {
      const { service, repository } = buildService()
      repository.listSystemGroups.mockResolvedValue([])

      const result = await service.verifyConnectionConfig({
        displayName: 'OpenAI',
        provider: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        authType: 'bearer',
        apiKeys: [{ apiKeyLabel: 'K', apiKey: 'sk-new-key', modelIds: ['gpt-4o'] }],
      })

      expect(result.results[0]?.success).toBe(true)
    })

    it('existing key without apiKey decrypts via secretVaultId', async () => {
      const { service, repository, secretVault } = buildService()
      repository.listSystemGroups.mockResolvedValue([
        groupWithCredentials({ id: 1 }, [{ id: 1, secretVaultId: 100 }]) as any,
      ])

      const result = await service.verifyConnectionConfig({
        displayName: 'OpenAI',
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
      repository.listSystemGroups.mockResolvedValue([
        groupWithCredentials({ id: 1 }, [{ id: 1, secretVaultId: 100 }]) as any,
      ])
      secretVault!.decryptById.mockRejectedValue(new Error('Vault corrupted'))

      const result = await service.verifyConnectionConfig({
        displayName: 'OpenAI',
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
      repository.listSystemGroups.mockResolvedValue([])
      repository.createSystemGroup.mockResolvedValue({ ...baseGroup, id: 1 } as any)
      repository.createCredential.mockResolvedValue({
        ...baseCredential,
        id: 1,
        secretVaultId: null,
      } as any)

      await expect(
        service.createSystemConnection({
          displayName: 'OpenAI',
          provider: 'openai',
          baseUrl: 'https://api.openai.com/v1',
          authType: 'bearer',
          apiKeys: [{ apiKeyLabel: 'K', apiKey: 'some-key', modelIds: ['gpt-4o'] }],
        }),
      ).rejects.toThrow(ConnectionServiceError)
    })
  })

  describe('common', () => {
    it('lists groups with stable group id and hasStoredApiKey from credentials', async () => {
      const { service, repository } = buildService()
      repository.listSystemGroups.mockResolvedValue([
        groupWithCredentials(
          { id: 5, displayName: 'OpenAI' },
          [
            { id: 1, secretVaultId: 100, apiKeyLabel: '有密钥' },
            { id: 2, secretVaultId: null, apiKeyLabel: '无密钥' },
          ],
        ) as any,
      ])

      const groups = await service.listSystemConnections()

      expect(groups).toHaveLength(1)
      expect(groups[0]?.id).toBe(5)
      expect(groups[0]?.displayName).toBe('OpenAI')
      expect(groups[0]?.connectionIds).toEqual([2, 1])
      expect(groups[0]?.apiKeys[0]?.apiKeyLabel).toBe('无密钥')
      expect(groups[0]?.apiKeys[0]?.hasStoredApiKey).toBe(false)
      expect(groups[0]?.apiKeys[1]?.apiKeyLabel).toBe('有密钥')
      expect(groups[0]?.apiKeys[1]?.hasStoredApiKey).toBe(true)
    })

    it('deletes the connection group (catalog cascades)', async () => {
      const { service, repository } = buildService()
      repository.findSystemGroupById.mockResolvedValue(groupWithCredentials({ id: 5 }) as any)

      await service.deleteSystemConnection(5)

      expect(repository.deleteSystemGroup).toHaveBeenCalledWith(5)
      expect(repository.deleteCredential).not.toHaveBeenCalled()
    })

    it('throws when updating a missing endpoint group', async () => {
      const { service, repository } = buildService()
      repository.findSystemGroupById.mockResolvedValue(null)
      repository.listSystemGroups.mockResolvedValue([])

      await expect(
        service.updateSystemConnection(999, {
          displayName: 'Missing',
          provider: 'openai',
          baseUrl: 'https://api.openai.com/v1',
          apiKeys: [{ apiKeyLabel: 'K', apiKey: 'k', modelIds: ['gpt-4o'] }],
        }),
      ).rejects.toThrow(ConnectionServiceError)
    })
  })

  describe('exportSystemConnections', () => {
    it('exports schemaVersion 2 with displayName and decrypted apiKey', async () => {
      const { service, repository, secretVault } = buildService()
      const plainKey = 'sk-export-plaintext-key-xyz'
      repository.listSystemGroups.mockResolvedValue([
        groupWithCredentials(
          { id: 1, displayName: 'Main' },
          [{ id: 1, secretVaultId: 100, apiKeyLabel: '主 Key' }],
        ) as any,
      ])
      secretVault!.decryptById.mockResolvedValue(plainKey)

      const exported = await service.exportSystemConnections({ userId: 42 })
      const listed = await service.listSystemConnections()

      expect(exported.schemaVersion).toBe(2)
      expect(exported.connections).toHaveLength(1)
      expect(exported.connections[0]?.displayName).toBe('Main')
      expect(exported.connections[0]?.apiKeys[0]?.apiKey).toBe(plainKey)
      expect(exported.skippedKeys).toBe(0)
      expect(listed[0]?.apiKeys[0]?.apiKeyMasked).toBe('****')
    })

    it('counts decrypt failures in skippedKeys and still exports other groups', async () => {
      const { service, repository, secretVault } = buildService()
      repository.listSystemGroups.mockResolvedValue([
        groupWithCredentials(
          { id: 1, displayName: 'Bad', baseUrl: 'https://bad.example/v1' },
          [{ id: 1, secretVaultId: 100, apiKeyLabel: '坏 Key' }],
        ) as any,
        groupWithCredentials(
          { id: 2, displayName: 'Good', baseUrl: 'https://good.example/v1' },
          [{ id: 2, secretVaultId: 101, apiKeyLabel: '好 Key' }],
        ) as any,
      ])
      secretVault!.decryptById.mockImplementation(async (id: number) => {
        if (id === 100) throw new Error('Vault corrupted')
        return 'good-plain-key'
      })

      const exported = await service.exportSystemConnections()

      expect(exported.connections).toHaveLength(1)
      expect(exported.connections[0]?.baseUrl).toBe('https://good.example/v1')
      expect(exported.connections[0]?.apiKeys[0]?.apiKey).toBe('good-plain-key')
      expect(exported.skippedKeys).toBe(1)
    })
  })

  describe('importSystemConnections', () => {
    const importPayload = {
      schemaVersion: 1 as const,
      connections: [
        {
          provider: 'openai' as const,
          baseUrl: 'https://api.new.example/v1',
          authType: 'bearer' as const,
          apiKeys: [{ apiKeyLabel: '新 Key', apiKey: 'brand-new-import-key', modelIds: ['gpt-4o'] }],
        },
      ],
    }

    it('creates a new group when signature does not exist and seeds displayName for v1', async () => {
      const { service, repository } = buildService()
      repository.listSystemGroups.mockResolvedValue([])
      repository.createSystemGroup.mockResolvedValue({
        ...baseGroup,
        id: 50,
        displayName: 'new',
      } as any)
      repository.createCredential.mockResolvedValue({
        ...baseCredential,
        id: 50,
        connectionGroupId: 50,
        secretVaultId: null,
      } as any)
      repository.findSystemGroupById.mockResolvedValue(
        groupWithCredentials({ id: 50, displayName: 'new' }, [{ id: 50 }]) as any,
      )

      const result = await service.importSystemConnections(importPayload, { userId: 7 })

      expect(repository.createSystemGroup).toHaveBeenCalledWith(
        expect.objectContaining({ displayName: 'new' }),
      )
      expect(result.createdGroups).toBe(1)
      expect(result.addedKeys).toBe(1)
    })

    it('merges into existing signature group: skips duplicate plaintext and appends new keys', async () => {
      const { service, repository, secretVault } = buildService()
      const existingKey = 'existing-merge-key-abc'
      const newKey = 'new-merge-key-def'
      const existing = groupWithCredentials(
        { id: 7, displayName: 'OpenAI' },
        [{ id: 7, apiKeyLabel: '已有 Key', secretVaultId: 100 }],
      )
      repository.listSystemGroups.mockResolvedValue([existing as any])
      repository.findSystemGroupById.mockResolvedValue(existing as any)
      secretVault!.decryptById.mockResolvedValue(existingKey)
      repository.updateSystemGroup.mockResolvedValue({ ...baseGroup, id: 7 } as any)
      repository.updateCredential.mockResolvedValue({
        ...baseCredential,
        id: 7,
        apiKeyLabel: '已有 Key',
        secretVaultId: 100,
      } as any)
      repository.createCredential.mockResolvedValue({
        ...baseCredential,
        id: 8,
        apiKeyLabel: '追加 Key',
        secretVaultId: 200,
      } as any)

      const result = await service.importSystemConnections({
        schemaVersion: 1,
        connections: [
          {
            provider: 'openai',
            baseUrl: 'https://api.openai.com/v1',
            authType: 'bearer',
            apiKeys: [
              { apiKeyLabel: '重复', apiKey: existingKey, modelIds: ['gpt-4o'] },
              { apiKeyLabel: '追加 Key', apiKey: newKey, modelIds: ['gpt-4.1-mini'] },
            ],
          },
        ],
      })

      expect(repository.createCredential).toHaveBeenCalledTimes(1)
      expect(result.createdGroups).toBe(0)
      expect(result.updatedGroups).toBe(1)
      expect(result.addedKeys).toBe(1)
      expect(result.skippedKeys).toBe(1)
    })

    it('counts existing-key decrypt failures in skippedKeys during merge dedupe', async () => {
      const { service, repository, secretVault } = buildService()
      const existing = groupWithCredentials(
        { id: 7, displayName: 'OpenAI' },
        [{ id: 7, apiKeyLabel: '坏 Key', secretVaultId: 100 }],
      )
      repository.listSystemGroups.mockResolvedValue([existing as any])
      repository.findSystemGroupById.mockResolvedValue(existing as any)
      secretVault!.decryptById.mockRejectedValue(new Error('Vault corrupted'))
      repository.updateSystemGroup.mockResolvedValue({ ...baseGroup, id: 7 } as any)
      repository.updateCredential.mockResolvedValue({
        ...baseCredential,
        id: 7,
        secretVaultId: 100,
      } as any)
      repository.createCredential.mockResolvedValue({
        ...baseCredential,
        id: 8,
        apiKeyLabel: '新 Key',
        secretVaultId: 200,
      } as any)

      const result = await service.importSystemConnections({
        schemaVersion: 1,
        connections: [
          {
            provider: 'openai',
            baseUrl: 'https://api.openai.com/v1',
            authType: 'bearer',
            apiKeys: [{ apiKeyLabel: '新 Key', apiKey: 'fresh-import-key', modelIds: ['gpt-4o'] }],
          },
        ],
      })

      expect(result.skippedKeys).toBe(1)
      expect(result.addedKeys).toBe(1)
      expect(result.updatedGroups).toBe(1)
      expect(result.skippedReasons.some((reason) => reason.includes('解密失败'))).toBe(true)
    })

    it('calls logger.info without any plaintext apiKey substring in meta', async () => {
      const { service, repository, secretVault, logger } = buildService()
      const sensitiveKey = 'super-secret-import-key-999'
      repository.listSystemGroups.mockResolvedValue([])
      repository.createSystemGroup.mockResolvedValue({ ...baseGroup, id: 1 } as any)
      repository.createCredential.mockResolvedValue({
        ...baseCredential,
        id: 1,
        secretVaultId: null,
      } as any)
      repository.findSystemGroupById.mockResolvedValue(groupWithCredentials() as any)
      secretVault!.decryptById.mockResolvedValue(sensitiveKey)

      await service.exportSystemConnections({ userId: 1 })
      await service.importSystemConnections(
        {
          schemaVersion: 2,
          connections: [
            {
              displayName: 'OpenAI',
              provider: 'openai',
              baseUrl: 'https://api.openai.com/v1',
              authType: 'bearer',
              apiKeys: [{ apiKeyLabel: 'K', apiKey: sensitiveKey, modelIds: ['gpt-4o'] }],
            },
          ],
        },
        { userId: 1 },
      )

      expect(logger.info).toHaveBeenCalled()
      for (const call of logger.info.mock.calls) {
        const serialized = JSON.stringify(call)
        expect(serialized).not.toContain(sensitiveKey)
        expect(serialized).not.toContain('super-secret-import-key')
      }
    })
  })
})
