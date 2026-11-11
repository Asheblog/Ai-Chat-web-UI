import { PrismaClient } from '@prisma/client'
import * as fs from 'fs'
import * as path from 'path'

const DEFAULT_TX_MAX_WAIT_MS = 10_000
const DEFAULT_TX_TIMEOUT_MS = 30_000
const SQLITE_BUSY_TIMEOUT_MS = 30_000

const parsePositiveInt = (value: string | undefined, fallback: number) => {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

const isSqliteUrl = () => {
  const url = process.env.DATABASE_URL || process.env.PRISMA_DATABASE_URL || ''
  return url.startsWith('file:')
}

/**
 * 检测是否运行在 WSL 环境
 */
function isWSLEnvironment(): boolean {
  try {
    const version = fs.readFileSync('/proc/version', 'utf8')
    return /microsoft|wsl/i.test(version)
  } catch {
    return false
  }
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
  prismaInitialized: boolean | undefined
}

export const prisma = globalForPrisma.prisma ?? new PrismaClient({
  log: ['error', 'warn'], // 暂时关闭 query 级别日志，避免淹没关键输出
  transactionOptions: {
    maxWait: parsePositiveInt(process.env.PRISMA_TX_MAX_WAIT_MS, DEFAULT_TX_MAX_WAIT_MS),
    timeout: parsePositiveInt(process.env.PRISMA_TX_TIMEOUT_MS, DEFAULT_TX_TIMEOUT_MS),
  },
})

/**
 * 读取当前连接真正打开的 SQLite 文件。
 * Prisma 对 file:./ 相对路径以 prisma/schema.prisma 所在目录为基准；
 * 一旦 URL 多写一层 prisma/（如 file:./prisma/data/app.db），会静默连到
 * prisma/prisma/data/app.db 这个另一个库，症状是「连上空库 / 缺列 / 迁移已应用却不生效」。
 */
async function readOpenSqliteFile(): Promise<string> {
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ file?: string }>>('PRAGMA database_list')
    return Array.isArray(rows) ? String(rows[0]?.file ?? '') : ''
  } catch {
    return ''
  }
}

const DOUBLE_PRISMA_SEGMENT = `${path.sep}prisma${path.sep}prisma${path.sep}`

/**
 * SQLite 环境下设置 PRAGMA，提升并发稳定性
 * - WSL: journal_mode = DELETE，避免 WAL 模式锁协议问题
 * - 非 WSL: journal_mode = WAL，提升读写并发
 * - busy_timeout = 30000: 增加锁等待超时时间
 */
async function initSqliteCompatibility(): Promise<void> {
  if (globalForPrisma.prismaInitialized) return
  globalForPrisma.prismaInitialized = true

  if (!isSqliteUrl()) return

  try {
    const isWsl = isWSLEnvironment()
    const journalMode = isWsl ? 'DELETE' : 'WAL'
    // 使用 $queryRawUnsafe 因为 PRAGMA 会返回结果
    await prisma.$queryRawUnsafe(`PRAGMA journal_mode = ${journalMode}`)
    await prisma.$queryRawUnsafe(`PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`)
    const dbFile = await readOpenSqliteFile()
    if (process.env.NODE_ENV !== 'test') {
      if (dbFile) console.log(`[Prisma] SQLite file: ${dbFile}`)
      if (dbFile.replace(/\\/g, path.sep).includes(DOUBLE_PRISMA_SEGMENT)) {
        console.warn('[Prisma] DATABASE_URL 解析出了重复的 prisma 目录（.../prisma/prisma/...），连到的不是预期数据库。')
        console.warn('[Prisma] SQLite 相对路径以 prisma/schema.prisma 所在目录为基准：应写 file:./data/app.db，不要写 file:./prisma/data/app.db。')
      }
      console.log(`[Prisma] SQLite PRAGMA applied (${journalMode}, busy_timeout=${SQLITE_BUSY_TIMEOUT_MS}ms)`)
    }
  } catch (e) {
    if (process.env.NODE_ENV !== 'test') {
      console.warn('[Prisma] Failed to set SQLite PRAGMA:', (e as Error)?.message || e)
    }
  }
}

// 立即初始化 SQLite 兼容性配置
initSqliteCompatibility().catch(() => {})

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}

export default prisma
