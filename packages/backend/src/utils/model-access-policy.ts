/**
 * Model Access Policy Utils - 代理层
 *
 * 委托给 SystemSettingsService，无回退实现。
 */

import { getSystemSettingsService } from '../container/service-accessor'
import type { Actor } from '../types'

export type ModelAccessTriState = 'allow' | 'deny' | 'inherit'

export interface ModelAccessPolicy {
  anonymous?: ModelAccessTriState
  user?: ModelAccessTriState
}

export interface ModelAccessDefaults {
  anonymous: Exclude<ModelAccessTriState, 'inherit'>
  user: Exclude<ModelAccessTriState, 'inherit'>
}

export interface ModelAccessResolution {
  anonymous: { decision: 'allow' | 'deny'; source: 'default' | 'override' }
  user: { decision: 'allow' | 'deny'; source: 'default' | 'override' }
}

const isTriState = (value: unknown): value is ModelAccessTriState =>
  value === 'allow' || value === 'deny' || value === 'inherit'

const parseAccessPolicy = (metaJson?: string | null): ModelAccessPolicy | null => {
  if (!metaJson) return null
  try {
    const parsed = JSON.parse(metaJson)
    const policy = (parsed as Record<string, unknown>)?.access_policy
    if (!policy || typeof policy !== 'object') return null
    const normalized: ModelAccessPolicy = {}
    if (isTriState((policy as Record<string, unknown>).anonymous)) {
      normalized.anonymous = (policy as Record<string, unknown>).anonymous as ModelAccessTriState
    }
    if (isTriState((policy as Record<string, unknown>).user)) {
      normalized.user = (policy as Record<string, unknown>).user as ModelAccessTriState
    }
    return Object.keys(normalized).length ? normalized : null
  } catch {
    return null
  }
}

export const getModelAccessDefaults = (): Promise<ModelAccessDefaults> =>
  getSystemSettingsService().getModelAccessDefaults()

export const invalidateModelAccessDefaultsCache = (): void =>
  getSystemSettingsService().invalidateModelAccessDefaultsCache()

export const resolveModelAccessPolicy = (options: {
  metaJson?: string | null
  defaults: ModelAccessDefaults
}): { policy: ModelAccessPolicy | null; resolved: ModelAccessResolution } => {
  const policy = parseAccessPolicy(options.metaJson)
  const resolved: ModelAccessResolution = {
    anonymous: { decision: options.defaults.anonymous, source: 'default' },
    user: { decision: options.defaults.user, source: 'default' },
  }

  if (policy?.anonymous && policy.anonymous !== 'inherit') {
    resolved.anonymous = { decision: policy.anonymous, source: 'override' }
  }
  if (policy?.user && policy.user !== 'inherit') {
    resolved.user = { decision: policy.user, source: 'override' }
  }

  return { policy: policy ?? null, resolved }
}

export const decideModelAccessForActor = (
  actor: Actor | { type: 'anonymous' | 'user' | 'admin' },
  resolved: ModelAccessResolution,
): 'allow' | 'deny' => {
  if ('role' in actor && actor.type === 'user' && actor.role === 'ADMIN') {
    return 'allow'
  }
  if ((actor as { type: string }).type === 'admin') return 'allow'
  if (actor.type === 'anonymous') {
    return resolved.anonymous.decision
  }
  return resolved.user.decision
}

export const parseAccessPolicyFromMeta = (metaJson?: string | null): ModelAccessPolicy | null =>
  parseAccessPolicy(metaJson)
