import { ModelResolverService } from './model-resolver-service'
import type {
  ModelResolverRepository,
  CachedModelWithConnection,
  ResolvedConnection,
} from '../../repositories/model-resolver-repository'

const buildGroup = (overrides: Partial<ResolvedConnection> = {}): ResolvedConnection => ({
  id: overrides.id ?? 1,
  ownerUserId: null,
  displayName: overrides.displayName ?? 'OpenAI',
  provider: 'openai',
  vendor: null,
  baseUrl: 'https://api.example.com',
  enable: true,
  authType: 'bearer',
  headersJson: '',
  azureApiVersion: null,
  prefixId: overrides.prefixId ?? null,
  tagsJson: '[]',
  defaultCapabilitiesJson: '{}',
  connectionType: 'external',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  credentialId: overrides.credentialId ?? overrides.id ?? 1,
  secretVaultId: overrides.secretVaultId ?? 100,
  modelIdsJson: overrides.modelIdsJson ?? '[]',
  apiKeyLabel: overrides.apiKeyLabel ?? 'Key',
  ...overrides,
})

const createRepository = (options: {
  catalog?: CachedModelWithConnection[]
  groups?: Array<ResolvedConnection & { credentials?: any[] }>
} = {}) => {
  const catalog = options.catalog ?? []
  const groups = options.groups ?? []
  const repository: jest.Mocked<ModelResolverRepository> = {
    findCachedModel: jest.fn(async (modelId: string) =>
      catalog.find((row) => row.modelId === modelId) || null,
    ),
    listEnabledSystemGroups: jest.fn(async () =>
      groups.map((group) => ({
        ...group,
        credentials: group.credentials ?? [
          {
            id: group.credentialId,
            connectionGroupId: group.id,
            enable: true,
            secretVaultId: group.secretVaultId,
            apiKeyLabel: group.apiKeyLabel,
            modelIdsJson: group.modelIdsJson,
            createdAt: group.createdAt,
            updatedAt: group.updatedAt,
          },
        ],
      })) as any,
    ),
    findEnabledResolvedConnectionById: jest.fn(async (id: number) => {
      const byGroup = groups.find((group) => group.id === id)
      if (byGroup) return byGroup
      const byCredential = groups.find((group) => group.credentialId === id)
      return byCredential || null
    }),
  }
  return repository
}

const buildService = (repository: ModelResolverRepository) =>
  new ModelResolverService({
    repository,
    getModelAccessDefaults: async () => ({ anonymous: 'deny', user: 'allow' }),
    resolveModelAccessPolicy: ({ defaults }) => ({
      policy: null,
      resolved: {
        anonymous: { decision: defaults.anonymous, source: 'default' },
        user: { decision: defaults.user, source: 'default' },
      },
    }),
  })

describe('ModelResolverService', () => {
  test('returns cached mapping when present', async () => {
    const repository = createRepository({
      catalog: [
        {
          modelId: 'gpt-4o',
          rawId: 'gpt-4o',
          connectionId: 2,
          connection: buildGroup({ id: 2, credentialId: 20 }),
        },
      ],
    })
    const service = buildService(repository)

    const result = await service.resolveModelIdForUser(1, 'gpt-4o')

    expect(result?.connection.id).toBe(2)
    expect(result?.rawModelId).toBe('gpt-4o')
  })

  test('resolves by prefix when cache missing', async () => {
    const repository = createRepository({
      groups: [buildGroup({ id: 3, prefixId: 'azure-gpt', credentialId: 30 })],
    })
    const service = buildService(repository)

    const result = await service.resolveModelIdForUser(1, 'azure-gpt.gpt-4o')

    expect(result?.connection.id).toBe(3)
    expect(result?.rawModelId).toBe('gpt-4o')
  })

  test('falls back to explicit modelIds or first group', async () => {
    const repository = createRepository({
      groups: [
        buildGroup({
          id: 4,
          credentialId: 40,
          modelIdsJson: JSON.stringify(['gpt-4o']),
        }),
        buildGroup({ id: 5, credentialId: 50 }),
      ],
    })
    const service = buildService(repository)

    const mapped = await service.resolveModelIdForUser(1, 'gpt-4o')
    const first = await service.resolveModelIdForUser(1, 'gpt-3.5')

    expect(mapped?.connection.id).toBe(4)
    expect(mapped?.rawModelId).toBe('gpt-4o')
    expect(first?.connection.id).toBe(4)
    expect(first?.rawModelId).toBe('gpt-3.5')
  })

  test('returns null when no groups match', async () => {
    const repository = createRepository({ groups: [] })
    const service = buildService(repository)

    const result = await service.resolveModelIdForUser(1, 'none')

    expect(result).toBeNull()
  })

  test('prefers explicit connection+rawId when provided (group id)', async () => {
    const repository = createRepository({
      groups: [buildGroup({ id: 9, prefixId: 'azure', credentialId: 90 })],
    })
    const service = buildService(repository)

    const result = await service.resolveModelForRequest({
      userId: 1,
      modelId: 'whatever',
      connectionId: 9,
      rawId: 'gpt-4o',
    })

    expect(repository.findEnabledResolvedConnectionById).toHaveBeenCalledWith(9)
    expect(result?.connection.id).toBe(9)
    expect(result?.rawModelId).toBe('gpt-4o')
  })

  test('dual-reads legacy credential id to its group', async () => {
    const repository = createRepository({
      groups: [buildGroup({ id: 9, prefixId: 'azure', credentialId: 90 })],
    })
    const service = buildService(repository)

    const result = await service.resolveModelForRequest({
      userId: 1,
      modelId: 'whatever',
      connectionId: 90,
      rawId: 'gpt-4o',
    })

    expect(result?.connection.id).toBe(9)
    expect(result?.connection.credentialId).toBe(90)
  })

  test('uses fallback resolver when explicit connection missing', async () => {
    const repository = createRepository({
      groups: [buildGroup({ id: 2, prefixId: 'openai', credentialId: 20 })],
    })
    const service = buildService(repository)

    const result = await service.resolveModelForRequest({
      userId: 5,
      modelId: 'openai.gpt-4o',
    })

    expect(repository.findEnabledResolvedConnectionById).not.toHaveBeenCalled()
    expect(result?.connection.id).toBe(2)
    expect(result?.rawModelId).toBe('gpt-4o')
  })

  test('denies model when access policy forbids user', async () => {
    const repository = createRepository({
      catalog: [
        {
          modelId: 'gpt-4o',
          rawId: 'gpt-4o',
          connectionId: 1,
          metaJson: JSON.stringify({ access_policy: { user: 'deny' } }),
          connection: buildGroup({ id: 1 }),
        },
      ],
    })
    const service = new ModelResolverService({
      repository,
      getModelAccessDefaults: async () => ({ anonymous: 'deny', user: 'allow' }),
      resolveModelAccessPolicy: ({ metaJson, defaults }) => {
        const payload = metaJson ? JSON.parse(metaJson) : {}
        const policy = (payload as any).access_policy || {}
        const userDecision = policy.user === 'deny' ? 'deny' : defaults.user
        return {
          policy,
          resolved: {
            anonymous: { decision: defaults.anonymous, source: 'default' },
            user: { decision: userDecision, source: policy.user ? 'override' : 'default' },
          },
        }
      },
    })

    const result = await service.resolveModelForRequest({
      actor: {
        type: 'user',
        id: 1,
        username: 'u',
        role: 'USER',
        status: 'ACTIVE',
        identifier: 'u1',
      } as any,
      userId: 1,
      modelId: 'gpt-4o',
    })

    expect(result).toBeNull()
  })
})
