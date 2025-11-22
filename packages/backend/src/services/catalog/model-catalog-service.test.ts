import { ModelCatalogService, ModelCatalogServiceError } from './model-catalog-service'

const buildService = () => {
  const prisma = {
    connection: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    modelCatalog: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      deleteMany: jest.fn(),
    },
  }

  const refreshAll = jest.fn()
  const refreshForConnections = jest.fn()
  const refreshById = jest.fn()
  const computeCapabilities = jest.fn(() => ({} as any))
  const deriveChannelName = jest.fn(() => 'channel')
  const parseCapabilityEnvelope = jest.fn(() => ({ flags: undefined, source: null }))
  const normalizeCapabilityFlags = jest.fn((value) => value as any)
  const serializeCapabilityEnvelope = jest.fn(() => JSON.stringify({}))
  const invalidateCompletionLimitCache = jest.fn()
  const invalidateContextWindowCache = jest.fn()
  const now = () => new Date('2024-01-01T00:00:00Z')
  const getModelAccessDefaults = jest.fn(async () => ({ anonymous: 'deny', user: 'allow' }))
  const resolveModelAccessPolicy = jest.fn(({ defaults }) => ({
    policy: null,
    resolved: {
      anonymous: { decision: defaults.anonymous, source: 'default' },
      user: { decision: defaults.user, source: 'default' },
    },
  }))

  const service = new ModelCatalogService({
    prisma: prisma as any,
    refreshAllModelCatalog: refreshAll,
    refreshModelCatalogForConnections: refreshForConnections,
    refreshModelCatalogForConnectionId: refreshById,
    computeCapabilities,
    deriveChannelName,
    parseCapabilityEnvelope,
    normalizeCapabilityFlags,
    serializeCapabilityEnvelope,
    invalidateCompletionLimitCache,
    invalidateContextWindowCache,
    now,
    getModelAccessDefaults,
    resolveModelAccessPolicy,
  })

  return {
    prisma,
    refreshAll,
    refreshForConnections,
    refreshById,
    computeCapabilities,
    deriveChannelName,
    parseCapabilityEnvelope,
    normalizeCapabilityFlags,
    serializeCapabilityEnvelope,
    invalidateCompletionLimitCache,
    invalidateContextWindowCache,
    service,
  }
}

describe('ModelCatalogService', () => {
  it('returns empty list when no connections exist', async () => {
    const { prisma, service } = buildService()
    prisma.connection.findMany.mockResolvedValueOnce([])
    const result = await service.listModels()
    expect(result).toEqual([])
    expect(prisma.modelCatalog.findMany).not.toHaveBeenCalled()
  })

  it('creates override when entry does not exist', async () => {
    const { prisma, service, invalidateCompletionLimitCache, invalidateContextWindowCache } = buildService()
    prisma.connection.findUnique.mockResolvedValue({ id: 1, provider: 'openai', connectionType: 'external', prefixId: null })
    prisma.modelCatalog.findFirst.mockResolvedValue(null)
    await service.saveOverride({ connectionId: 1, rawId: 'gpt-4', tagsInput: [{ name: 'test' }], maxOutputTokens: 1024 })
    expect(prisma.modelCatalog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ manualOverride: true, connectionId: 1, rawId: 'gpt-4' }),
    }))
    expect(invalidateCompletionLimitCache).toHaveBeenCalledWith(1, 'gpt-4')
    expect(invalidateContextWindowCache).toHaveBeenCalledWith(1, 'gpt-4')
  })

  it('throws when connection missing on override save', async () => {
    const { service, prisma } = buildService()
    prisma.connection.findUnique.mockResolvedValue(null)
    await expect(service.saveOverride({ connectionId: 1, rawId: 'missing' })).rejects.toThrow(ModelCatalogServiceError)
  })

  it('deletes overrides in bulk and refreshes per connection', async () => {
    const { service, prisma, refreshById } = buildService()
    prisma.connection.findMany.mockResolvedValue([{ id: 1, prefixId: 'px' }])
    prisma.modelCatalog.deleteMany.mockResolvedValue({ count: 2 })
    const count = await service.deleteOverrides({ all: false, items: [{ connectionId: 1, rawId: 'model' }] })
    expect(count).toBe(2)
    expect(refreshById).toHaveBeenCalledWith(1)
  })
})
