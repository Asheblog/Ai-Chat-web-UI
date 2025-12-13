/**
 * 基于 SQLite 的轻量级向量数据库实现
 * 使用余弦相似度进行向量搜索
 *
 * 支持环境自适应:
 * - WSL/特殊文件系统: 使用 DELETE journal 模式，避免锁协议问题
 * - 标准 Linux/Docker: 使用 WAL 模式，获得更好性能
 */

import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'
import type { VectorDBClient, VectorItem, SearchResult } from './types'

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

/**
 * 获取推荐的 journal 模式
 * WSL 环境使用 DELETE 模式避免锁问题，其他环境使用 WAL 获得更好性能
 */
function getRecommendedJournalMode(): 'WAL' | 'DELETE' {
  return isWSLEnvironment() ? 'DELETE' : 'WAL'
}

/**
 * 计算两个向量的余弦相似度
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error('Vector dimensions must match')
  }

  let dotProduct = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB)
  if (magnitude === 0) return 0

  return dotProduct / magnitude
}

/**
 * SQLite 向量数据库客户端
 * 适用于中小规模文档检索场景
 *
 * 特性:
 * - 环境自适应 journal 模式 (WSL: DELETE, Docker/Linux: WAL)
 * - 增强的锁超时容错 (30秒)
 * - 支持单例模式复用连接
 */
export class SQLiteVectorClient implements VectorDBClient {
  private db: Database.Database
  private dataPath: string
  private initialized: boolean = false

  constructor(dataPath: string) {
    this.dataPath = dataPath

    // 确保目录存在
    const dir = path.dirname(dataPath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }

    this.db = new Database(dataPath)

    // 环境自适应的 journal 模式
    const journalMode = getRecommendedJournalMode()
    const isWSL = isWSLEnvironment()

    try {
      this.db.pragma(`journal_mode = ${journalMode}`)
      if (isWSL) {
        console.log('[VectorDB] WSL detected, using DELETE journal mode for compatibility')
      }
    } catch (e) {
      console.warn('[VectorDB] Failed to set journal mode, continuing:', (e as any)?.message || e)
    }

    // 增强的锁超时: 30秒，避免并发操作时过早失败
    try {
      this.db.pragma('busy_timeout = 30000')
    } catch (e) {
      console.warn('[VectorDB] Failed to set busy_timeout, continuing:', (e as any)?.message || e)
    }

    // 创建元数据表
    this.initTables()
  }

  /**
   * 初始化数据库表，支持重试
   */
  private initTables(): void {
    const maxRetries = 3
    const retryDelay = 1000

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS vector_collections (
            name TEXT PRIMARY KEY,
            dimension INTEGER,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
          )
        `)
        this.initialized = true
        return
      } catch (e) {
        const message = (e as any)?.message || String(e)
        const isLockError = /locking protocol|database is locked|SQLITE_BUSY/i.test(message)

        if (isLockError && attempt < maxRetries) {
          console.warn(`[VectorDB] Table init failed (attempt ${attempt}/${maxRetries}), retrying in ${retryDelay}ms...`)
          // 同步等待 - 构造函数中不能用 async
          const start = Date.now()
          while (Date.now() - start < retryDelay) {
            // busy wait
          }
        } else {
          console.warn('[VectorDB] Failed to init vector_collections table, continuing:', message)
          return
        }
      }
    }
  }

  /**
   * 检查数据库是否已初始化
   */
  isInitialized(): boolean {
    return this.initialized
  }

  /**
   * 获取数据库文件路径
   */
  getDataPath(): string {
    return this.dataPath
  }

  async hasCollection(collectionName: string): Promise<boolean> {
    const result = this.db
      .prepare('SELECT 1 FROM vector_collections WHERE name = ?')
      .get(collectionName)
    return result !== undefined
  }

  async createCollection(collectionName: string): Promise<void> {
    const exists = await this.hasCollection(collectionName)
    if (exists) return

    // 使用安全的表名（添加前缀避免SQL注入）
    const tableName = `vec_${collectionName.replace(/[^a-zA-Z0-9_]/g, '_')}`

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS "${tableName}" (
        id TEXT PRIMARY KEY,
        text TEXT NOT NULL,
        vector TEXT NOT NULL,
        metadata TEXT DEFAULT '{}'
      )
    `)

