import { PrismaClient } from '@prisma/client'
import { createTempPrismaDatabase, type TempPrismaDatabase } from '../../../__tests__/helpers/temp-prisma-db'
import { UserService } from '../user-service'

/**
 * 真实 Prisma schema 下的用户列表/详情计数回归测试。
 *
 * 历史 bug：schema 把 User 的连接关系从 connections 改成 connectionGroups
 * （连接组是模型连接的一等身份，Key 降为组内凭据，见 ADR-0034），但 user-service
 * 仍按 `_count.select.connections` 查询，PrismaClient 在校验阶段直接抛
 * PrismaClientValidationError，导致 GET /api/users 与 GET /api/users/:id 全部 500。
 *
 * 计数语义（GLOSSARY「Connection Group / Connection Credential」）：
 * connections 是连接凭据（connections 表行，即组内 API Key）数量，不是连接组数量。
 * 故 fixture 故意造出「1 个连接组 / 2 条凭据」，组数冒充连接数会立刻红。
 */

describe('UserService 连接计数（真实 Prisma schema）', () => {
  let db: TempPrismaDatabase
  let prisma: PrismaClient
  let service: UserService
  let aliceId: number
  let bobId: number

  beforeAll(async () => {
    db = createTempPrismaDatabase()
    prisma = db.prisma
    service = new UserService({ prisma })
  }, 180_000)

  afterAll(async () => {
    await db?.cleanup()
  })

  it('准备 fixture：alice 1 个连接组（2 条凭据），bob 无连接组，另有系统级连接组', async () => {
    // createdAt 固定，让 orderBy createdAt desc 分页结果确定（bob 在前，alice 在后）
    const alice = await prisma.user.create({
      data: {
        username: 'alice',
        hashedPassword: 'x',
        role: 'USER',
        status: 'ACTIVE',
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
      },
    })
    const bob = await prisma.user.create({
      data: {
        username: 'bob',
        hashedPassword: 'x',
        role: 'USER',
        status: 'ACTIVE',
        createdAt: new Date('2024-01-02T00:00:00.000Z'),
      },
    })
    aliceId = alice.id
    bobId = bob.id

    await prisma.chatSession.create({ data: { title: 'alice-1', userId: alice.id } })
    await prisma.chatSession.create({ data: { title: 'bob-1', userId: bob.id } })
    await prisma.chatSession.create({ data: { title: 'bob-2', userId: bob.id } })

    const aliceGroup = await prisma.connectionGroup.create({
      data: {
        ownerUserId: alice.id,
        displayName: 'Alice OpenAI',
        provider: 'openai',
        baseUrl: 'https://api.openai.com/v1',
      },
    })
    await prisma.connection.create({
      data: { connectionGroupId: aliceGroup.id, apiKeyLabel: 'key-1', modelIdsJson: '["gpt-4o"]' },
    })
    await prisma.connection.create({
      data: { connectionGroupId: aliceGroup.id, apiKeyLabel: 'key-2', modelIdsJson: '["gpt-4o-mini"]' },
    })

    // 系统级连接组（无 owner）不属于任何用户，不得计入任何人的连接数
    const systemGroup = await prisma.connectionGroup.create({
      data: { ownerUserId: null, displayName: 'System OpenAI', provider: 'openai', baseUrl: 'https://api.openai.com/v1' },
    })
    await prisma.connection.create({ data: { connectionGroupId: systemGroup.id, apiKeyLabel: 'sys-1' } })
    await prisma.connection.create({ data: { connectionGroupId: systemGroup.id, apiKeyLabel: 'sys-2' } })
    await prisma.connection.create({ data: { connectionGroupId: systemGroup.id, apiKeyLabel: 'sys-3' } })
  })

  it('listUsers 不抛校验错误，连接数是凭据数而不是连接组数', async () => {
    const result = await service.listUsers({ page: 1, limit: 10 })

    expect(result.pagination.total).toBe(2)
    const alice = result.users.find((user) => user.id === aliceId)
    const bob = result.users.find((user) => user.id === bobId)

    // alice 只有 1 个连接组，但组内有 2 条凭据
    expect(alice?._count).toEqual({ chatSessions: 1, connections: 2 })
    expect(bob?._count).toEqual({ chatSessions: 2, connections: 0 })
  })

  it('分页第 2 页（page=2&limit=1）仍返回该用户的正确连接计数', async () => {
    const result = await service.listUsers({ page: 2, limit: 1 })

    expect(result.pagination).toMatchObject({ page: 2, limit: 1, total: 2, totalPages: 2 })
    expect(result.users).toHaveLength(1)
    expect(result.users[0]?.id).toBe(aliceId)
    expect(result.users[0]?._count).toEqual({ chatSessions: 1, connections: 2 })
  })

  it('getUserWithCounts 与列表口径一致', async () => {
    const alice = await service.getUserWithCounts(aliceId)
    expect(alice._count).toEqual({ chatSessions: 1, connections: 2 })

    const bob = await service.getUserWithCounts(bobId)
    expect(bob._count).toEqual({ chatSessions: 2, connections: 0 })
  })

  it('search/status 过滤沿用原有语义且计数仍正确', async () => {
    const filtered = await service.listUsers({ page: 1, limit: 10, search: 'ali', status: 'ACTIVE' })
    expect(filtered.users).toHaveLength(1)
    expect(filtered.users[0]?._count).toEqual({ chatSessions: 1, connections: 2 })
  })
})
