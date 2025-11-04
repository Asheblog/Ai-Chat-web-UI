import { randomBytes } from 'node:crypto'
import { Context, Next } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { AuthUtils } from '../utils/auth'
import { prisma } from '../db'
import { getQuotaPolicy } from '../utils/system-settings'
import type { Actor, AnonymousActor, UserActor } from '../types'

const ANON_COOKIE_KEY = 'anon_key'
const COOKIE_PATH_ROOT: Parameters<typeof deleteCookie>[2] = { path: '/' }

const toContentfulStatus = (status: number): ContentfulStatusCode => {
  if (status === 101 || status === 204 || status === 205 || status === 304) {
    return 200 as ContentfulStatusCode
  }
  if (status < 100 || status > 599) {
    return 500 as ContentfulStatusCode
  }
  return status as ContentfulStatusCode
}

const resolveTokenFromRequest = (c: Context) => {
  const authHeader = c.req.header('Authorization')
  let token = AuthUtils.extractTokenFromHeader(authHeader)
  if (!token) {
    try {
      token = getCookie(c, 'token') || null
    } catch {
      token = null
    }
  }
  return token
}

const buildUserActor = (payload: { id: number; username: string; role: 'ADMIN' | 'USER'; preferredModel?: { modelId: string | null; connectionId: number | null; rawId: string | null } | null }): UserActor => ({
  type: 'user',
  id: payload.id,
  username: payload.username,
  role: payload.role,
  identifier: `user:${payload.id}`,
  preferredModel: payload.preferredModel ?? null,
})

const buildAnonymousActor = (key: string, retentionDays: number): AnonymousActor => {
  const expiresAt = retentionDays > 0
    ? new Date(Date.now() + retentionDays * 24 * 60 * 60 * 1000)
    : null
  return {
    type: 'anonymous',
    key,
    identifier: `anon:${key}`,
    expiresAt,
  }
}

const ensureAnonCookie = (c: Context, key: string, retentionDays: number) => {
  const secure = (process.env.COOKIE_SECURE ?? '').toLowerCase() === 'true' || process.env.NODE_ENV === 'production'
  const cookieOptions: Parameters<typeof setCookie>[3] = {
    httpOnly: true,
    sameSite: 'Lax',
    secure,
    path: '/',
  }
  if (retentionDays > 0) {
    cookieOptions.maxAge = retentionDays * 24 * 60 * 60
  }
  setCookie(c, ANON_COOKIE_KEY, key, cookieOptions)
}

const normaliseAnonKey = (key?: string | null) => {
  if (!key) return null
  const trimmed = key.trim()
  if (!trimmed) return null
  if (!/^[a-zA-Z0-9_-]{10,128}$/.test(trimmed)) {
    return null
  }
  return trimmed
}

const generateAnonKey = () => randomBytes(24).toString('base64url')

const resolveActor = async (c: Context): Promise<{ actor: Actor | null; status?: number; error?: string; clearAuth?: boolean; clearAnon?: boolean }> => {
  const token = resolveTokenFromRequest(c)

  if (token) {
    const payload = AuthUtils.verifyToken(token)
    if (!payload) {
      return { actor: null, status: 401, error: 'Invalid or expired token', clearAuth: true }
    }
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { id: true, username: true, role: true, preferredModelId: true, preferredConnectionId: true, preferredModelRawId: true },
    })
    if (!user) {
      return { actor: null, status: 401, error: 'User not found', clearAuth: true }
    }
    return {
      actor: buildUserActor({
        ...user,
        role: user.role as 'ADMIN' | 'USER',
        preferredModel: {
          modelId: user.preferredModelId ?? null,
          connectionId: user.preferredConnectionId ?? null,
          rawId: user.preferredModelRawId ?? null,
        },
      }),
    }
  }

  const quotaPolicy = await getQuotaPolicy()
  if (quotaPolicy.anonymousDailyQuota <= 0) {
    return { actor: null, status: 401, error: 'Anonymous access is disabled', clearAnon: true }
  }

  let anonKey = null
  try {
    anonKey = normaliseAnonKey(getCookie(c, ANON_COOKIE_KEY))
  } catch {
    anonKey = null
  }

  if (!anonKey) {
    anonKey = generateAnonKey()
  }

  ensureAnonCookie(c, anonKey, quotaPolicy.anonymousRetentionDays)

  return { actor: buildAnonymousActor(anonKey, quotaPolicy.anonymousRetentionDays) }
}

// 扩展Hono Context类型
declare module 'hono' {
  interface ContextVariableMap {
    actor: Actor;
    user?: {
      id: number;
      username: string;
      role: 'ADMIN' | 'USER';
    };
  }
}

export const actorMiddleware = async (c: Context, next: Next) => {
  const result = await resolveActor(c)
  if (!result.actor) {
    if (result.clearAuth) {
      try { deleteCookie(c, 'token', COOKIE_PATH_ROOT) } catch {}
    }
    if (result.clearAnon) {
      try { deleteCookie(c, ANON_COOKIE_KEY, COOKIE_PATH_ROOT) } catch {}
    }
    if (result.status === 401) {
      return c.json({ success: false, error: result.error ?? 'Unauthorized' }, 401)
    }
    return c.json({ success: false, error: result.error ?? 'Forbidden' }, toContentfulStatus(result.status ?? 403))
  }

  c.set('actor', result.actor)

  if (result.actor.type === 'user') {
    c.set('user', {
      id: result.actor.id,
      username: result.actor.username,
      role: result.actor.role,
    })
  }

  await next()
}

export const requireUserActor = async (c: Context, next: Next) => {
  const actor = c.get('actor') as Actor | undefined
  if (!actor || actor.type !== 'user') {
    return c.json({
      success: false,
      error: 'Authentication required',
    }, 401)
  }
  await next()
}

// 管理员权限中间件
export const adminOnlyMiddleware = async (c: Context, next: Next) => {
  const actor = c.get('actor') as Actor | undefined

  if (!actor || actor.type !== 'user' || actor.role !== 'ADMIN') {
    return c.json({
      success: false,
      error: 'Admin access required',
    }, 403)
  }

  await next()
}
