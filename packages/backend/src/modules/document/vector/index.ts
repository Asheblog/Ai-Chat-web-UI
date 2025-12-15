/**
 * 向量数据库工厂
 *
 * 支持单例模式：同一数据库路径复用现有连接，避免多进程/多次初始化导致的锁冲突
 */

import path from 'path'
import type { VectorDBClient, VectorDBConfig } from './types'
import { SQLiteVectorClient } from './sqlite-vector-client'

/**
 * 全局单例缓存
 * key: 规范化的数据库文件路径
 * value: SQLiteVectorClient 实例
 */
const vectorDBInstances = new Map<string, SQLiteVectorClient>()

/**
 * 规范化路径，确保相同路径的不同表示方式能匹配到同一实例
 */
function normalizePath(dataPath: string): string {
  return path.resolve(dataPath)
}

/**
 * 创建或获取向量数据库客户端（单例模式）
 *
 * 同一进程内，相同路径的数据库只会创建一个连接实例，
 * 避免多次初始化导致的锁冲突问题
 */
export function createVectorDBClient(config: VectorDBConfig): VectorDBClient {
  const dbPath = path.join(config.dataPath, 'vector.db')
  const normalizedPath = normalizePath(dbPath)

  switch (config.type) {
    case 'sqlite': {
      // 检查是否已有实例
      const existing = vectorDBInstances.get(normalizedPath)
      if (existing) {
        return existing
      }

      // 创建新实例并缓存
      const client = new SQLiteVectorClient(dbPath)
      vectorDBInstances.set(normalizedPath, client)

      // 异步执行迁移检查（不阻塞启动）
      checkAndMigrateVectorDB(client).catch((e) =>
        console.warn('[VectorDB] Migration check failed:', e)
      )

      return client
    }

    case 'chroma':
      // ChromaDB 支持可以后续添加
      // 目前回退到 SQLite 实现
      console.warn('[VectorDB] ChromaDB not yet implemented, falling back to SQLite')
      return createVectorDBClient({ ...config, type: 'sqlite' })

    default:
      throw new Error(`Unknown vector DB type: ${config.type}`)
  }
}

/**
 * 检查并执行向量数据库迁移（JSON → 二进制格式）
 */
async function checkAndMigrateVectorDB(client: SQLiteVectorClient): Promise<void> {
  try {
    const needsMigration = await client.needsMigration()
    if (!needsMigration) {
      return
    }

    console.log('[VectorDB] Detected JSON format vectors, starting migration to binary format...')
    const stats = await client.migrateToBufferFormat()

    console.log(
      `[VectorDB] Migration completed: ` +
        `${stats.collectionsProcessed} collections, ` +
        `${stats.recordsMigrated} records migrated, ` +
        `${stats.recordsSkipped} already binary`
    )

    if (stats.errors.length > 0) {
      console.warn(`[VectorDB] Migration had ${stats.errors.length} errors:`, stats.errors.slice(0, 5))
    }
  } catch (e) {
    console.error('[VectorDB] Migration failed:', e)
  }
}

/**
 * 获取已存在的向量数据库实例（不创建新实例）
 */
export function getVectorDBClient(dataPath: string): SQLiteVectorClient | null {
  const dbPath = path.join(dataPath, 'vector.db')
  const normalizedPath = normalizePath(dbPath)
  return vectorDBInstances.get(normalizedPath) || null
}

/**
 * 关闭并移除指定路径的向量数据库实例
 */
export async function closeVectorDBClient(dataPath: string): Promise<void> {
  const dbPath = path.join(dataPath, 'vector.db')
  const normalizedPath = normalizePath(dbPath)

  const instance = vectorDBInstances.get(normalizedPath)
  if (instance) {
    await instance.close()
    vectorDBInstances.delete(normalizedPath)
  }
}

/**
 * 关闭所有向量数据库实例
 */
export async function closeAllVectorDBClients(): Promise<void> {
  const closePromises = Array.from(vectorDBInstances.values()).map((client) =>
    client.close().catch((e) => console.warn('[VectorDB] Error closing client:', e))
  )
  await Promise.all(closePromises)
  vectorDBInstances.clear()
}

/**
 * 获取当前活跃的实例数量（用于调试）
 */
export function getActiveInstanceCount(): number {
  return vectorDBInstances.size
}

export * from './types'
export { SQLiteVectorClient } from './sqlite-vector-client'
