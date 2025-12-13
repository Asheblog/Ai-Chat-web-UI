import { PrismaClient } from '@prisma/client'
import * as fs from 'fs'

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
})

/**
 * WSL 环境下为 SQLite 设置兼容的 PRAGMA
 * - journal_mode = DELETE: 避免 WAL 模式的锁协议问题
 * - busy_timeout = 30000: 增加锁等待超时时间
 */
async function initWSLCompatibility(): Promise<void> {
  if (globalForPrisma.prismaInitialized) return
  globalForPrisma.prismaInitialized = true

  if (!isWSLEnvironment()) return

  try {
    // 使用 $queryRawUnsafe 因为 PRAGMA 会返回结果
    await prisma.$queryRawUnsafe('PRAGMA journal_mode = DELETE')
    await prisma.$queryRawUnsafe('PRAGMA busy_timeout = 30000')
    console.log('[Prisma] WSL detected, applied SQLite compatibility settings (DELETE journal mode, 30s busy timeout)')
  } catch (e) {
    console.warn('[Prisma] Failed to set WSL compatibility PRAGMA:', (e as Error)?.message || e)
  }
}

// 立即初始化WSL兼容性配置
initWSLCompatibility().catch(() => {})

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}

export default prisma
