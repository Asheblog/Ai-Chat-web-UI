/**
 * 文档清理调度器
 * 定期清理过期和孤立的文档
 */

import { PrismaClient } from '@prisma/client'
import fs from 'fs/promises'
import type { VectorDBClient } from '../../modules/document/vector'

export interface CleanupConfig {
  /**
   * 是否启用清理
   */
  enabled: boolean

  /**
   * 清理间隔（毫秒）
   */
  intervalMs: number

  /**
   * 文档保留天数
   */
  retentionDays: number

  /**
   * 孤立文档保留小时数（未关联任何会话的文档）
   */
  orphanedRetentionHours: number

  /**
   * 最大总存储大小（字节）
   */
  maxTotalStorageBytes: number

  /**
   * 数据库大小警告阈值（字节）
   */
  databaseSizeWarningBytes: number
}

export interface CleanupStats {
  expiredDocumentsDeleted: number
  orphanedDocumentsDeleted: number
  storageCleaned: number
  vectorCollectionsDeleted: number
  lastRunAt: Date
  durationMs: number
  errors: string[]
}

export class CleanupScheduler {
  private prisma: PrismaClient
  private vectorDB: VectorDBClient
  private config: CleanupConfig
  private intervalId: NodeJS.Timeout | null = null
  private lastStats: CleanupStats | null = null

  constructor(
    prisma: PrismaClient,
    vectorDB: VectorDBClient,
    config: CleanupConfig
  ) {
    this.prisma = prisma
    this.vectorDB = vectorDB
    this.config = config
  }

  /**
   * 启动清理调度器
   */
  start(): void {
    if (!this.config.enabled) {
      console.log('[CleanupScheduler] Cleanup is disabled')
      return
    }

    if (this.intervalId) {
      console.warn('[CleanupScheduler] Already running')
      return
    }

    console.log(
      `[CleanupScheduler] Starting with interval ${this.config.intervalMs}ms`
    )

    // 启动时执行一次
    this.runCleanup().catch((err) => {
      console.error('[CleanupScheduler] Initial cleanup failed:', err)
    })

    // 定期执行
    this.intervalId = setInterval(() => {
      this.runCleanup().catch((err) => {
        console.error('[CleanupScheduler] Cleanup failed:', err)
      })
    }, this.config.intervalMs)
  }

  /**
   * 停止清理调度器
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
      console.log('[CleanupScheduler] Stopped')
    }
  }

  /**
   * 执行清理
   */
  async runCleanup(): Promise<CleanupStats> {
    const startTime = Date.now()
    const errors: string[] = []
    let expiredDocumentsDeleted = 0
    let orphanedDocumentsDeleted = 0
    let storageCleaned = 0
    let vectorCollectionsDeleted = 0

    console.log('[CleanupScheduler] Running cleanup...')

    // 1. 清理过期文档
    try {
      const result = await this.cleanExpiredDocuments()
      expiredDocumentsDeleted = result.count
      storageCleaned += result.storageCleaned
      vectorCollectionsDeleted += result.vectorCollections
    } catch (err) {
      const msg = `Expired cleanup failed: ${err}`
      console.error('[CleanupScheduler]', msg)
      errors.push(msg)
    }

    // 2. 清理孤立文档
    try {
      const result = await this.cleanOrphanedDocuments()
      orphanedDocumentsDeleted = result.count
      storageCleaned += result.storageCleaned
      vectorCollectionsDeleted += result.vectorCollections
    } catch (err) {
      const msg = `Orphaned cleanup failed: ${err}`
      console.error('[CleanupScheduler]', msg)
      errors.push(msg)
    }

    // 3. 检查数据库大小
    try {
      await this.checkDatabaseSize()
    } catch (err) {
      const msg = `Database size check failed: ${err}`
      console.error('[CleanupScheduler]', msg)
      errors.push(msg)
    }

    const stats: CleanupStats = {
      expiredDocumentsDeleted,
      orphanedDocumentsDeleted,
      storageCleaned,
      vectorCollectionsDeleted,
      lastRunAt: new Date(),
      durationMs: Date.now() - startTime,
      errors,
    }

    this.lastStats = stats

    console.log(
      `[CleanupScheduler] Cleanup completed in ${stats.durationMs}ms. ` +
        `Deleted: ${expiredDocumentsDeleted} expired, ${orphanedDocumentsDeleted} orphaned. ` +
        `Cleaned: ${Math.round(storageCleaned / 1024)}KB storage, ${vectorCollectionsDeleted} vector collections.`
    )

    return stats
  }

