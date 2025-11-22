import { prisma } from '../db'
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

const ACCESS_CACHE_TTL_MS = 30_000
let cachedDefaults: { value: ModelAccessDefaults; expiresAt: number } | null = null

const isTriState = (value: unknown): value is ModelAccessTriState =>
  value === 'allow' || value === 'deny' || value === 'inherit'

const parseAccessPolicy = (metaJson?: string | null): ModelAccessPolicy | null => {
  if (!metaJson) return null
  try {
    const parsed = JSON.parse(metaJson)
    const policy = (parsed as any)?.access_policy
    if (!policy || typeof policy !== 'object') return null
    const normalized: ModelAccessPolicy = {}
    if (isTriState((policy as any).anonymous)) {
      normalized.anonymous = (policy as any).anonymous
    }
    if (isTriState((policy as any).user)) {
      normalized.user = (policy as any).user
    }
    return Object.keys(normalized).length ? normalized : null
  } catch {
    return null
  }
}

export const getModelAccessDefaults = async (): Promise<ModelAccessDefaults> => {
  const now = Date.now()
  if (cachedDefaults && cachedDefaults.expiresAt > now) {
    return cachedDefaults.value
  }

  const rows = await prisma.systemSetting.findMany({
    where: { key: { in: ['model_access_default_anonymous', 'model_access_default_user'] } },
    select: { key: true, value: true },
  })

  const map = new Map(rows.map((row) => [row.key, row.value]))

  const anonymous = map.get('model_access_default_anonymous') === 'allow' ? 'allow' : 'deny'
  const user = map.get('model_access_default_user') === 'deny' ? 'deny' : 'allow'

  const value: ModelAccessDefaults = { anonymous, user }
  cachedDefaults = { value, expiresAt: now + ACCESS_CACHE_TTL_MS }
  return value
}

export const invalidateModelAccessDefaultsCache = () => {
  cachedDefaults = null
}

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
  if ((actor as any).type === 'admin') return 'allow'
  if (actor.type === 'anonymous') {
    return resolved.anonymous.decision
  }
  return resolved.user.decision
}

export const parseAccessPolicyFromMeta = (metaJson?: string | null): ModelAccessPolicy | null => parseAccessPolicy(metaJson)
