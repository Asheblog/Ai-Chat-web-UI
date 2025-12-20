import type { Actor, UsageQuotaSnapshot } from '../types'
import { QuotaService } from '../services/quota/quota-service'
import type { ConsumeQuotaOptions, InspectQuotaOptions } from '../services/quota/quota-service'
import { getBattleQuotaPolicy } from './system-settings'

const battleQuotaService = new QuotaService({
  getQuotaPolicy: getBattleQuotaPolicy,
  identifierPrefix: 'battle',
})

export type { ConsumeQuotaOptions, InspectQuotaOptions, ProcessResult } from '../services/quota/quota-service'

export const consumeBattleQuota = (actor: Actor, options: ConsumeQuotaOptions = {}) =>
  battleQuotaService.consumeActorQuota(actor, options)

export const inspectBattleQuota = (actor: Actor, options: InspectQuotaOptions = {}) =>
  battleQuotaService.inspectActorQuota(actor, options)

export const serializeBattleQuotaSnapshot = (snapshot: UsageQuotaSnapshot) =>
  battleQuotaService.serializeQuotaSnapshot(snapshot)
