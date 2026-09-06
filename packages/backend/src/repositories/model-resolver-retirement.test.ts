import type { PrismaClient, ConnectionGroup } from '@prisma/client'
import { PrismaModelResolverRepository, resolveConnectionFromGroup } from './model-resolver-repository'
import { ModelResolverService } from '../services/catalog/model-resolver-service'

function fixture(provider: string, enable: boolean) {
  const credential = { id: 91, enable: true, secretVaultId: 1, modelIdsJson: '[]', apiKeyLabel: null }
  const retired = { id: 9, provider, enable, ownerUserId: null, prefixId: 'old', authType: 'bearer', credentials: [credential] }
  const supported = { ...retired, id: 10, provider: 'openai', enable: true, prefixId: null }
  const groups = [retired, supported]
  const prisma = {
    connectionGroup: {
      findFirst: jest.fn(async ({ where }: any) => groups.find((group) => group.id === where.id && (where.enable === undefined || group.enable === where.enable)) ?? null),
      findMany: jest.fn(async ({ where }: any) => groups.filter((group) => where.enable === undefined || group.enable === where.enable)),
    },
    connection: { findFirst: jest.fn(async ({ where }: any) => where.id === credential.id ? { ...credential, group: retired } : null) },
    modelCatalog: { findFirst: jest.fn(async () => null as any) },
  }
  const repository = new PrismaModelResolverRepository(prisma as unknown as PrismaClient)
  return { repository, prisma, retired }
}

describe('persisted retired connection reads', () => {
  test('does not reinterpret a retired group id as another group credential id', async () => {
    const { repository, prisma } = fixture('ollama', false)
    prisma.connection.findFirst.mockResolvedValue({
      id: 9, enable: true, secretVaultId: 2, modelIdsJson: '[]', apiKeyLabel: null,
      group: { id: 10, provider: 'openai', enable: true, ownerUserId: null },
    } as any)
    expect(await repository.findEnabledResolvedConnectionById(9)).toBeNull()
    expect(prisma.connection.findFirst).not.toHaveBeenCalled()
  })

  test.each(['azure_openai', 'ollama'])('rejects %s soft references by group and credential id', async (provider) => {
    const { repository } = fixture(provider, false)
    expect(await repository.findResolvedConnectionById(9)).toBeNull()
    expect(await repository.findResolvedConnectionById(91)).toBeNull()
    expect((await repository.findResolvedConnectionById(10))?.provider).toBe('openai')
  })

  test.each(['azure_openai', 'ollama'])('rejects enabled %s runtime references too', async (provider) => {
    const { repository } = fixture(provider, true)
    expect(await repository.findEnabledResolvedConnectionById(9)).toBeNull()
    expect(await repository.findEnabledResolvedConnectionById(91)).toBeNull()
  })

  test.each(['azure_openai', 'ollama'])('keeps disabled %s prefix from falling back after migration', async (provider) => {
    const { repository } = fixture(provider, false)
    const service = new ModelResolverService({ repository })
    expect(await service.resolveModelIdForUser(1, 'old.model')).toBeNull()
    expect((await service.resolveModelIdForUser(1, 'new-model'))?.connection.id).toBe(10)
  })

  test('keeps retired cached identity and history projection readable', async () => {
    const { repository, prisma, retired } = fixture('ollama', false)
    prisma.modelCatalog.findFirst.mockResolvedValue({ modelId: 'old.model', rawId: 'model', connectionGroupId: 9, connectionGroup: retired })
    expect((await repository.findCachedModel('old.model'))?.connection.provider).toBe('ollama')
    expect(resolveConnectionFromGroup(retired as unknown as ConnectionGroup & { credentials: any[] })?.provider).toBe('ollama')
  })

  test('does not activate disabled supported groups when loading all resolution identities', async () => {
    const { repository, prisma } = fixture('openai', false)
    const service = new ModelResolverService({ repository })
    expect((await service.resolveModelIdForUser(1, 'new-model'))?.connection.id).toBe(10)
    expect(prisma.connectionGroup.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { ownerUserId: null } }))
  })
})
