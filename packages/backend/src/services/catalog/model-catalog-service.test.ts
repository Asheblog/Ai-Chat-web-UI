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
  test.each(['azure_openai', 'ollama'])('hides %s and rejects model overrides without writes', async (provider) => {
    const { prisma, service, refreshForGroups } = buildService()
    prisma.connectionGroup.findMany.mockResolvedValue([{ id: 1, provider }])
    prisma.connectionGroup.findUnique.mockResolvedValue({ id: 1, provider })
    expect(await service.listModels()).toEqual([])
    await expect(service.saveOverride({ connectionId: 1, rawId: 'model' })).rejects.toThrow('Unsupported provider')
    await expect(service.deleteOverrides({ all: false, items: [{ connectionId: 1, rawId: 'model' }] })).rejects.toThrow('Unsupported provider')
    expect(prisma.modelCatalog.findMany).not.toHaveBeenCalled()
    expect(prisma.modelCatalog.create).not.toHaveBeenCalled()
    expect(prisma.modelCatalog.deleteMany).not.toHaveBeenCalled()
    expect(refreshForGroups).not.toHaveBeenCalled()
  })

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
    prisma.connectionGroup.findMany.mockResolvedValue([{ id: 1, prefixId: 'px', provider: 'openai' }])
    prisma.modelCatalog.deleteMany.mockResolvedValue({ count: 2 })
    const count = await service.deleteOverrides({
      all: false,
      items: [{ connectionId: 1, rawId: 'model' }],
    })
    expect(count).toBe(2)
    expect(refreshByGroupId).toHaveBeenCalledWith(1)
  })

  it('exposes field-scoped override state and supported efforts per model', async () => {
    const { prisma, service } = buildService()
    prisma.connectionGroup.findMany.mockResolvedValueOnce([
      {
        id: 11,
        displayName: 'Prod OpenAI',
        provider: 'openai',
        thinkingDialect: 'off',
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
        metaJson: JSON.stringify({ access_policy: { user: 'allow' }, temperature: 0.2 }),
        capabilitiesJson: JSON.stringify({ flags: { vision: true }, source: 'manual' }),
        manualOverride: true,
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

    expect(result[0]?.overrides).toEqual({
      capability: true,
      parameters: true,
      access: true,
      any: true,
    })
    expect(result[0]?.efforts).toEqual(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
  })

  it('stores a manual context window under the manual key only', async () => {
    const { prisma, service, parseCapabilityEnvelope } = buildService()
    parseCapabilityEnvelope.mockReturnValue(null)
    prisma.connectionGroup.findUnique.mockResolvedValue({
      id: 1,
      provider: 'openai',
      thinkingDialect: 'off',
      prefixId: null,
    })
    prisma.modelCatalog.findFirst.mockResolvedValue({
      id: 9,
      capabilitiesJson: '{}',
      metaJson: JSON.stringify({ context_window: 32000 }),
      manualOverride: false,
    })
    await service.saveOverride({ connectionId: 1, rawId: 'gpt-4', contextWindow: 128000 })
    const update = prisma.modelCatalog.update.mock.calls[0][0]
    const meta = JSON.parse(update.data.metaJson)
    expect(meta.custom_context_window).toBe(128000)
    expect(meta.context_window).toBe(32000)
    expect(update.data.manualOverride).toBe(true)
  })

  it('clears only the requested override scope instead of deleting the row', async () => {
    const { prisma, service, refreshByGroupId } = buildService()
    prisma.connectionGroup.findMany.mockResolvedValue([
      { id: 1, prefixId: 'px', provider: 'openai', thinkingDialect: 'off' },
    ])
    prisma.modelCatalog.findFirst.mockResolvedValue({
      id: 7,
      capabilitiesJson: JSON.stringify({ flags: { vision: true }, source: 'manual' }),
      metaJson: JSON.stringify({ access_policy: { user: 'allow' }, custom_context_window: 64000 }),
      manualOverride: true,
    })
    const count = await service.deleteOverrides({
      all: false,
      items: [{ connectionId: 1, rawId: 'model', fields: ['parameters'] }],
    })
    expect(count).toBe(1)
    expect(prisma.modelCatalog.deleteMany).not.toHaveBeenCalled()
    const update = prisma.modelCatalog.update.mock.calls[0][0]
    const meta = JSON.parse(update.data.metaJson)
    expect(meta.custom_context_window).toBeUndefined()
    expect(meta.access_policy).toEqual({ user: 'allow' })
    expect(JSON.parse(update.data.capabilitiesJson)).toEqual({ flags: { vision: true }, source: 'manual' })
    expect(update.data.manualOverride).toBe(true)
    expect(refreshByGroupId).toHaveBeenCalledWith(1)
  })

  it('treats a missing fields list as a full reset and deletes the row', async () => {
    const { prisma, service } = buildService()
    prisma.connectionGroup.findMany.mockResolvedValue([
      { id: 1, prefixId: '', provider: 'openai', thinkingDialect: 'off' },
    ])
    prisma.modelCatalog.deleteMany.mockResolvedValue({ count: 1 })
    const count = await service.deleteOverrides({
      all: false,
      items: [{ connectionId: 1, rawId: 'model' }],
    })
    expect(count).toBe(1)
    expect(prisma.modelCatalog.update).not.toHaveBeenCalled()
  })


  it('trims Anthropic efforts by model instead of offering one provider-wide list', async () => {
    const { prisma, service } = buildService()
    prisma.connectionGroup.findMany.mockResolvedValueOnce([
      {
        id: 12,
        displayName: 'Claude',
        provider: 'anthropic',
        thinkingDialect: 'off',
        baseUrl: 'https://api.anthropic.com/v1',
        enable: true,
        ownerUserId: null,
        credentials: [],
      },
    ])
    const row = (rawId: string) => ({
      modelId: rawId,
      rawId,
      name: rawId,
      provider: 'anthropic',
      connectionGroupId: 12,
      connectionType: 'external',
      modelType: 'chat',
      tagsJson: '[]',
      metaJson: '{}',
      capabilitiesJson: '{}',
      manualOverride: false,
      expiresAt: new Date('2099-01-01T00:00:00Z'),
    })
    prisma.modelCatalog.findMany.mockResolvedValueOnce([
      row('claude-opus-5-5'),
      row('claude-sonnet-4-5'),
      row('claude-opus-4-6'),
    ])

    const result = await service.listModels({
      type: 'user',
      id: 1,
      username: 'admin',
      role: 'ADMIN',
      status: 'ACTIVE',
      identifier: 'a1',
    } as any)

    const byId = Object.fromEntries(result.map((item) => [item.rawId, item.efforts]))
    expect(byId['claude-opus-5-5']).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
    expect(byId['claude-opus-4-6']).toEqual(['low', 'medium', 'high', 'max'])
    expect(byId['claude-sonnet-4-5']).toEqual([])
  })
})