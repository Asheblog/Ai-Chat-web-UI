import type { Actor, UsageQuotaSnapshot } from '../types'
import { quotaService, SHARED_ANONYMOUS_IDENTIFIER } from '../services/quota/quota-service'

export type { ConsumeQuotaOptions, InspectQuotaOptions, ProcessResult } from '../services/quota/quota-service'

export const consumeActorQuota = (actor: Actor, options = {}) =>
  quotaService.consumeActorQuota(actor, options as any)

export const inspectActorQuota = (actor: Actor, options = {}) =>
  quotaService.inspectActorQuota(actor, options as any)

export const serializeQuotaSnapshot = (snapshot: UsageQuotaSnapshot) =>
  quotaService.serializeQuotaSnapshot(snapshot)

export const syncSharedAnonymousQuota = (options: { resetUsed?: boolean; tx?: any } = {}) =>
  quotaService.syncSharedAnonymousQuota(options)

export const SHARED_ANONYMOUS_QUOTA_IDENTIFIER = SHARED_ANONYMOUS_IDENTIFIER
