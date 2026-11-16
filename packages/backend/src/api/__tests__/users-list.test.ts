jest.mock('../../middleware/auth', () => ({
  actorMiddleware: async (_c: any, next: any) => next(),
  requireUserActor: async (_c: any, next: any) => next(),
  adminOnlyMiddleware: async (_c: any, next: any) => next(),
}))

import type { PrismaClient } from '@prisma/client'
import { createTempPrismaDatabase, type TempPrismaDatabase } from '../../__tests__/helpers/temp-prisma-db'
import { UserService } from '../../services/users/user-service'
import { createUsersApi } from '../users'

/**
 * 回归：GET /api/users 与 GET /api/users/:id 曾经整体 500「Failed to fetch users」。
 *
 * 根因在 UserService 的 Prisma 查询：User 的连接关系已是 connectionGroups，
 * 旧查询仍写 _count.select.connections，被 Prisma 校验拦下。这里用真实库从
 * HTTP 层断言接口恢复 200，并断言 _count.connections 是凭据数：
 * fixture 只有 1 个连接组，但组内 2 条凭据，用组数顶替会得到 1。
 */
describe('users API 用户列表与详情（真实 Prisma schema）', () => {
  let db: TempPrismaDatabase
  let prisma: PrismaClient
  let app: ReturnType<typeof createUsersApi>
  let aliceId: number

  beforeAll(async () => {
    db = createTempPrismaDatabase()
    prisma = db.prisma
    app = createUsersApi({ userService: new UserService({ prisma }) })

    const alice = await prisma.user.create({
      data: { username: 'alice', hashedPassword: 'x', role: 'USER', status: 'ACTIVE' },
    })
    aliceId = alice.id
    const group = await prisma.connectionGroup.create({
      data: { ownerUserId: alice.id, displayName: 'Alice OpenAI', provider: 'openai', baseUrl: 'https://api.openai.com/v1' },
    })
    await prisma.connection.create({
      data: { connectionGroupId: group.id, apiKeyLabel: 'key-1', modelIdsJson: '["gpt-4o"]' },
    })
    await prisma.connection.create({
      data: { connectionGroupId: group.id, apiKeyLabel: 'key-2', modelIdsJson: '["gpt-4o-mini"]' },
    })
    await prisma.chatSession.create({ data: { title: 'alice-1', userId: alice.id } })
  }, 180_000)

  afterAll(async () => {
    await db?.cleanup()
  })

  it('GET /api/users?page=1&limit=10&search= 返回 200，connections 是 2 条凭据而非 1 个连接组', async () => {
    const response = await app.request('http://localhost/?page=1&limit=10&search=')
    expect(response.status).toBe(200)
    const body = (await response.json()) as any
    expect(body.success).toBe(true)
    expect(body.data.pagination).toMatchObject({ page: 1, limit: 10, total: 1, totalPages: 1 })
    expect(body.data.users[0]).toMatchObject({
      id: aliceId,
      username: 'alice',
      _count: { chatSessions: 1, connections: 2 },
    })
  })

  it('GET /api/users/:id 返回同一计数口径', async () => {
    const response = await app.request(`http://localhost/${aliceId}`)
    expect(response.status).toBe(200)
    const body = (await response.json()) as any
    expect(body.data._count).toEqual({ chatSessions: 1, connections: 2 })
  })
})
