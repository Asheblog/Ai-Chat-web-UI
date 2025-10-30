import type { Actor } from '../types'
import { getQuotaPolicy } from './system-settings'

export interface AnonymousSessionContext {
  anonymousKey: string
  expiresAt: Date | null
}

export const ensureAnonymousSession = async (actor: Actor): Promise<AnonymousSessionContext | null> => {
  if (actor.type !== 'anonymous') {
    return null
  }

  let expiresAt = actor.expiresAt ?? null
  if (!expiresAt) {
    const policy = await getQuotaPolicy()
    if (policy.anonymousRetentionDays > 0) {
      expiresAt = new Date(Date.now() + policy.anonymousRetentionDays * 24 * 60 * 60 * 1000)
    }
  }

  if (expiresAt) {
    actor.expiresAt = expiresAt
  } else {
    actor.expiresAt = null
  }

  return {
    anonymousKey: actor.key,
    expiresAt,
  }
}
