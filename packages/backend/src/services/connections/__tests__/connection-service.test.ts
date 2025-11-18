import { ConnectionService, ConnectionServiceError } from '../connection-service'

const createMockPrisma = () => ({
  connection: {
    findMany: jest.fn(),
    create: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  modelCatalog: {
    deleteMany: jest.fn(),
  },
})

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
  const prisma = createMockPrisma()
  const encryptApiKey = jest.fn().mockImplementation((value: string) => `enc:${value}`)
  const refreshModelCatalog = jest.fn().mockResolvedValue(undefined)
  const verifyConnection = jest.fn().mockResolvedValue(undefined)
  const logger = { warn: jest.fn(), error: jest.fn() }

  const service = new ConnectionService({
    prisma: prisma as any,
    encryptApiKey,
    refreshModelCatalog,
    verifyConnection,
    logger,
  })

  return { service, prisma, encryptApiKey, refreshModelCatalog, verifyConnection, logger }
}

describe('ConnectionService', () => {
  it('creates system connection and refreshes catalog', async () => {
    const { service, prisma, encryptApiKey, refreshModelCatalog } = buildService()
    prisma.connection.create.mockResolvedValue({ ...baseConnection, id: 9 })

    const payload = {
      provider: 'openai' as const,
      baseUrl: 'https://api.openai.com/v1/',
      authType: 'bearer' as const,
      apiKey: 'key',
      tags: [{ name: 'vision' }],
      modelIds: ['gpt-4o'],
    }

    const created = await service.createSystemConnection(payload)

    expect(prisma.connection.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        baseUrl: 'https://api.openai.com/v1',
        tagsJson: JSON.stringify(payload.tags),
        modelIdsJson: JSON.stringify(payload.modelIds),
      }),
    })
    expect(encryptApiKey).toHaveBeenCalledWith('key')
    expect(refreshModelCatalog).toHaveBeenCalledWith(expect.objectContaining({ id: 9 }))
    expect(created.id).toBe(9)
  })

  it('throws when updating nonexistent connection', async () => {
    const { service, prisma } = buildService()
    prisma.connection.findUnique.mockResolvedValue(null)

    await expect(
      service.updateSystemConnection(123, { baseUrl: 'https://example.com/v1' }),
    ).rejects.toBeInstanceOf(ConnectionServiceError)
  })

  it('updates connection and refreshes catalog', async () => {
    const { service, prisma, refreshModelCatalog } = buildService()
    prisma.connection.findUnique.mockResolvedValue({ ...baseConnection, id: 2 })
    prisma.connection.update.mockResolvedValue({ ...baseConnection, id: 2, baseUrl: 'https://new.com/v1' })

    const result = await service.updateSystemConnection(2, {
      baseUrl: 'https://new.com/v1/',
      tags: [{ name: 'vision' }],
    })

    expect(prisma.connection.update).toHaveBeenCalledWith({
      where: { id: 2 },
      data: expect.objectContaining({
        baseUrl: 'https://new.com/v1',
        tagsJson: JSON.stringify([{ name: 'vision' }]),
      }),
    })
    expect(refreshModelCatalog).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }))
    expect(result.baseUrl).toBe('https://new.com/v1')
  })

  it('deletes system connection and clears catalog entries', async () => {
    const { service, prisma } = buildService()
    prisma.connection.findUnique.mockResolvedValue({ ...baseConnection, id: 3 })
    prisma.connection.delete.mockResolvedValue({})

    await service.deleteSystemConnection(3)

    expect(prisma.connection.delete).toHaveBeenCalledWith({ where: { id: 3 } })
    expect(prisma.modelCatalog.deleteMany).toHaveBeenCalledWith({ where: { connectionId: 3 } })
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
