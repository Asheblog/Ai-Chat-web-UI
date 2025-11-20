import type { Prisma, PrismaClient } from '@prisma/client'
import type { Actor, UsageQuotaSnapshot, UsageQuotaScope } from '../../types'
import { prisma as defaultPrisma } from '../../db'
import { getQuotaPolicy as defaultGetQuotaPolicy } from '../../utils/system-settings'

const SHARED_ANONYMOUS_IDENTIFIER = 'anon:shared' as const

export interface QuotaServiceDeps {
  prisma?: PrismaClient
  getQuotaPolicy?: typeof defaultGetQuotaPolicy
  now?: () => Date
}

type PrismaClientOrTx = Prisma.TransactionClient

interface ResolveScopeResult {
  scope: UsageQuotaScope
  identifier: string
  userId: number | null
}

interface ProcessOptions {
  cost: number
  mutate: boolean
  now: Date
}

export interface ProcessResult {
  success: boolean
  snapshot: UsageQuotaSnapshot
  reason?: 'OVER_LIMIT'
}

export interface ConsumeQuotaOptions {
  cost?: number
  tx?: Prisma.TransactionClient
  now?: Date
}

export interface InspectQuotaOptions {
  tx?: Prisma.TransactionClient
  now?: Date
}

const resolveScope = (actor: Actor): ResolveScopeResult => {
  if (actor.type === 'user') {
    return {
      scope: 'USER',
      identifier: actor.identifier,
      userId: actor.id,
    }
  }
  return {
    scope: 'ANON',
    identifier: SHARED_ANONYMOUS_IDENTIFIER,
    userId: null,
  }
}

const startOfUtcDay = (date: Date): Date => {
  const day = new Date(date)
  day.setUTCHours(0, 0, 0, 0)
  return day
}

const toSnapshot = (
  record: { scope: UsageQuotaScope; identifier: string; usedCount: number; lastResetAt: Date | null; customDailyLimit: number | null },
  effectiveLimit: number,
  now: Date,
  customLimit: number | null,
  usingDefaultLimit: boolean,
): UsageQuotaSnapshot => {
  const unlimited = effectiveLimit < 0
  const remaining = unlimited ? null : Math.max(0, effectiveLimit - record.usedCount)
  return {
    scope: record.scope,
    identifier: record.identifier,
    dailyLimit: effectiveLimit,
    usedCount: record.usedCount,
    remaining,
    lastResetAt: record.lastResetAt ?? now,
    unlimited,
    customDailyLimit: customLimit,
    usingDefaultLimit,
  }
}

const shouldResetUsage = (record: { lastResetAt: Date | null }, now: Date) => {
  if (!record.lastResetAt) return true
  const last = record.lastResetAt
  const start = startOfUtcDay(now)
  if (last < start) return true
  if (last.getTime() > now.getTime() + 60_000) {
    // 时间跳跃保护，防负值
    return true
  }
  return false
}

export class QuotaService {
  private prisma: PrismaClient
  private getQuotaPolicy: typeof defaultGetQuotaPolicy
  private now: () => Date

  constructor(deps: QuotaServiceDeps = {}) {
    this.prisma = deps.prisma ?? defaultPrisma
    this.getQuotaPolicy = deps.getQuotaPolicy ?? defaultGetQuotaPolicy
    this.now = deps.now ?? (() => new Date())
  }

  async consumeActorQuota(actor: Actor, options: ConsumeQuotaOptions = {}): Promise<ProcessResult> {
    const cost = Math.max(0, options.cost ?? 1)
    const now = options.now ?? this.now()
    if (options.tx) {
      return this.processQuota(actor, options.tx, { cost, mutate: true, now })
    }
    return this.prisma.$transaction((tx) =>
      this.processQuota(actor, tx, { cost, mutate: true, now }),
    )
  }

  async inspectActorQuota(actor: Actor, options: InspectQuotaOptions = {}): Promise<UsageQuotaSnapshot> {
    const now = options.now ?? this.now()
    if (options.tx) {
      const result = await this.processQuota(actor, options.tx, { cost: 0, mutate: false, now })
      return result.snapshot
    }
    const result = await this.prisma.$transaction((tx) =>
      this.processQuota(actor, tx, { cost: 0, mutate: false, now }),
    )
    return result.snapshot
  }

