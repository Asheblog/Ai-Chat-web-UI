import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { PrismaClient } from '@prisma/client'

/**
 * 回归测试：prisma/schema.prisma 与 migrations/ 目录必须保持一致。
 *
 * 历史 bug：20251201090000_chat_shares 迁移按 snake_case 建列（session_id 等），
 * 而 ChatShare 模型字段为 camelCase 且无 @map，导致所有环境下 share 服务查询
 * 抛 P2022（列不存在）。本测试对全新数据库执行完整 migrate deploy，
 * 再按 share-service 的查询方式（session 关系过滤 + createdAt 排序 + 全字段写入读取）
 * 验证列映射完整可用。
 */
describe('schema 与 migrations 一致性（chat_shares）', () => {
  let tmpDir: string
  let prisma: PrismaClient

  beforeAll(
    () => {
      try {
        tmpDir = mkdtempSync(path.join(tmpdir(), 'aichat-schema-drift-'))
        const dbPath = path.join(tmpDir, 'test.db')
        // SQLite URL 统一为正斜杠绝对路径，兼容 Windows 宿主与 Linux 容器
        const dbUrl = `file:${dbPath.split(path.sep).join('/')}`
        const require = createRequire(path.join(process.cwd(), 'package.json'))
        const prismaCli = require.resolve('prisma/build/index.js')
        try {
          execFileSync(
            process.execPath,
            [
              prismaCli,
              'migrate',
              'deploy',
              '--schema',
              path.resolve(process.cwd(), 'prisma/schema.prisma'),
            ],
            {
              env: { ...process.env, DATABASE_URL: dbUrl },
              stdio: 'pipe',
              // 首次冷启动较慢，放宽超时避免 CI 偶发失败
              timeout: 120_000,
            },
          )
        } catch (error) {
          // stdio: 'pipe' 会吞掉子进程输出，失败时把 stderr 拼进错误信息便于诊断
          const stderr = (error as { stderr?: Buffer | string }).stderr
          throw new Error(`prisma migrate deploy 失败: ${stderr ? stderr.toString() : String(error)}`)
        }
        prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } })
      } catch (error) {
        if (tmpDir) {
          rmSync(tmpDir, { recursive: true, force: true })
        }
        throw error
      }
    },
    120_000,
  )

  afterAll(async () => {
    try {
      await prisma?.$disconnect()
    } finally {
      if (tmpDir) {
        rmSync(tmpDir, { recursive: true, force: true })
      }
    }
  })

  it('按 session 关系过滤 + createdAt 排序可查询（listShares 的查询形态）', async () => {
    const rows = await prisma.chatShare.findMany({
      where: { session: { id: 1 } },
      orderBy: { createdAt: 'desc' },
      take: 10,
    })
    expect(Array.isArray(rows)).toBe(true)
  })

  it('count 支持 createdByUserId 过滤（管理后台列表计数形态）', async () => {
    const count = await prisma.chatShare.count({ where: { createdByUserId: 1 } })
    expect(count).toBe(0)
  })

  it('全字段写入/读取 roundtrip：所有列映射完整', async () => {
    const user = await prisma.user.create({
      data: { username: `drift-${Date.now()}`, hashedPassword: 'x' },
    })
    const session = await prisma.chatSession.create({ data: { title: 'drift' } })
    const token = `drift-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const created = await prisma.chatShare.create({
      data: {
        sessionId: session.id,
        token,
        title: 'drift share',
        messageIdsJson: '[1,2]',
        payloadJson: '{"ok":true}',
        createdByUserId: user.id,
        createdByAnonymousKey: 'anon-key',
        expiresAt: new Date(Date.now() + 60_000),
      },
    })

    const read = await prisma.chatShare.findUnique({ where: { id: created.id } })
    expect(read).toMatchObject({
      id: created.id,
      sessionId: session.id,
      token,
      title: 'drift share',
      messageIdsJson: '[1,2]',
      payloadJson: '{"ok":true}',
      createdByUserId: user.id,
      createdByAnonymousKey: 'anon-key',
      expiresAt: expect.any(Date),
    })
  })
})
