/**
 * AnonymousCleanupService - 匿名会话清理服务
 *
 * 从 utils/anonymous-cleanup.ts 迁移，使用依赖注入替代直接 prisma 访问。
 */

import type { PrismaClient } from '@prisma/client'
import { BackendLogger as log } from '../../utils/logger'

const DAY_MS = 24 * 60 * 60 * 1000
const CLEAN_INTERVAL_MS = 60 * 1000
const BATCH_LIMIT = 50

export interface CleanupOptions {
  activeSessionId?: number
}

export interface AnonymousCleanupServiceDeps {
  prisma: PrismaClient
  getQuotaPolicy: () => Promise<{ anonymousRetentionDays: number }>
  deleteAttachmentsForSessions: (sessionIds: number[]) => Promise<void>
}

export class AnonymousCleanupService {
  private lastCleanupRunAt = 0

  constructor(private deps: AnonymousCleanupServiceDeps) {}

  async cleanup(options: CleanupOptions = {}): Promise<void> {
    const now = Date.now()
    if (now - this.lastCleanupRunAt < CLEAN_INTERVAL_MS) {
      return
    }
    this.lastCleanupRunAt = now

    try {
      const quotaPolicy = await this.deps.getQuotaPolicy()
      const retentionDays = quotaPolicy.anonymousRetentionDays

      const activeSessionId = options.activeSessionId ?? null

      let sessionIds: number[] = []

      if (retentionDays <= 0) {
        const sessions = await this.deps.prisma.chatSession.findMany({
          where: {
            anonymousKey: { not: null },
            ...(activeSessionId ? { id: { not: activeSessionId } } : {}),
          },
          select: { id: true },
          orderBy: { createdAt: 'asc' },
          take: BATCH_LIMIT,
        })
        sessionIds = sessions.map((s) => s.id)
      } else {
        const cutoff = new Date(now - retentionDays * DAY_MS)
        const sessions = await this.deps.prisma.chatSession.findMany({
          where: {
            anonymousKey: { not: null },
            OR: [
              { expiresAt: { lt: cutoff } },
              { expiresAt: null, createdAt: { lt: cutoff } },
            ],
          },
          select: { id: true },
          orderBy: { expiresAt: 'asc' },
          take: BATCH_LIMIT,
        })
        sessionIds = sessions.map((s) => s.id)
      }

      if (sessionIds.length === 0) {
        return
      }

      await this.deps.deleteAttachmentsForSessions(sessionIds)

      const deleted = await this.deps.prisma.chatSession.deleteMany({
        where: { id: { in: sessionIds } },
      })

      if (deleted.count > 0) {
        log.info('[anonymous-cleanup] removed anonymous sessions', {
          count: deleted.count,
          retentionDays,
          activeSessionId,
        })
      }
    } catch (error) {
      log.warn('[anonymous-cleanup] cleanup failed', error instanceof Error ? error.message : error)
    }
  }

  /**
   * 重置清理间隔（用于测试）
   */
  resetInterval(): void {
    this.lastCleanupRunAt = 0
  }
}
