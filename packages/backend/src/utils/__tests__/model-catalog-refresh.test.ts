jest.mock('../../db', () => ({
  prisma: {
    modelCatalog: {
      findMany: jest.fn(),
      createMany: jest.fn(),
      update: jest.fn(),
      deleteMany: jest.fn(),
    },
    $transaction: jest.fn(async (fn: any) =>
      fn({
        modelCatalog: {
          createMany: jest.fn(),
          update: jest.fn(),
          deleteMany: jest.fn(),
        },
      }),
    ),
  },
}))

jest.mock('../../services/context/legacy-utils', () => ({
  guessKnownContextWindow: jest.fn(() => null),
  guessKnownCompletionLimit: jest.fn(() => null),
  invalidateCompletionLimitCache: jest.fn(),
  invalidateContextWindowCache: jest.fn(),
}))

jest.mock('../providers', () => ({
  ...jest.requireActual('../providers'),
  fetchModelsForConnection: jest.fn(),
}))

import { prisma } from '../../db'
import { fetchModelsForConnection } from '../providers'
import { refreshModelCatalogForConnectionGroup } from '../model-catalog'

const group = (overrides: Record<string, any> = {}) => ({
  id: 1,
  ownerUserId: null,
  displayName: 'Test',
  provider: 'openai',
  thinkingDialect: 'off',
  baseUrl: 'https://api.example.com/v1',
  enable: true,
  authType: 'none',
  headersJson: '',
  prefixId: null,
  tagsJson: '[]',
  defaultCapabilitiesJson: '{}',
  connectionType: 'external',
  ...overrides,
})

const credential = { id: 1, enable: true, secretVaultId: null, modelIdsJson: '[]', apiKeyLabel: null } as any

const fetchMock = fetchModelsForConnection as jest.Mock
const catalogFindMany = (prisma as any).modelCatalog.findMany

const captureTransactionWrites = () => {
  const calls: any = { updates: [] }
  ;(prisma as any).$transaction.mockImplementation(async (fn: any) =>
    fn({
      modelCatalog: {
        createMany: jest.fn(async (args: any) => calls.creates = args.data),
        update: jest.fn(async (args: any) => calls.updates.push(args)),
        deleteMany: jest.fn(),
      },
    }),
  )
  return calls
}

