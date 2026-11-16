import { execFileSync } from 'node:child_process'
import { closeSync, mkdtempSync, openSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PrismaClient } from '@prisma/client'

/**
 * 起一个临时 sqlite 库并按 prisma/schema.prisma 建表，返回连上它的真实 PrismaClient。
 *
 * Prisma 的查询校验（例如 _count.select 里写了模型上不存在的关系）只在真实
 * PrismaClient 上才会暴露，mock prisma 的单测抓不到，所以需要真实库的用例走这里。
 */
const backendRoot = path.resolve(__dirname, '../../..')
const schemaPath = path.resolve(backendRoot, 'prisma/schema.prisma')

export interface TempPrismaDatabase {
  prisma: PrismaClient
  cleanup: () => Promise<void>
}

export function createTempPrismaDatabase(): TempPrismaDatabase {
  const tmpDir = mkdtempSync(path.join(tmpdir(), 'aichat-temp-db-'))
  const dbPath = path.join(tmpDir, 'test.db')
  // Prisma 的 Windows schema engine 要求 sqlite 文件已存在
  closeSync(openSync(dbPath, 'wx'))
  const dbUrl = `file:${dbPath.split(path.sep).join('/')}`
  const require = createRequire(path.resolve(backendRoot, 'package.json'))
  const prismaCli = require.resolve('prisma/build/index.js')

  try {
    execFileSync(
      process.execPath,
      [prismaCli, 'db', 'push', '--skip-generate', '--schema', schemaPath],
      { env: { ...process.env, DATABASE_URL: dbUrl }, stdio: 'pipe', timeout: 180_000 },
    )
  } catch (error) {
    rmSync(tmpDir, { recursive: true, force: true })
    const stderr = (error as { stderr?: Buffer | string }).stderr
    throw new Error(`prisma db push 失败: ${stderr ? stderr.toString() : String(error)}`)
  }

  const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } })
  return {
    prisma,
    cleanup: async () => {
      try {
        await prisma.$disconnect()
      } finally {
        rmSync(tmpDir, { recursive: true, force: true })
      }
    },
  }
}
