/**
 * SystemSettingsService - 系统设置服务
 *
 * 提供缓存的系统设置访问，支持依赖注入。
 */

import type { PrismaClient, Prisma } from '@prisma/client'

export interface SystemQuotaPolicy {
  anonymousDailyQuota: number
  defaultUserDailyQuota: number
  anonymousRetentionDays: number
}

export interface ModelAccessDefaults {
  anonymous: 'allow' | 'deny'
  user: 'allow' | 'deny'
}

export interface SystemSettingsServiceDeps {
  prisma: PrismaClient
}

const CACHE_TTL_MS = 30_000

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

const clampReasoningMaxTokens = (value: number): number => {
  if (!Number.isFinite(value) || value <= 0) {
    return 0
  }
  if (value > 256_000) {
    return 256_000
  }
  return Math.floor(value)
}

export class SystemSettingsService {
  private cachedPolicy: { value: SystemQuotaPolicy; expiresAt: number } | null = null
  private cachedContextLimit: { value: number; expiresAt: number } | null = null
  private cachedReasoningMaxTokens: { value: number; expiresAt: number } | null = null
  private cachedModelAccessDefaults: { value: ModelAccessDefaults; expiresAt: number } | null = null

  constructor(private deps: SystemSettingsServiceDeps) {}

  async getSystemContextTokenLimit(): Promise<number> {
    const now = Date.now()
    if (this.cachedContextLimit && this.cachedContextLimit.expiresAt > now) {
      return this.cachedContextLimit.value
    }

    const setting = await this.deps.prisma.systemSetting.findUnique({
      where: { key: 'max_context_tokens' },
      select: { value: true },
    })

    const envDefault = process.env.DEFAULT_CONTEXT_TOKEN_LIMIT
    const parsedValue = parseIntSafe(setting?.value ?? envDefault, 4000)
    const value = Math.max(parsedValue, 0)

    this.cachedContextLimit = {
      value,
      expiresAt: now + CACHE_TTL_MS,
    }

    return value
  }

  invalidateContextTokenLimitCache(): void {
    this.cachedContextLimit = null
  }

  async getReasoningMaxOutputTokensDefault(): Promise<number> {
    const now = Date.now()
    if (this.cachedReasoningMaxTokens && this.cachedReasoningMaxTokens.expiresAt > now) {
      return this.cachedReasoningMaxTokens.value
    }

    const record = await this.deps.prisma.systemSetting.findUnique({
      where: { key: 'reasoning_max_output_tokens_default' },
      select: { value: true },
    })
    const envDefault = process.env.REASONING_MAX_OUTPUT_TOKENS_DEFAULT
    const parsed = parseIntSafe(record?.value ?? envDefault, 32_000)
    const value = clampReasoningMaxTokens(parsed) || 32_000

    this.cachedReasoningMaxTokens = {
      value,
      expiresAt: now + CACHE_TTL_MS,
    }
    return value
  }

  invalidateReasoningMaxTokensCache(): void {
    this.cachedReasoningMaxTokens = null
  }

  async getQuotaPolicy(
    client?: PrismaClient | Prisma.TransactionClient
  ): Promise<SystemQuotaPolicy> {
    const prismaClient = client ?? this.deps.prisma
    const now = Date.now()

    // 只有使用默认 client 时才使用缓存
    if (!client && this.cachedPolicy && this.cachedPolicy.expiresAt > now) {
      return this.cachedPolicy.value
    }

    const keys = [
      'anonymous_retention_days',
      'anonymous_daily_quota',
      'default_user_daily_quota',
    ] as const

    const settings = await prismaClient.systemSetting.findMany({
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

    // 只有使用默认 client 时才缓存
    if (!client) {
      this.cachedPolicy = {
        value,
        expiresAt: now + CACHE_TTL_MS,
      }
    }

    return value
  }

  invalidateQuotaPolicyCache(): void {
    this.cachedPolicy = null
  }

  async getModelAccessDefaults(): Promise<ModelAccessDefaults> {
    const now = Date.now()
    if (this.cachedModelAccessDefaults && this.cachedModelAccessDefaults.expiresAt > now) {
      return this.cachedModelAccessDefaults.value
    }

    const rows = await this.deps.prisma.systemSetting.findMany({
      where: { key: { in: ['model_access_default_anonymous', 'model_access_default_user'] } },
      select: { key: true, value: true },
    })

    const map = new Map(rows.map((row) => [row.key, row.value]))

    const anonymous = map.get('model_access_default_anonymous') === 'allow' ? 'allow' : 'deny'
    const user = map.get('model_access_default_user') === 'deny' ? 'deny' : 'allow'

    const value: ModelAccessDefaults = { anonymous, user }
    this.cachedModelAccessDefaults = { value, expiresAt: now + CACHE_TTL_MS }
    return value
  }

  invalidateModelAccessDefaultsCache(): void {
    this.cachedModelAccessDefaults = null
  }

  /**
   * 清除所有缓存
   */
  invalidateAllCaches(): void {
    this.cachedPolicy = null
    this.cachedModelAccessDefaults = null
    this.cachedContextLimit = null
    this.cachedReasoningMaxTokens = null
  }
}
