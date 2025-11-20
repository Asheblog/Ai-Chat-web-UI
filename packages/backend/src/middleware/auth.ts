import { Context, Next } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import type { Actor } from '../types'
import {
  determineProfileImageBaseUrl,
  resolveProfileImageUrl,
} from '../utils/profile-images'
import { authContextService } from '../services/auth/auth-context-service'

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

// 扩展Hono Context类型
declare module 'hono' {
  interface ContextVariableMap {
    actor: Actor;
    user?: {
      id: number;
      username: string;
      role: 'ADMIN' | 'USER';
      status: 'PENDING' | 'ACTIVE' | 'DISABLED';
    };
  }
}

export const actorMiddleware = async (c: Context, next: Next) => {
  const authHeader = c.req.header('Authorization')
  let authCookie: string | null = null
  let anonCookie: string | null = null
  try {
    authCookie = getCookie(c, 'token') || null
  } catch {}
  try {
    anonCookie = getCookie(c, ANON_COOKIE_KEY) || null
  } catch {}

  const result = await authContextService.resolveActor({
    authHeader,
    authCookie,
    anonCookie,
  })
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
    const baseUrl = determineProfileImageBaseUrl({ request: c.req.raw })
    const avatarUrl = resolveProfileImageUrl(result.actor.avatarPath ?? null, baseUrl)
    c.set('user', {
      id: result.actor.id,
      username: result.actor.username,
      role: result.actor.role,
      status: result.actor.status,
      avatarUrl: avatarUrl ?? null,
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
