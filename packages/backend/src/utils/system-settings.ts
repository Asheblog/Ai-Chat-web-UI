import { prisma } from '../db'

export interface SystemQuotaPolicy {
  anonymousDailyQuota: number
  defaultUserDailyQuota: number
  anonymousRetentionDays: number
}

const CACHE_TTL_MS = 30_000

let cachedPolicy: { value: SystemQuotaPolicy; expiresAt: number } | null = null

const clamp = (value: number, min: number, max: number) => {
  if (Number.isNaN(value)) return min
  if (value < min) return min
  if (value > max) return max
  return value
}

const parseIntSafe = (input: string | undefined, fallback: number) => {
  const parsed = Number.parseInt(String(input ?? ''), 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

export const getQuotaPolicy = async (): Promise<SystemQuotaPolicy> => {
  const now = Date.now()
  if (cachedPolicy && cachedPolicy.expiresAt > now) {
    return cachedPolicy.value
  }

  const keys = [
    'anonymous_retention_days',
    'anonymous_daily_quota',
    'default_user_daily_quota',
  ] as const

  const settings = await prisma.systemSetting.findMany({
    where: { key: { in: keys as unknown as string[] } },
    select: { key: true, value: true },
  })

  const map = new Map(settings.map((item) => [item.key, item.value]))

  const retentionEnv = process.env.ANONYMOUS_RETENTION_DAYS
  const anonymousRetentionDays = clamp(
    parseIntSafe(map.get('anonymous_retention_days') ?? retentionEnv, 15),
    0,
    15,
  )

  const anonymousDailyQuota = Math.max(
    0,
    parseIntSafe(map.get('anonymous_daily_quota') ?? process.env.ANONYMOUS_DAILY_QUOTA, 20),
  )

  const defaultUserDailyQuota = Math.max(
    0,
    parseIntSafe(map.get('default_user_daily_quota') ?? process.env.DEFAULT_USER_DAILY_QUOTA, 200),
  )

  const value: SystemQuotaPolicy = {
    anonymousDailyQuota,
    defaultUserDailyQuota,
    anonymousRetentionDays,
  }

  cachedPolicy = {
    value,
    expiresAt: now + CACHE_TTL_MS,
  }

  return value
}

export const invalidateQuotaPolicyCache = () => {
  cachedPolicy = null
}

