import type { PrismaClient } from '@prisma/client'
import { createLogger } from '../../utils/logger'
import type { BattleImageService } from './battle-image-service'
import { safeParseJson } from './battle-serialization'

const log = createLogger('BattleRetentionCleanup')

const DEFAULT_RETENTION_DAYS = 15
const MAX_RETENTION_DAYS = 3650
const DAY_MS = 24 * 60 * 60 * 1000
const DEFAULT_THROTTLE_MS = 60_000
const DEFAULT_BATCH_SIZE = 50
const TERMINAL_RUN_STATUSES = ['completed', 'error', 'cancelled'] as const

const clampRetentionDays = (value: number) => Math.max(0, Math.min(MAX_RETENTION_DAYS, Math.floor(value)))

const parseImagePathsJson = (raw: string | null | undefined) => {
  const parsed = safeParseJson<unknown>(raw || '[]', [])
  if (!Array.isArray(parsed)) return []
  return parsed
    .map((item) => String(item || '').trim())
    .filter((item) => item.length > 0)
}

export type BattleRetentionCleanupStats = {
  retentionDays: number
  cutoff: string | null
  deletedRuns: number
  deletedResults: number
  deletedShares: number
  deletedImages: number
  vacuumScheduled: boolean
}

export interface BattleRetentionCleanupServiceDeps {
  prisma: PrismaClient
  imageService: BattleImageService
  scheduleVacuum: () => void
  throttleMs?: number
  batchSize?: number
  now?: () => Date
}

export class BattleRetentionCleanupService {
  private prisma: PrismaClient
  private imageService: BattleImageService
  private scheduleVacuum: () => void
  private throttleMs: number
  private batchSize: number
  private now: () => Date
  private lastRunAtMs = 0
  private inFlight: Promise<BattleRetentionCleanupStats> | null = null

  constructor(deps: BattleRetentionCleanupServiceDeps) {
    this.prisma = deps.prisma
    this.imageService = deps.imageService
    this.scheduleVacuum = deps.scheduleVacuum
    this.throttleMs = deps.throttleMs ?? DEFAULT_THROTTLE_MS
    this.batchSize = Math.max(1, Math.floor(deps.batchSize ?? DEFAULT_BATCH_SIZE))
    this.now = deps.now ?? (() => new Date())
  }

  async triggerIfDue(): Promise<BattleRetentionCleanupStats | null> {
    if (this.inFlight) {
      return this.inFlight
    }

    const nowMs = this.now().getTime()
    if (nowMs - this.lastRunAtMs < this.throttleMs) {
      return null
    }
    this.lastRunAtMs = nowMs

    this.inFlight = this.cleanup().finally(() => {
      this.inFlight = null
    })
    return this.inFlight
  }

  resetForTest() {
    this.lastRunAtMs = 0
    this.inFlight = null
  }

  private async cleanup(): Promise<BattleRetentionCleanupStats> {
    const retentionDays = await this.resolveRetentionDays()
    if (retentionDays <= 0) {
      return {
        retentionDays,
        cutoff: null,
        deletedRuns: 0,
        deletedResults: 0,
        deletedShares: 0,
        deletedImages: 0,
        vacuumScheduled: false,
      }
    }

    const cutoffDate = new Date(this.now().getTime() - retentionDays * DAY_MS)
    let deletedRuns = 0
    let deletedResults = 0
    let deletedShares = 0
    let deletedImages = 0

    while (true) {
      const runs = await this.prisma.battleRun.findMany({
        where: {
          status: { in: [...TERMINAL_RUN_STATUSES] },
          createdAt: { lt: cutoffDate },
        },
        select: {
          id: true,
          promptImagesJson: true,
          expectedAnswerImagesJson: true,
        },
        orderBy: { createdAt: 'asc' },
        take: this.batchSize,
      })

      if (runs.length === 0) break

      const runIds = runs.map((run) => run.id)
      const imagePathSet = new Set<string>()
      for (const run of runs) {
        for (const path of parseImagePathsJson(run.promptImagesJson)) {
          imagePathSet.add(path)
        }
        for (const path of parseImagePathsJson(run.expectedAnswerImagesJson)) {
          imagePathSet.add(path)
        }
      }
      const imagePaths = Array.from(imagePathSet)

      const batchResult = await this.prisma.$transaction(async (tx) => {
        const shareResult = await tx.battleShare.deleteMany({
          where: { battleRunId: { in: runIds } },
        })
        const resultResult = await tx.battleResult.deleteMany({
          where: { battleRunId: { in: runIds } },
        })
        const runResult = await tx.battleRun.deleteMany({
          where: {
            id: { in: runIds },
            status: { in: [...TERMINAL_RUN_STATUSES] },
            createdAt: { lt: cutoffDate },
          },
        })
        return {
          deletedRuns: runResult.count,
          deletedResults: resultResult.count,
          deletedShares: shareResult.count,
        }
      })

      await this.imageService.deleteImages(imagePaths)

      deletedRuns += batchResult.deletedRuns
      deletedResults += batchResult.deletedResults
      deletedShares += batchResult.deletedShares
      deletedImages += imagePaths.length

      if (runs.length < this.batchSize) break
      if (
        batchResult.deletedRuns === 0 &&
        batchResult.deletedResults === 0 &&
        batchResult.deletedShares === 0
      ) {
        break
      }
    }

    const vacuumScheduled = deletedRuns > 0
    if (vacuumScheduled) {
      this.scheduleVacuum()
    }

    if (deletedRuns > 0 || deletedResults > 0 || deletedShares > 0 || deletedImages > 0) {
      log.info('battle retention cleanup completed', {
        retentionDays,
        cutoff: cutoffDate.toISOString(),
        deletedRuns,
        deletedShares,
        deletedResults,
        deletedImages,
      })
    }

    return {
      retentionDays,
      cutoff: cutoffDate.toISOString(),
      deletedRuns,
      deletedResults,
      deletedShares,
      deletedImages,
      vacuumScheduled,
    }
  }

  private async resolveRetentionDays() {
    const row = await this.prisma.systemSetting.findUnique({
      where: { key: 'battle_retention_days' },
      select: { value: true },
    })
    const fromDb = Number.parseInt(String(row?.value ?? '').trim(), 10)
    if (Number.isFinite(fromDb)) {
      return clampRetentionDays(fromDb)
    }

    const fromEnv = Number.parseInt(String(process.env.BATTLE_RETENTION_DAYS ?? '').trim(), 10)
    if (Number.isFinite(fromEnv)) {
      return clampRetentionDays(fromEnv)
    }

    return DEFAULT_RETENTION_DAYS
  }
}