    this.db
      .prepare('INSERT OR IGNORE INTO vector_collections (name, dimension) VALUES (?, ?)')
      .run(collectionName, 0)
  }

  async deleteCollection(collectionName: string): Promise<void> {
    const tableName = `vec_${collectionName.replace(/[^a-zA-Z0-9_]/g, '_')}`

    try {
      this.db.exec(`DROP TABLE IF EXISTS "${tableName}"`)
      this.db.prepare('DELETE FROM vector_collections WHERE name = ?').run(collectionName)
    } catch {
      // 表可能不存在，忽略错误
    }
  }

  async insert(collectionName: string, items: VectorItem[]): Promise<void> {
    if (items.length === 0) return

    await this.createCollection(collectionName)

    const tableName = `vec_${collectionName.replace(/[^a-zA-Z0-9_]/g, '_')}`

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO "${tableName}" (id, text, vector, metadata)
      VALUES (?, ?, ?, ?)
    `)

    const insertMany = this.db.transaction((items: VectorItem[]) => {
      for (const item of items) {
        stmt.run(
          item.id,
          item.text,
          JSON.stringify(item.vector),
          JSON.stringify(item.metadata)
        )
      }
    })

    insertMany(items)

    // 更新维度信息
    if (items.length > 0 && items[0].vector.length > 0) {
      this.db
        .prepare('UPDATE vector_collections SET dimension = ? WHERE name = ?')
        .run(items[0].vector.length, collectionName)
    }
  }

  async search(
    collectionName: string,
    queryVector: number[],
    limit: number
  ): Promise<SearchResult[]> {
    const exists = await this.hasCollection(collectionName)
    if (!exists) return []

    const tableName = `vec_${collectionName.replace(/[^a-zA-Z0-9_]/g, '_')}`

    // 获取所有向量并计算相似度
    const rows = this.db.prepare(`SELECT id, text, vector, metadata FROM "${tableName}"`).all() as Array<{
      id: string
      text: string
      vector: string
      metadata: string
    }>

    const results: SearchResult[] = rows
      .map((row) => {
        const vector = JSON.parse(row.vector) as number[]
        const score = cosineSimilarity(queryVector, vector)
        return {
          id: row.id,
          text: row.text,
          score,
          metadata: JSON.parse(row.metadata) as Record<string, unknown>,
        }
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)

    return results
  }

  async deleteByIds(collectionName: string, ids: string[]): Promise<void> {
    if (ids.length === 0) return

    const exists = await this.hasCollection(collectionName)
    if (!exists) return

    const tableName = `vec_${collectionName.replace(/[^a-zA-Z0-9_]/g, '_')}`
    const placeholders = ids.map(() => '?').join(',')

    this.db.prepare(`DELETE FROM "${tableName}" WHERE id IN (${placeholders})`).run(...ids)
  }

  async count(collectionName: string): Promise<number> {
    const exists = await this.hasCollection(collectionName)
    if (!exists) return 0

    const tableName = `vec_${collectionName.replace(/[^a-zA-Z0-9_]/g, '_')}`
    const result = this.db.prepare(`SELECT COUNT(*) as count FROM "${tableName}"`).get() as {
      count: number
    }
    return result.count
  }

  async reset(): Promise<void> {
    // 获取所有 collection
    const collections = this.db
      .prepare('SELECT name FROM vector_collections')
      .all() as Array<{ name: string }>

    for (const { name } of collections) {
      await this.deleteCollection(name)
    }
  }

  async close(): Promise<void> {
    this.db.close()
  }

  /**
   * 获取数据库文件大小（字节）
   */
  getDatabaseSize(): number {
    try {
      const stats = fs.statSync(this.dataPath)
      return stats.size
    } catch {
      return 0
    }
  }

  /**
   * 执行 VACUUM 压缩数据库
   */
  vacuum(): void {
    this.db.exec('VACUUM')
  }
}