  /**
   * 清理过期文档
   */
  private async cleanExpiredDocuments(): Promise<{
    count: number
    storageCleaned: number
    vectorCollections: number
  }> {
    const now = new Date()

    // 查找过期文档
    const expiredDocs = await this.prisma.document.findMany({
      where: {
        expiresAt: {
          lt: now,
        },
      },
    })

    let storageCleaned = 0
    let vectorCollections = 0

    for (const doc of expiredDocs) {
      // 删除向量数据
      if (doc.collectionName) {
        try {
          await this.vectorDB.deleteCollection(doc.collectionName)
          vectorCollections++
        } catch {
          // 忽略
        }
      }

      // 删除文件
      try {
        await fs.unlink(doc.filePath)
        storageCleaned += doc.fileSize
      } catch {
        // 忽略
      }
    }

    // 删除数据库记录
    await this.prisma.document.deleteMany({
      where: {
        id: { in: expiredDocs.map((d) => d.id) },
      },
    })

    return { count: expiredDocs.length, storageCleaned, vectorCollections }
  }

  /**
   * 清理孤立文档（未关联任何会话）
   */
  private async cleanOrphanedDocuments(): Promise<{
    count: number
    storageCleaned: number
    vectorCollections: number
  }> {
    const cutoffTime = new Date(
      Date.now() - this.config.orphanedRetentionHours * 60 * 60 * 1000
    )

    // 查找孤立文档：未关联任何会话且创建时间早于阈值
    const orphanedDocs = await this.prisma.document.findMany({
      where: {
        sessionDocuments: { none: {} },
        createdAt: { lt: cutoffTime },
      },
    })

    let storageCleaned = 0
    let vectorCollections = 0

    for (const doc of orphanedDocs) {
      if (doc.collectionName) {
        try {
          await this.vectorDB.deleteCollection(doc.collectionName)
          vectorCollections++
        } catch {
          // 忽略
        }
      }

      try {
        await fs.unlink(doc.filePath)
        storageCleaned += doc.fileSize
      } catch {
        // 忽略
      }
    }

    await this.prisma.document.deleteMany({
      where: {
        id: { in: orphanedDocs.map((d) => d.id) },
      },
    })

    return { count: orphanedDocs.length, storageCleaned, vectorCollections }
  }

  /**
   * 检查数据库大小
   */
  private async checkDatabaseSize(): Promise<void> {
    // SQLite 特定查询
    try {
      const result = await this.prisma.$queryRaw<Array<{ size: bigint }>>`
        SELECT page_count * page_size as size
        FROM pragma_page_count(), pragma_page_size()
      `

      if (result.length > 0) {
        const sizeBytes = Number(result[0].size)

        if (sizeBytes > this.config.databaseSizeWarningBytes) {
          console.warn(
            `[CleanupScheduler] Database size warning: ${Math.round(sizeBytes / 1024 / 1024)}MB ` +
              `(threshold: ${Math.round(this.config.databaseSizeWarningBytes / 1024 / 1024)}MB)`
          )
        }
      }
    } catch {
      // 非 SQLite 数据库，跳过
    }
  }

  /**
   * 获取最后一次清理统计
   */
  getLastStats(): CleanupStats | null {
    return this.lastStats
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<CleanupConfig>): void {
    this.config = { ...this.config, ...config }
  }
}