  serializeQuotaSnapshot(snapshot: UsageQuotaSnapshot) {
    return {
      scope: snapshot.scope,
      identifier: snapshot.identifier,
      dailyLimit: snapshot.dailyLimit,
      usedCount: snapshot.usedCount,
      remaining: snapshot.remaining,
      lastResetAt: snapshot.lastResetAt.toISOString(),
      unlimited: snapshot.unlimited,
      customDailyLimit: snapshot.customDailyLimit,
      usingDefaultLimit: snapshot.usingDefaultLimit,
    }
  }

  async syncSharedAnonymousQuota(options: { resetUsed?: boolean; tx?: Prisma.TransactionClient } = {}) {
    const resetUsed = options.resetUsed ?? false
    const now = this.now()
    if (options.tx) {
      await this.ensureSharedAnonymousQuotaRecord(options.tx, { resetUsed, now })
      return
    }
    await this.prisma.$transaction((tx) =>
      this.ensureSharedAnonymousQuotaRecord(tx, { resetUsed, now }),
    )
  }

  private async ensureSharedAnonymousQuotaRecord(
    client: PrismaClientOrTx,
    options: { resetUsed: boolean; now: Date },
  ) {
    const { resetUsed, now } = options
    await client.usageQuota.upsert({
      where: { scope_identifier: { scope: 'ANON', identifier: SHARED_ANONYMOUS_IDENTIFIER } },
      update: {
        customDailyLimit: null,
        ...(resetUsed ? { usedCount: 0, lastResetAt: now } : {}),
      },
      create: {
        scope: 'ANON',
        identifier: SHARED_ANONYMOUS_IDENTIFIER,
        customDailyLimit: null,
        usedCount: 0,
        lastResetAt: now,
      },
    })
  }

  private async processQuota(
    actor: Actor,
    client: PrismaClientOrTx,
    options: ProcessOptions,
  ): Promise<ProcessResult> {
    const { scope, identifier, userId } = resolveScope(actor)
    const { anonymousDailyQuota, defaultUserDailyQuota } = await this.getQuotaPolicy()
    const defaultLimit = scope === 'USER' ? defaultUserDailyQuota : anonymousDailyQuota

    let record = await client.usageQuota.findUnique({
      where: { scope_identifier: { scope, identifier } },
    })

    if (!record) {
      record = await client.usageQuota.create({
        data: {
          scope,
          identifier,
          usedCount: 0,
          lastResetAt: options.now,
          ...(userId ? { userId } : {}),
        },
      })
    } else if (userId && record.userId == null) {
      record = await client.usageQuota.update({
        where: { id: record.id },
        data: { userId },
      })
    }

    const customLimit = record.customDailyLimit ?? null
    const usingDefaultLimit = customLimit == null
    const effectiveLimit = usingDefaultLimit ? defaultLimit : customLimit

    if (shouldResetUsage(record, options.now)) {
      record = await client.usageQuota.update({
        where: { id: record.id },
        data: {
          usedCount: 0,
          lastResetAt: options.now,
        },
      })
    }

    const unlimited = effectiveLimit < 0
    const cost = Math.max(0, options.cost)

    if (options.mutate && cost > 0 && !unlimited) {
      if (record.usedCount + cost > effectiveLimit) {
        return {
          success: false,
          reason: 'OVER_LIMIT',
          snapshot: toSnapshot(record, effectiveLimit, options.now, customLimit, usingDefaultLimit),
        }
      }
      record = await client.usageQuota.update({
        where: { id: record.id },
        data: {
          usedCount: record.usedCount + cost,
        },
      })
    } else if (options.mutate && cost > 0 && unlimited) {
      record = await client.usageQuota.update({
        where: { id: record.id },
        data: {
          usedCount: record.usedCount + cost,
        },
      })
    }

    return {
      success: true,
      snapshot: toSnapshot(record, effectiveLimit, options.now, customLimit, usingDefaultLimit),
    }
  }
}

export const quotaService = new QuotaService()
export { SHARED_ANONYMOUS_IDENTIFIER }
