import { ModelCatalogService, ModelCatalogServiceError } from './model-catalog-service'

const buildService = () => {
  const prisma = {
    connectionGroup: {
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
  const refreshForGroups = jest.fn()
  const refreshByGroupId = jest.fn()
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
    refreshModelCatalogForConnectionGroups: refreshForGroups,
    refreshModelCatalogForConnectionGroupId: refreshByGroupId,
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
    refreshForGroups,
    refreshByGroupId,
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
  it('returns empty list when no connection groups exist', async () => {
    const { prisma, service } = buildService()
    prisma.connectionGroup.findMany.mockResolvedValueOnce([])
    const result = await service.listModels()
    expect(result).toEqual([])
    expect(prisma.modelCatalog.findMany).not.toHaveBeenCalled()
  })

  it('lists models with connectionId = group id and displayName', async () => {
    const { prisma, service, deriveChannelName } = buildService()
    prisma.connectionGroup.findMany.mockResolvedValueOnce([
      {
        id: 11,
        displayName: 'Prod OpenAI',
        provider: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        enable: true,
        ownerUserId: null,
        credentials: [],
      },
    ])
    prisma.modelCatalog.findMany.mockResolvedValueOnce([
      {
        modelId: 'gpt-4o',
        rawId: 'gpt-4o',
        name: 'gpt-4o',
        provider: 'openai',
        connectionGroupId: 11,
        connectionType: 'external',
        modelType: 'chat',
        tagsJson: '[]',
        metaJson: '{}',
        capabilitiesJson: '{}',
        manualOverride: false,
        expiresAt: new Date('2099-01-01T00:00:00Z'),
      },
    ])

    const result = await service.listModels({
      type: 'user',
      id: 1,
      username: 'admin',
      role: 'ADMIN',
      status: 'ACTIVE',
      identifier: 'a1',
    } as any)

    expect(result).toHaveLength(1)
    expect(result[0]?.connectionId).toBe(11)
    expect(result[0]?.displayName).toBe('Prod OpenAI')
    expect(deriveChannelName).toHaveBeenCalledWith('openai', 'https://api.openai.com/v1')
  })

  it('creates override when entry does not exist', async () => {
    const { prisma, service, invalidateCompletionLimitCache, invalidateContextWindowCache } =
      buildService()
    prisma.connectionGroup.findUnique.mockResolvedValue({
      id: 1,
      provider: 'openai',
      connectionType: 'external',
      prefixId: null,
    })
    prisma.modelCatalog.findFirst.mockResolvedValue(null)
    await service.saveOverride({
      connectionId: 1,
      rawId: 'gpt-4',
      tagsInput: [{ name: 'test' }],
      maxOutputTokens: 1024,
    })
    expect(prisma.modelCatalog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          manualOverride: true,
          connectionGroupId: 1,
          rawId: 'gpt-4',
        }),
      }),
    )
    expect(invalidateCompletionLimitCache).toHaveBeenCalledWith(1, 'gpt-4')
    expect(invalidateContextWindowCache).toHaveBeenCalledWith(1, 'gpt-4')
  })

  it('throws when connection group missing on override save', async () => {
    const { service, prisma } = buildService()
    prisma.connectionGroup.findUnique.mockResolvedValue(null)
    await expect(
      service.saveOverride({ connectionId: 1, rawId: 'missing' }),
    ).rejects.toThrow(ModelCatalogServiceError)
  })

  it('deletes overrides in bulk and refreshes per connection group', async () => {
    const { service, prisma, refreshByGroupId } = buildService()
    prisma.connectionGroup.findMany.mockResolvedValue([{ id: 1, prefixId: 'px' }])
    prisma.modelCatalog.deleteMany.mockResolvedValue({ count: 2 })
    const count = await service.deleteOverrides({
      all: false,
      items: [{ connectionId: 1, rawId: 'model' }],
    })
    expect(count).toBe(2)
    expect(refreshByGroupId).toHaveBeenCalledWith(1)
  })
})
