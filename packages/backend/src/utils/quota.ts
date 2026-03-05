import type { Actor, UsageQuotaSnapshot } from '../types'
import { QuotaService, SHARED_ANONYMOUS_IDENTIFIER } from '../services/quota/quota-service'

export type { ConsumeQuotaOptions, InspectQuotaOptions, ProcessResult } from '../services/quota/quota-service'

interface QuotaUtilsDeps {
  quotaService: QuotaService
}

let configuredQuotaService: QuotaService | null = null
let fallbackQuotaService: QuotaService | null = null

const resolveQuotaService = (): QuotaService => {
  if (configuredQuotaService) return configuredQuotaService
  if (!fallbackQuotaService) {
    fallbackQuotaService = new QuotaService()
  }
  return fallbackQuotaService
}

export const configureQuotaUtils = (deps: QuotaUtilsDeps): void => {
  configuredQuotaService = deps.quotaService
}

export const consumeActorQuota = (actor: Actor, options = {}) =>
  resolveQuotaService().consumeActorQuota(actor, options as any)

export const inspectActorQuota = (actor: Actor, options = {}) =>
  resolveQuotaService().inspectActorQuota(actor, options as any)

export const serializeQuotaSnapshot = (snapshot: UsageQuotaSnapshot) =>
  resolveQuotaService().serializeQuotaSnapshot(snapshot)

export const syncSharedAnonymousQuota = (options: { resetUsed?: boolean; tx?: any } = {}) =>
  resolveQuotaService().syncSharedAnonymousQuota(options)

export const SHARED_ANONYMOUS_QUOTA_IDENTIFIER = SHARED_ANONYMOUS_IDENTIFIER
