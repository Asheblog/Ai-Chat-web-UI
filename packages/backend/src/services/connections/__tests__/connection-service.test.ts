import { ConnectionService, ConnectionServiceError } from '../connection-service'
import type { ConnectionRepository } from '../../../repositories/connection-repository'

const baseConnection = {
  id: 1,
  ownerUserId: null,
  provider: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  enable: true,
  authType: 'bearer',
  apiKey: '',
  headersJson: '',
  azureApiVersion: null,
  prefixId: null,
  tagsJson: '[]',
  modelIdsJson: '[]',
  defaultCapabilitiesJson: '{}',
  connectionType: 'external',
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
  const refreshModelCatalog = jest.fn().mockResolvedValue(undefined)
  const verifyConnection = jest.fn().mockResolvedValue(undefined)
  const logger = { warn: jest.fn(), error: jest.fn() }

  const service = new ConnectionService({
    repository,
    encryptApiKey,
    refreshModelCatalog,
    verifyConnection,
    logger,
  })

  return { service, repository, encryptApiKey, refreshModelCatalog, verifyConnection, logger }
}

describe('ConnectionService', () => {
  it('creates system connection and refreshes catalog', async () => {
    const { service, repository, encryptApiKey, refreshModelCatalog } = buildService()
    repository.createSystemConnection.mockResolvedValue({ ...baseConnection, id: 9 } as any)

    const payload = {
      provider: 'openai' as const,
      baseUrl: 'https://api.openai.com/v1/',
      authType: 'bearer' as const,
      apiKey: 'key',
      tags: [{ name: 'vision' }],
      modelIds: ['gpt-4o'],
    }

    const created = await service.createSystemConnection(payload)

    expect(repository.createSystemConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: 'https://api.openai.com/v1',
        tagsJson: JSON.stringify(payload.tags),
        modelIdsJson: JSON.stringify(payload.modelIds),
      }),
    )
    expect(encryptApiKey).toHaveBeenCalledWith('key')
    expect(refreshModelCatalog).toHaveBeenCalledWith(expect.objectContaining({ id: 9 }))
    expect(created.id).toBe(9)
  })

  it('throws when updating nonexistent connection', async () => {
    const { service, repository } = buildService()
    repository.findSystemConnectionById.mockResolvedValue(null)

    await expect(
      service.updateSystemConnection(123, { baseUrl: 'https://example.com/v1' }),
    ).rejects.toBeInstanceOf(ConnectionServiceError)
  })

  it('updates connection and refreshes catalog', async () => {
    const { service, repository, refreshModelCatalog } = buildService()
    repository.findSystemConnectionById.mockResolvedValue({ ...baseConnection, id: 2 } as any)
    repository.updateSystemConnection.mockResolvedValue({ ...baseConnection, id: 2, baseUrl: 'https://new.com/v1' } as any)

    const result = await service.updateSystemConnection(2, {
      baseUrl: 'https://new.com/v1/',
      tags: [{ name: 'vision' }],
    })

    expect(repository.updateSystemConnection).toHaveBeenCalledWith(
      2,
      expect.objectContaining({
        baseUrl: 'https://new.com/v1',
        tagsJson: JSON.stringify([{ name: 'vision' }]),
      }),
    )
    expect(refreshModelCatalog).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }))
    expect(result.baseUrl).toBe('https://new.com/v1')
  })

  it('deletes system connection and clears catalog entries', async () => {
    const { service, repository } = buildService()
    repository.findSystemConnectionById.mockResolvedValue({ ...baseConnection, id: 3 } as any)
    repository.deleteSystemConnection.mockResolvedValue()

    await service.deleteSystemConnection(3)

    expect(repository.deleteSystemConnection).toHaveBeenCalledWith(3)
    expect(repository.deleteModelCatalogByConnectionId).toHaveBeenCalledWith(3)
  })

  it('verifies connection config and surfaces provider error', async () => {
    const { service, verifyConnection } = buildService()
    verifyConnection.mockRejectedValue(new Error('bad config'))

    await expect(
      service.verifyConnectionConfig({
        provider: 'openai',
        baseUrl: 'https://api.openai.com/v1',
      }),
    ).rejects.toThrow('bad config')
  })
})
