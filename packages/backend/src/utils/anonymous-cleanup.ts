import { prisma } from '../db'
import { BackendLogger as log } from './logger'
import { getQuotaPolicy } from './system-settings'
import { deleteAttachmentsForSessions } from './chat-images'

const DAY_MS = 24 * 60 * 60 * 1000
const CLEAN_INTERVAL_MS = 60 * 1000
const BATCH_LIMIT = 50

let lastCleanupRunAt = 0

interface CleanupOptions {
  activeSessionId?: number
}

export const cleanupAnonymousSessions = async (options: CleanupOptions = {}) => {
  const now = Date.now()
  if (now - lastCleanupRunAt < CLEAN_INTERVAL_MS) {
    return
  }
  lastCleanupRunAt = now

  try {
    const quotaPolicy = await getQuotaPolicy()
    const retentionDays = quotaPolicy.anonymousRetentionDays

    const activeSessionId = options.activeSessionId ?? null

    let sessionIds: number[] = []

    if (retentionDays <= 0) {
      const sessions = await prisma.chatSession.findMany({
        where: {
          anonymousKey: { not: null },
          ...(activeSessionId
            ? { id: { not: activeSessionId } }
            : {}),
        },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
        take: BATCH_LIMIT,
      })
      sessionIds = sessions.map((s) => s.id)
    } else {
      const cutoff = new Date(now - retentionDays * DAY_MS)
      const sessions = await prisma.chatSession.findMany({
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

    await deleteAttachmentsForSessions(sessionIds)

    const deleted = await prisma.chatSession.deleteMany({
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
