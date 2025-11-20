import { ModelResolverService } from './model-resolver-service'

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

const createMockPrisma = (options: { catalog?: any[]; connections?: any[] } = {}) => {
  const catalog = options.catalog ?? []
  const connections = options.connections ?? []
  return {
    modelCatalog: {
      findFirst: jest.fn(async ({ where }: any) =>
        catalog.find((row) => row.modelId === where.modelId) || null
      ),
    },
    connection: {
      findMany: jest.fn(async () => connections),
    },
  }
}

describe('ModelResolverService', () => {
  test('returns cached mapping when present', async () => {
    const prisma = createMockPrisma({
      catalog: [
        {
          modelId: 'gpt-4o',
          rawId: 'gpt-4o',
          connection: buildConn({ id: 2 }),
        },
      ],
    })
    const service = new ModelResolverService({ prisma: prisma as any })

    const result = await service.resolveModelIdForUser(1, 'gpt-4o')

    expect(result?.connection.id).toBe(2)
    expect(result?.rawModelId).toBe('gpt-4o')
  })

  test('resolves by prefix when cache missing', async () => {
    const prisma = createMockPrisma({
      connections: [buildConn({ id: 3, prefixId: 'azure-gpt' })],
    })
    const service = new ModelResolverService({ prisma: prisma as any })

    const result = await service.resolveModelIdForUser(1, 'azure-gpt.gpt-4o')

    expect(result?.connection.id).toBe(3)
    expect(result?.rawModelId).toBe('gpt-4o')
  })

  test('falls back to explicit modelIds or first connection', async () => {
    const prisma = createMockPrisma({
      connections: [
        buildConn({ id: 4, modelIdsJson: JSON.stringify(['gpt-4o']) }),
        buildConn({ id: 5 }),
      ],
    })
    const service = new ModelResolverService({ prisma: prisma as any })

    const mapped = await service.resolveModelIdForUser(1, 'gpt-4o')
    const first = await service.resolveModelIdForUser(1, 'gpt-3.5')

    expect(mapped?.connection.id).toBe(4)
    expect(mapped?.rawModelId).toBe('gpt-4o')
    expect(first?.connection.id).toBe(4)
    expect(first?.rawModelId).toBe('gpt-3.5')
  })

  test('returns null when no connections match', async () => {
    const prisma = createMockPrisma({ connections: [] })
    const service = new ModelResolverService({ prisma: prisma as any })

    const result = await service.resolveModelIdForUser(1, 'none')

    expect(result).toBeNull()
  })
})