describe('refreshModelCatalogForConnectionGroup capability layering', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    catalogFindMany.mockResolvedValue([])
  })

  it('lets the provider declaration win over the heuristic guess', async () => {
    fetchMock.mockResolvedValue([
      {
        id: 'gpt-4o',
        rawId: 'gpt-4o',
        name: 'gpt-4o',
        provider: 'openai',
        channelName: 'OpenAI',
        connectionBaseUrl: 'https://api.example.com/v1',
        connectionType: 'external',
        tags: [],
        capabilities: { vision: false },
        capabilitySource: 'provider',
      },
    ])
    captureTransactionWrites()
    await refreshModelCatalogForConnectionGroup(group() as any, credential)
    const created = (prisma as any).$transaction.mock.results[0].value
    await created
    const createArgs = await (async () => {
      let captured: any = null
      ;(prisma as any).$transaction.mockImplementationOnce(async (fn: any) =>
        fn({
          modelCatalog: {
            createMany: async (args: any) => { captured = args.data },
            update: async () => {},
            deleteMany: async () => {},
          },
        }),
      )
      await refreshModelCatalogForConnectionGroup(group() as any, credential)
      return captured
    })()
    expect(createArgs[0].capabilitiesJson).toBe(JSON.stringify({ flags: { vision: false }, source: 'provider' }))
  })

  it('keeps the connection default as the lowest layer', async () => {
    fetchMock.mockResolvedValue([
      {
        id: 'img-gen',
        rawId: 'img-gen',
        name: 'img-gen',
        provider: 'openai',
        channelName: 'OpenAI',
        connectionBaseUrl: 'https://api.example.com/v1',
        connectionType: 'external',
        tags: [],
      },
    ])
    let captured: any = null
    ;(prisma as any).$transaction.mockImplementationOnce(async (fn: any) =>
      fn({
        modelCatalog: {
          createMany: async (args: any) => { captured = args.data },
          update: async () => {},
          deleteMany: async () => {},
        },
      }),
    )
    await refreshModelCatalogForConnectionGroup(
      group({ defaultCapabilitiesJson: JSON.stringify({ image_generation: true }) }) as any,
      credential,
    )
    expect(JSON.parse(captured[0].capabilitiesJson)).toEqual({
      flags: { image_generation: true },
      source: 'connection_default',
    })
  })

  it('preserves a manual capability envelope but still refreshes provider tags', async () => {
    catalogFindMany.mockResolvedValue([
      {
        id: 5,
        modelId: 'gpt-4o',
        rawId: 'gpt-4o',
        name: 'gpt-4o',
        provider: 'openai',
        connectionType: 'external',
        modelType: 'chat',
        tagsJson: '["vision"]',
        metaJson: '{}',
        capabilitiesJson: JSON.stringify({ flags: { vision: true }, source: 'manual' }),
        manualOverride: true,
      },
    ])
    fetchMock.mockResolvedValue([
      {
        id: 'gpt-4o',
        rawId: 'gpt-4o',
        name: 'gpt-4o',
        provider: 'openai',
        channelName: 'OpenAI',
        connectionBaseUrl: 'https://api.example.com/v1',
        connectionType: 'external',
        tags: [{ name: 'prod' }],
        capabilities: { vision: false },
        capabilitySource: 'provider',
      },
    ])
    let updates: any[] = []
    ;(prisma as any).$transaction.mockImplementationOnce(async (fn: any) =>
      fn({
        modelCatalog: {
          createMany: async () => {},
          update: async (args: any) => { updates.push(args) },
          deleteMany: async () => {},
        },
      }),
    )
    await refreshModelCatalogForConnectionGroup(group() as any, credential)
    expect(updates[0].data.capabilitiesJson).toBeUndefined()
    expect(updates[0].data.tagsJson).toBe(JSON.stringify([{ name: 'prod' }]))
  })

  it('promotes a legacy manual context window before refreshing detected values', async () => {
    catalogFindMany.mockResolvedValue([
      {
        id: 6,
        modelId: 'gpt-4o',
        rawId: 'gpt-4o',
        name: 'gpt-4o',
        provider: 'openai',
        connectionType: 'external',
        modelType: 'chat',
        tagsJson: '[]',
        metaJson: JSON.stringify({ context_window: 64000 }),
        capabilitiesJson: '{}',
        manualOverride: true,
      },
    ])
    fetchMock.mockResolvedValue([
      {
        id: 'gpt-4o',
        rawId: 'gpt-4o',
        name: 'gpt-4o',
        provider: 'openai',
        channelName: 'OpenAI',
        connectionBaseUrl: 'https://api.example.com/v1',
        connectionType: 'external',
        tags: [],
      },
    ])
    let updates: any[] = []
    ;(prisma as any).$transaction.mockImplementationOnce(async (fn: any) =>
      fn({
        modelCatalog: {
          createMany: async () => {},
          update: async (args: any) => { updates.push(args) },
          deleteMany: async () => {},
        },
      }),
    )
    await refreshModelCatalogForConnectionGroup(group() as any, credential)
    const meta = JSON.parse(updates[0].data.metaJson)
    expect(meta.custom_context_window).toBe(64000)
  })

  it('does not freeze detected context windows on access-policy-only rows', async () => {
    catalogFindMany.mockResolvedValue([
      {
        id: 7,
        modelId: 'gpt-4o',
        rawId: 'gpt-4o',
        name: 'gpt-4o',
        provider: 'openai',
        connectionType: 'external',
        modelType: 'chat',
        tagsJson: '[]',
        metaJson: JSON.stringify({ access_policy: { user: 'allow' } }),
        capabilitiesJson: '{}',
        manualOverride: true,
      },
    ])
    fetchMock.mockResolvedValue([
      {
        id: 'gpt-4o',
        rawId: 'gpt-4o',
        name: 'gpt-4o',
        provider: 'openai',
        channelName: 'OpenAI',
        connectionBaseUrl: 'https://api.example.com/v1',
        connectionType: 'external',
        tags: [],
      },
    ])
    let updates: any[] = []
    ;(prisma as any).$transaction.mockImplementationOnce(async (fn: any) =>
      fn({
        modelCatalog: {
          createMany: async () => {},
          update: async (args: any) => { updates.push(args) },
          deleteMany: async () => {},
        },
      }),
    )
    await refreshModelCatalogForConnectionGroup(group() as any, credential)
    const meta = JSON.parse(updates[0].data.metaJson)
    expect(meta.custom_context_window).toBeUndefined()
    expect(meta.access_policy).toEqual({ user: 'allow' })
  })

  it('skips the catalog fetch for a legacy session connection instead of sending an unauthenticated request', async () => {
    fetchMock.mockResolvedValue([])
    const result = await refreshModelCatalogForConnectionGroup(group({ authType: 'session' }) as any, credential)
    expect(result.total).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})