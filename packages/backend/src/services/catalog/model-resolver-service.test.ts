import { ModelResolverService } from './model-resolver-service'
import type {
  ModelResolverRepository,
  CachedModelWithConnection,
} from '../../repositories/model-resolver-repository'

const buildConn = (overrides: Partial<any> = {}) => ({
  id: overrides.id ?? 1,
  provider: 'openai',
  baseUrl: 'https://api.example.com',
  enable: true,
  ownerUserId: null,
  prefixId: overrides.prefixId ?? null,
  modelIdsJson: overrides.modelIdsJson ?? null,
  ...overrides,
})

const createRepository = (options: { catalog?: CachedModelWithConnection[]; connections?: any[] } = {}) => {
  const catalog = options.catalog ?? []
  const connections = options.connections ?? []
  const repository: jest.Mocked<ModelResolverRepository> = {
    findCachedModel: jest.fn(async (modelId: string) =>
      catalog.find((row) => row.modelId === modelId) || null
    ),
    listEnabledSystemConnections: jest.fn(async () => connections as any),
    findEnabledSystemConnectionById: jest.fn(async (id: number) =>
      (connections as any).find((conn: any) => conn.id === id) || null
    ),
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
          connection: buildConn({ id: 2 }) as any,
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
      connections: [buildConn({ id: 3, prefixId: 'azure-gpt' })],
    })
    const service = buildService(repository)

    const result = await service.resolveModelIdForUser(1, 'azure-gpt.gpt-4o')

    expect(result?.connection.id).toBe(3)
    expect(result?.rawModelId).toBe('gpt-4o')
  })

  test('falls back to explicit modelIds or first connection', async () => {
    const repository = createRepository({
      connections: [
        buildConn({ id: 4, modelIdsJson: JSON.stringify(['gpt-4o']) }),
        buildConn({ id: 5 }),
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

  test('returns null when no connections match', async () => {
    const repository = createRepository({ connections: [] })
    const service = buildService(repository)

    const result = await service.resolveModelIdForUser(1, 'none')

    expect(result).toBeNull()
  })

  test('prefers explicit connection+rawId when provided', async () => {
    const repository = createRepository({
      connections: [buildConn({ id: 9, prefixId: 'azure' })],
    })
    const service = buildService(repository)

    const result = await service.resolveModelForRequest({
      userId: 1,
      modelId: 'whatever',
      connectionId: 9,
      rawId: 'gpt-4o',
    })

    expect(repository.findEnabledSystemConnectionById).toHaveBeenCalledWith(9)
    expect(result?.connection.id).toBe(9)
    expect(result?.rawModelId).toBe('gpt-4o')
  })

  test('uses fallback resolver when explicit connection missing', async () => {
    const repository = createRepository({
      connections: [buildConn({ id: 2, prefixId: 'openai' })],
    })
    const service = buildService(repository)

    const result = await service.resolveModelForRequest({
      userId: 5,
      modelId: 'openai.gpt-4o',
    })

    expect(repository.findEnabledSystemConnectionById).not.toHaveBeenCalled()
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
          connection: buildConn({ id: 1 }) as any,
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
      actor: { type: 'user', id: 1, username: 'u', role: 'USER', status: 'ACTIVE', identifier: 'u1' } as any,
      userId: 1,
      modelId: 'gpt-4o',
    })

    expect(result).toBeNull()
  })
})
