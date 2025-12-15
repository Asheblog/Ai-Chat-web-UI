/**
 * System Settings Utils - 代理层
 *
 * 委托给 SystemSettingsService，无回退实现。
 */

import type { Prisma, PrismaClient } from '@prisma/client'
import { getSystemSettingsService } from '../container/service-accessor'
import type { SystemQuotaPolicy } from '../services/settings/system-settings-service'

// Re-export type
export type { SystemQuotaPolicy }

export const getSystemContextTokenLimit = (): Promise<number> =>
  getSystemSettingsService().getSystemContextTokenLimit()

export const invalidateSystemContextTokenLimitCache = (): void =>
  getSystemSettingsService().invalidateContextTokenLimitCache()

export const getReasoningMaxOutputTokensDefault = (): Promise<number> =>
  getSystemSettingsService().getReasoningMaxOutputTokensDefault()

export const invalidateReasoningMaxOutputTokensDefaultCache = (): void =>
  getSystemSettingsService().invalidateReasoningMaxTokensCache()

export const getQuotaPolicy = (
  client?: PrismaClient | Prisma.TransactionClient,
): Promise<SystemQuotaPolicy> =>
  getSystemSettingsService().getQuotaPolicy(client)

export const invalidateQuotaPolicyCache = (): void =>
  getSystemSettingsService().invalidateQuotaPolicyCache()
