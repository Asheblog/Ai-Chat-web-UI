import { ConnectionService, ConnectionServiceError } from '../connection-service'
import type { ConnectionRepository } from '../../../repositories/connection-repository'

const now = new Date('2026-03-31T08:00:00.000Z')

const baseConnection = {
  id: 1,
  ownerUserId: null,
  provider: 'openai',
  vendor: null,
  baseUrl: 'https://api.openai.com/v1',
  enable: true,
  authType: 'bearer',
  apiKey: 'enc:key-a',
  apiKeyLabel: '主分组',
  headersJson: '',
  azureApiVersion: null,
  prefixId: null,
  tagsJson: '[]',
  modelIdsJson: '["gpt-4o"]',
  defaultCapabilitiesJson: '{}',
  connectionType: 'external',
  createdAt: now,
  updatedAt: now,
}

const buildService = () => {
  const repository: jest.Mocked<ConnectionRepository> = {
    listSystemConnections: jest.fn(),
    createSystemConnection: jest.fn(),
    findSystemConnectionById: jest.fn(),
    updateSystemConnection: jest.fn(),
    deleteSystemConnection: jest.fn(),
    deleteModelCatalogByConnectionId: jest.fn(),
  }
  const encryptApiKey = jest.fn().mockImplementation((value: string) => `enc:${value}`)
  const decryptApiKey = jest.fn().mockImplementation((value: string) => value.replace(/^enc:/, ''))
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
  const logger = { warn: jest.fn(), error: jest.fn() }

  const service = new ConnectionService({
    repository,
    encryptApiKey,
    decryptApiKey,
    refreshModelCatalog,
    fetchModelsForConnection,
    verifyConnection,
    logger,
  })

  return {
    service,
    repository,
    encryptApiKey,
    decryptApiKey,
    refreshModelCatalog,
    fetchModelsForConnection,
    verifyConnection,
    logger,
  }
}

describe('ConnectionService', () => {
  it('creates grouped system connections and refreshes each key entry', async () => {
    const { service, repository, encryptApiKey, refreshModelCatalog } = buildService()
    repository.createSystemConnection
      .mockResolvedValueOnce({ ...baseConnection, id: 9, apiKeyLabel: '组 A' } as any)
      .mockResolvedValueOnce({ ...baseConnection, id: 10, apiKeyLabel: '组 B', apiKey: 'enc:key-b' } as any)

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

    expect(repository.createSystemConnection).toHaveBeenCalledTimes(2)
    expect(repository.createSystemConnection).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        baseUrl: 'https://api.openai.com/v1',
        apiKeyLabel: '组 A',
        modelIdsJson: JSON.stringify(['gpt-4o']),
        tagsJson: JSON.stringify([{ name: 'vision' }]),
      }),
    )
    expect(encryptApiKey).toHaveBeenCalledWith('key-a')
    expect(encryptApiKey).toHaveBeenCalledWith('key-b')
    expect(refreshModelCatalog).toHaveBeenCalledTimes(2)
    expect(created.apiKeys).toHaveLength(2)
  })

  it('groups flat connections into endpoint groups when listing', async () => {
    const { service, repository, decryptApiKey } = buildService()
    repository.listSystemConnections.mockResolvedValue([
      { ...baseConnection, id: 1, apiKeyLabel: '组 A', apiKey: 'enc:key-a' } as any,
      { ...baseConnection, id: 2, apiKeyLabel: '组 B', apiKey: 'enc:key-b', modelIdsJson: '["gpt-4.1"]' } as any,
    ])

    const groups = await service.listSystemConnections()

    expect(groups).toHaveLength(1)
    expect(groups[0]?.apiKeys).toHaveLength(2)
    expect(groups[0]?.apiKeys[0]?.apiKeyMasked).toBeTruthy()
    expect(decryptApiKey).toHaveBeenCalled()
  })

  it('updates existing group entries and preserves stored api key when left blank', async () => {
    const { service, repository, refreshModelCatalog } = buildService()
    repository.listSystemConnections.mockResolvedValue([
      { ...baseConnection, id: 7, apiKeyLabel: '组 A', apiKey: 'enc:keep-me' } as any,
    ])
    repository.updateSystemConnection.mockResolvedValue({
      ...baseConnection,
      id: 7,
      apiKeyLabel: '组 A',
      apiKey: 'enc:keep-me',
      modelIdsJson: '["gpt-4o","gpt-4.1-mini"]',
    } as any)

    const updated = await service.updateSystemConnection(7, {
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      authType: 'bearer',
      apiKeys: [
        { id: 7, apiKeyLabel: '组 A', modelIds: ['gpt-4o', 'gpt-4.1-mini'] },
      ],
    })

    expect(repository.updateSystemConnection).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        apiKey: 'enc:keep-me',
        modelIdsJson: JSON.stringify(['gpt-4o', 'gpt-4.1-mini']),
      }),
    )
    expect(refreshModelCatalog).toHaveBeenCalledTimes(1)
    expect(updated.apiKeys[0]?.modelIds).toEqual(['gpt-4o', 'gpt-4.1-mini'])
  })

  it('deletes all connections in the same endpoint group', async () => {
    const { service, repository } = buildService()
    repository.listSystemConnections.mockResolvedValue([
      { ...baseConnection, id: 3, apiKeyLabel: 'A' } as any,
      { ...baseConnection, id: 4, apiKeyLabel: 'B', apiKey: 'enc:key-b' } as any,
    ])
    repository.deleteSystemConnection.mockResolvedValue()

    await service.deleteSystemConnection(3)

    expect(repository.deleteSystemConnection).toHaveBeenCalledTimes(2)
    expect(repository.deleteModelCatalogByConnectionId).toHaveBeenCalledWith(3)
    expect(repository.deleteModelCatalogByConnectionId).toHaveBeenCalledWith(4)
  })

  it('returns per-key verify results instead of throwing on a single key failure', async () => {
    const { service, verifyConnection } = buildService()
    verifyConnection
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('bad config'))

    const result = await service.verifyConnectionConfig({
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      authType: 'bearer',
      apiKeys: [
        { apiKeyLabel: '组 A', apiKey: 'key-a', modelIds: ['gpt-4o'] },
        { apiKeyLabel: '组 B', apiKey: 'key-b', modelIds: ['gpt-4.1-mini'] },
      ],
    })

    expect(result.successCount).toBe(1)
    expect(result.failureCount).toBe(1)
    expect(result.results[1]?.error).toContain('bad config')
  })

  it('throws when updating a missing endpoint group', async () => {
    const { service, repository } = buildService()
    repository.listSystemConnections.mockResolvedValue([])

    await expect(
      service.updateSystemConnection(404, {
        provider: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        authType: 'bearer',
        apiKeys: [{ apiKeyLabel: '组 A', apiKey: 'key-a', modelIds: [] }],
      }),
    ).rejects.toBeInstanceOf(ConnectionServiceError)
  })
})
