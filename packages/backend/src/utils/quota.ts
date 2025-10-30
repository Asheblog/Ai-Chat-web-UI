import type { Prisma, UsageQuota } from '@prisma/client'
import { prisma } from '../db'
import type { Actor, UsageQuotaSnapshot, UsageQuotaScope } from '../types'
import { getQuotaPolicy } from './system-settings'

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

interface ProcessResult {
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
    identifier: actor.identifier,
    userId: null,
  }
}

const startOfUtcDay = (date: Date): Date => {
  const day = new Date(date)
  day.setUTCHours(0, 0, 0, 0)
  return day
}

const toSnapshot = (
  record: UsageQuota,
  effectiveLimit: number,
  now: Date,
): UsageQuotaSnapshot => {
  const unlimited = effectiveLimit < 0
  const remaining = unlimited
    ? null
    : Math.max(0, effectiveLimit - record.usedCount)
  return {
    scope: record.scope as UsageQuotaScope,
    identifier: record.identifier,
    dailyLimit: effectiveLimit,
    usedCount: record.usedCount,
    remaining,
    lastResetAt: record.lastResetAt ?? now,
    unlimited,
  }
}

const shouldResetUsage = (record: UsageQuota, now: Date) => {
  if (!record.lastResetAt) return true
  const last = record.lastResetAt
  const start = startOfUtcDay(now)
  if (last < start) return true
  if (last.getTime() > now.getTime() + 60_000) {
    // 记录时间明显晚于当前时间，说明系统时间发生跳跃，重新归零以避免负值
    return true
  }
  return false
}

const processQuota = async (
  actor: Actor,
  client: PrismaClientOrTx,
  options: ProcessOptions,
): Promise<ProcessResult> => {
  const { scope, identifier, userId } = resolveScope(actor)
  const { anonymousDailyQuota, defaultUserDailyQuota } = await getQuotaPolicy()
  const defaultLimit = scope === 'USER' ? defaultUserDailyQuota : anonymousDailyQuota

  let record = await client.usageQuota.findUnique({
    where: { scope_identifier: { scope, identifier } },
  })

  if (!record) {
    record = await client.usageQuota.create({
      data: {
        scope,
        identifier,
        dailyLimit: defaultLimit,
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

  const effectiveLimit =
    record.dailyLimit == null ? defaultLimit : record.dailyLimit

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
        snapshot: toSnapshot(record, effectiveLimit, options.now),
      }
    }
    record = await client.usageQuota.update({
      where: { id: record.id },
      data: {
        usedCount: record.usedCount + cost,
      },
    })
  } else if (options.mutate && cost > 0 && unlimited) {
    // 无上限时不强制累积计数，但可选记录总使用量
    record = await client.usageQuota.update({
      where: { id: record.id },
      data: {
        usedCount: record.usedCount + cost,
      },
    })
  }

  return {
    success: true,
    snapshot: toSnapshot(record, effectiveLimit, options.now),
  }
}

export const consumeActorQuota = async (
  actor: Actor,
  options: ConsumeQuotaOptions = {},
): Promise<ProcessResult> => {
  const cost = Math.max(0, options.cost ?? 1)
  const now = options.now ?? new Date()
  if (options.tx) {
    return processQuota(actor, options.tx, { cost, mutate: true, now })
  }
  return prisma.$transaction((tx) =>
    processQuota(actor, tx, { cost, mutate: true, now }),
  )
}

export const inspectActorQuota = async (
  actor: Actor,
  options: InspectQuotaOptions = {},
): Promise<UsageQuotaSnapshot> => {
  const now = options.now ?? new Date()
  if (options.tx) {
    const result = await processQuota(actor, options.tx, {
      cost: 0,
      mutate: false,
      now,
    })
    return result.snapshot
  }
  const result = await prisma.$transaction((tx) =>
    processQuota(actor, tx, { cost: 0, mutate: false, now }),
  )
  return result.snapshot
}

export const serializeQuotaSnapshot = (snapshot: UsageQuotaSnapshot) => ({
  scope: snapshot.scope,
  identifier: snapshot.identifier,
  dailyLimit: snapshot.dailyLimit,
  usedCount: snapshot.usedCount,
  remaining: snapshot.remaining,
  lastResetAt: snapshot.lastResetAt.toISOString(),
  unlimited: snapshot.unlimited,
})
