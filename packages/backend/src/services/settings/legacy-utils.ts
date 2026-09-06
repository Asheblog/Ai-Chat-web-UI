/**
 * System Settings 兼容代理层。
 *
 * 从 utils/system-settings.ts 迁移至 services 层，避免 utils 依赖 services。
 * 委托给 SystemSettingsService，可由容器显式绑定。
 */

import type { Prisma, PrismaClient } from '@prisma/client'
import { prisma } from '../../db'
import {
  SystemSettingsService,
  type SystemQuotaPolicy,
  type BattleUsagePolicy,
  type ModelAccessDefaults,
} from './system-settings-service'

// Re-export type
export type { SystemQuotaPolicy, BattleUsagePolicy, ModelAccessDefaults }

type SystemSettingsServiceLike = Pick<
  SystemSettingsService,
  | 'getSystemContextTokenLimit'
  | 'invalidateContextTokenLimitCache'
  | 'getReasoningMaxOutputTokensDefault'
  | 'invalidateReasoningMaxTokensCache'
  | 'getQuotaPolicy'
  | 'invalidateQuotaPolicyCache'
  | 'getBattlePolicy'
  | 'invalidateBattlePolicyCache'
  | 'getModelAccessDefaults'
  | 'invalidateModelAccessDefaultsCache'
>

interface SystemSettingsUtilsDeps {
  systemSettingsService: SystemSettingsServiceLike
}

let configuredSystemSettingsService: SystemSettingsServiceLike | null = null
let fallbackSystemSettingsService: SystemSettingsService | null = null

const resolveSystemSettingsService = (): SystemSettingsServiceLike => {
  if (configuredSystemSettingsService) return configuredSystemSettingsService
  if (!fallbackSystemSettingsService) {
    fallbackSystemSettingsService = new SystemSettingsService({ prisma })
  }
  return fallbackSystemSettingsService
}

export const configureSystemSettingsUtils = (deps: SystemSettingsUtilsDeps): void => {
  configuredSystemSettingsService = deps.systemSettingsService
}

export const getSystemSettingsServiceForUtils = (): SystemSettingsServiceLike =>
  resolveSystemSettingsService()

export const getSystemContextTokenLimit = (): Promise<number> =>
  resolveSystemSettingsService().getSystemContextTokenLimit()

export const invalidateSystemContextTokenLimitCache = (): void =>
  resolveSystemSettingsService().invalidateContextTokenLimitCache()

export const getReasoningMaxOutputTokensDefault = (): Promise<number> =>
  resolveSystemSettingsService().getReasoningMaxOutputTokensDefault()

export const invalidateReasoningMaxOutputTokensDefaultCache = (): void =>
  resolveSystemSettingsService().invalidateReasoningMaxTokensCache()

export const getQuotaPolicy = (
  client?: PrismaClient | Prisma.TransactionClient,
): Promise<SystemQuotaPolicy> =>
  resolveSystemSettingsService().getQuotaPolicy(client)

export const invalidateQuotaPolicyCache = (): void =>
  resolveSystemSettingsService().invalidateQuotaPolicyCache()

export const getBattlePolicy = (
  client?: PrismaClient | Prisma.TransactionClient,
): Promise<BattleUsagePolicy> =>
  resolveSystemSettingsService().getBattlePolicy(client)

export const invalidateBattlePolicyCache = (): void =>
  resolveSystemSettingsService().invalidateBattlePolicyCache()

export const getBattleQuotaPolicy = async (
  client?: PrismaClient | Prisma.TransactionClient,
): Promise<SystemQuotaPolicy> => {
  const policy = await resolveSystemSettingsService().getBattlePolicy(client)
  return {
    anonymousDailyQuota: policy.anonymousDailyQuota,
    defaultUserDailyQuota: policy.userDailyQuota,
    anonymousRetentionDays: 0,
  }
}
