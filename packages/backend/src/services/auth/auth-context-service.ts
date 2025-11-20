import { randomBytes } from 'node:crypto'
import type { PrismaClient } from '@prisma/client'
import type { Actor, AnonymousActor, UserActor } from '../../types'
import { prisma as defaultPrisma } from '../../db'
import { AuthUtils as defaultAuthUtils } from '../../utils/auth'
import { getQuotaPolicy as defaultGetQuotaPolicy } from '../../utils/system-settings'

const ANON_KEY_REGEX = /^[a-zA-Z0-9_-]{10,128}$/

export interface AuthContextResult {
  actor: Actor | null
  status?: number
  error?: string
  clearAuth?: boolean
  clearAnon?: boolean
  anonCookie?: { key: string; retentionDays: number } | null
}

export interface AuthContextServiceDeps {
  prisma?: PrismaClient
  authUtils?: Pick<typeof defaultAuthUtils, 'extractTokenFromHeader' | 'verifyToken'>
  getQuotaPolicy?: typeof defaultGetQuotaPolicy
  randomBytesFn?: typeof randomBytes
  now?: () => Date
}

export class AuthContextService {
  private prisma: PrismaClient
  private authUtils: Required<AuthContextServiceDeps['authUtils']>
  private getQuotaPolicy: typeof defaultGetQuotaPolicy
  private randomBytesFn: typeof randomBytes
  private now: () => Date

  constructor(deps: AuthContextServiceDeps = {}) {
    this.prisma = deps.prisma ?? defaultPrisma
    this.authUtils = deps.authUtils ?? defaultAuthUtils
    this.getQuotaPolicy = deps.getQuotaPolicy ?? defaultGetQuotaPolicy
    this.randomBytesFn = deps.randomBytesFn ?? randomBytes
    this.now = deps.now ?? (() => new Date())
  }

  resolveToken(header?: string | null, cookie?: string | null) {
    return this.authUtils.extractTokenFromHeader(header) || cookie || null
  }

  async resolveActor(params: {
    authHeader?: string | null
    authCookie?: string | null
    anonCookie?: string | null
  }): Promise<AuthContextResult> {
    const token = this.resolveToken(params.authHeader, params.authCookie)

    if (token) {
      const payload = this.authUtils.verifyToken(token)
      if (!payload) {
        return { actor: null, status: 401, error: 'Invalid or expired token', clearAuth: true }
      }
      const user = await this.prisma.user.findUnique({
        where: { id: payload.userId },
        select: {
          id: true,
          username: true,
          role: true,
          status: true,
          preferredModelId: true,
          preferredConnectionId: true,
          preferredModelRawId: true,
          avatarPath: true,
        },
      })
      if (!user) {
        return { actor: null, status: 401, error: 'User not found', clearAuth: true }
      }
      if (user.status !== 'ACTIVE') {
        const error = user.status === 'PENDING' ? 'Account pending approval' : 'Account disabled'
        return { actor: null, status: user.status === 'PENDING' ? 423 : 403, error, clearAuth: true }
      }
      return {
        actor: this.buildUserActor({
          id: user.id,
          username: user.username,
          role: user.role as 'ADMIN' | 'USER',
          status: user.status as 'PENDING' | 'ACTIVE' | 'DISABLED',
          preferredModel: {
            modelId: user.preferredModelId ?? null,
            connectionId: user.preferredConnectionId ?? null,
            rawId: user.preferredModelRawId ?? null,
          },
          avatarPath: user.avatarPath ?? null,
        }),
      }
    }

    const quotaPolicy = await this.getQuotaPolicy()
    if (quotaPolicy.anonymousDailyQuota <= 0) {
      return { actor: null, status: 401, error: 'Anonymous access is disabled', clearAnon: true }
    }

    const anonKey = this.normalizeAnonKey(params.anonCookie) ?? this.generateAnonKey()

    return {
      actor: this.buildAnonymousActor(anonKey, quotaPolicy.anonymousRetentionDays),
      anonCookie: { key: anonKey, retentionDays: quotaPolicy.anonymousRetentionDays },
    }
  }

  buildUserActor(payload: {
    id: number
    username: string
    role: 'ADMIN' | 'USER'
    status: 'PENDING' | 'ACTIVE' | 'DISABLED'
    preferredModel?: { modelId: string | null; connectionId: number | null; rawId: string | null } | null
    avatarPath?: string | null
  }): UserActor {
    return {
      type: 'user',
      id: payload.id,
      username: payload.username,
      role: payload.role,
      status: payload.status,
      identifier: `user:${payload.id}`,
      preferredModel: payload.preferredModel ?? null,
      avatarPath: payload.avatarPath ?? null,
    }
  }

  buildAnonymousActor(key: string, retentionDays: number): AnonymousActor {
    const expiresAt =
      retentionDays > 0 ? new Date(this.now().getTime() + retentionDays * 24 * 60 * 60 * 1000) : null
    return {
      type: 'anonymous',
      key,
      identifier: `anon:${key}`,
      expiresAt,
    }
  }

  normalizeAnonKey(key?: string | null) {
    if (!key) return null
    const trimmed = key.trim()
    if (!trimmed) return null
    if (!ANON_KEY_REGEX.test(trimmed)) return null
    return trimmed
  }

  generateAnonKey() {
    return this.randomBytesFn(24).toString('base64url')
  }
}

export const authContextService = new AuthContextService()
