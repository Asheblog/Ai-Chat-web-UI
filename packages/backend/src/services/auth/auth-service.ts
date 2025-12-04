import type { PrismaClient } from '@prisma/client'
import type { Actor, ActorContext, ModelPreference, UsageQuotaSnapshot } from '../../types'
import { prisma as defaultPrisma } from '../../db'
import { AuthUtils as defaultAuthUtils } from '../../utils/auth'
import {
  determineProfileImageBaseUrl as defaultDetermineProfileImageBaseUrl,
  resolveProfileImageUrl as defaultResolveProfileImageUrl,
} from '../../utils/profile-images'
import { inspectActorQuota as defaultInspectActorQuota } from '../../utils/quota'

export class AuthServiceError extends Error {
  statusCode: number
  details?: unknown

  constructor(message: string, statusCode = 400, details?: unknown) {
    super(message)
    this.name = 'AuthServiceError'
    this.statusCode = statusCode
    this.details = details
  }
}

export interface AuthServiceDeps {
  prisma?: PrismaClient
  authUtils?: Pick<
    typeof defaultAuthUtils,
    'validateUsername' | 'validatePassword' | 'hashPassword' | 'verifyPassword' | 'generateToken'
  >
  inspectActorQuota?: typeof defaultInspectActorQuota
  determineProfileImageBaseUrl?: typeof defaultDetermineProfileImageBaseUrl
  resolveProfileImageUrl?: typeof defaultResolveProfileImageUrl
  now?: () => Date
}

type SimpleUser = {
  id: number
  username: string
  role: 'ADMIN' | 'USER'
  status: 'PENDING' | 'ACTIVE' | 'DISABLED'
  avatarPath?: string | null
  avatarUrl?: string | null
  preferredModelId?: string | null
  preferredConnectionId?: number | null
  preferredModelRawId?: string | null
  personalPrompt?: string | null
}

export interface RegisterResult {
  user: SimpleUser
  token?: string
}

export interface LoginResult {
  user: SimpleUser
  token: string
  quota?: UsageQuotaSnapshot | null
}

export interface ActorContextResult {
  actor: Actor
  quota: UsageQuotaSnapshot | null
  user: ActorContext['user'] | null
  preferredModel: ModelPreference | null
  assistantAvatarUrl: string | null
}

export class AuthService {
  private prisma: PrismaClient
  private authUtils: Required<AuthServiceDeps['authUtils']>
  private inspectActorQuota: typeof defaultInspectActorQuota
  private determineProfileImageBaseUrl: typeof defaultDetermineProfileImageBaseUrl
  private resolveProfileImageUrl: typeof defaultResolveProfileImageUrl
  private now: () => Date

  constructor(deps: AuthServiceDeps = {}) {
    this.prisma = deps.prisma ?? defaultPrisma
    this.authUtils = deps.authUtils ?? defaultAuthUtils
    this.inspectActorQuota = deps.inspectActorQuota ?? defaultInspectActorQuota
    this.determineProfileImageBaseUrl = deps.determineProfileImageBaseUrl ?? defaultDetermineProfileImageBaseUrl
    this.resolveProfileImageUrl = deps.resolveProfileImageUrl ?? defaultResolveProfileImageUrl
    this.now = deps.now ?? (() => new Date())
  }

  async register(payload: { username: string; password: string }): Promise<RegisterResult> {
    const username = (payload.username || '').trim()
    if (!this.authUtils.validateUsername(username)) {
      throw new AuthServiceError('Username must be 3-20 characters, letters, numbers, and underscores only', 400)
    }
    if (!this.authUtils.validatePassword(payload.password || '')) {
      throw new AuthServiceError('Password must be at least 8 characters with letters and numbers', 400)
    }

    const existingCount = await this.prisma.user.count()
    if (existingCount > 0) {
      const registrationSetting = await this.prisma.systemSetting.findUnique({
        where: { key: 'registration_enabled' },
        select: { value: true },
      })
      const registrationEnabled = registrationSetting?.value !== 'false'
      if (!registrationEnabled) {
        throw new AuthServiceError('Registration is currently disabled', 403)
      }
    }

    const occupied = await this.prisma.user.findUnique({ where: { username }, select: { id: true } })
    if (occupied) {
      throw new AuthServiceError('Username already exists', 409)
    }

    const role = existingCount === 0 ? 'ADMIN' : 'USER'
    const status = existingCount === 0 ? 'ACTIVE' : 'PENDING'
    const now = this.now()
    const hashedPassword = await this.authUtils.hashPassword(payload.password)

    const user = await this.prisma.user.create({
      data: {
        username,
        hashedPassword,
        role,
        status,
        approvedAt: status === 'ACTIVE' ? now : null,
      },
      select: {
        id: true,
        username: true,
        role: true,
        status: true,
        avatarPath: true,
        personalPrompt: true,
      },
    })

    const token =
      status === 'ACTIVE'
        ? this.authUtils.generateToken({
            userId: user.id,
            username: user.username,
            role: user.role,
          })
        : undefined

    return {
      user: {
        id: user.id,
        username: user.username,
        role: user.role as 'ADMIN' | 'USER',
        status: user.status as 'PENDING' | 'ACTIVE' | 'DISABLED',
        avatarPath: user.avatarPath ?? null,
        personalPrompt: user.personalPrompt ?? null,
      },
      token,
    }
  }

  async login(payload: { username: string; password: string; request: Request }): Promise<LoginResult> {
    const { username, password } = payload
    const user = await this.prisma.user.findUnique({
      where: { username },
      select: {
        id: true,
        username: true,
        hashedPassword: true,
        role: true,
        status: true,
        rejectionReason: true,
        avatarPath: true,
        preferredModelId: true,
        preferredConnectionId: true,
        preferredModelRawId: true,
        personalPrompt: true,
      },
    })

    if (!user) {
      throw new AuthServiceError('Invalid username or password', 401)
    }

    const isValidPassword = await this.authUtils.verifyPassword(password, user.hashedPassword)
    if (!isValidPassword) {
      throw new AuthServiceError('Invalid username or password', 401)
    }

    if (user.status !== 'ACTIVE') {
      const locked = user.status === 'PENDING'
      const reason = locked ? 'Account pending approval' : 'Account has been disabled'
      throw new AuthServiceError(reason, locked ? 423 : 403, {
        status: user.status,
        rejectionReason: user.rejectionReason ?? undefined,
      })
    }

    const token = this.authUtils.generateToken({
      userId: user.id,
      username: user.username,
      role: user.role,
    })

    const avatarUrl = this.buildAvatarUrl(user.avatarPath ?? null, payload.request)

    const summaryUser: SimpleUser = {
      id: user.id,
      username: user.username,
      role: user.role as 'ADMIN' | 'USER',
      status: user.status as 'PENDING' | 'ACTIVE' | 'DISABLED',
      avatarPath: user.avatarPath ?? null,
      avatarUrl,
      preferredModelId: user.preferredModelId ?? null,
      preferredConnectionId: user.preferredConnectionId ?? null,
      preferredModelRawId: user.preferredModelRawId ?? null,
      personalPrompt: user.personalPrompt ?? null,
    }

    const quota = await this.inspectActorQuota({
      type: 'user',
      id: user.id,
      username: user.username,
      role: summaryUser.role,
      identifier: `user:${user.id}`,
    })

    return {
      user: { ...summaryUser },
      token,
      quota,
    }
  }

  async resolveActorContext(actor: Actor, request: Request): Promise<ActorContextResult> {
    const quota = await this.inspectActorQuota(actor)
    let profile: SimpleUser | null = null
    let preferredModel: ModelPreference | null = null
    const actorPayload: Actor =
      actor.type === 'user'
        ? {
            ...actor,
            avatarUrl: this.buildAvatarUrl(actor.avatarPath ?? null, request),
          }
        : actor

    if (actor.type === 'user') {
      const user = await this.prisma.user.findUnique({
        where: { id: actor.id },
        select: {
          id: true,
          username: true,
          role: true,
          status: true,
          createdAt: true,
          preferredModelId: true,
          preferredConnectionId: true,
          preferredModelRawId: true,
          avatarPath: true,
          personalPrompt: true,
        },
      })
      if (user) {
        profile = {
          id: user.id,
          username: user.username,
          role: user.role as 'ADMIN' | 'USER',
          status: user.status as 'PENDING' | 'ACTIVE' | 'DISABLED',
          avatarUrl: this.buildAvatarUrl(user.avatarPath ?? null, request),
          preferredModelId: user.preferredModelId ?? null,
          preferredConnectionId: user.preferredConnectionId ?? null,
          preferredModelRawId: user.preferredModelRawId ?? null,
          personalPrompt: user.personalPrompt ?? null,
        }
        preferredModel = {
          modelId: user.preferredModelId ?? null,
          connectionId: user.preferredConnectionId ?? null,
          rawId: user.preferredModelRawId ?? null,
        }
      }
    }

    return {
      actor: actorPayload,
      quota,
      user: profile
        ? {
            id: profile.id,
            username: profile.username,
            role: profile.role,
            status: profile.status,
            createdAt: await this.resolveUserCreatedAt(profile.id),
            avatarUrl: profile.avatarUrl ?? null,
            personalPrompt: profile.personalPrompt ?? null,
          }
        : null,
      preferredModel,
      assistantAvatarUrl: null,
    }
  }

  async updatePassword(params: { userId: number; currentPassword: string; newPassword: string }) {
    if (!this.authUtils.validatePassword(params.newPassword)) {
      throw new AuthServiceError('New password must be at least 8 characters with letters and numbers', 400)
    }

    const user = await this.prisma.user.findUnique({
      where: { id: params.userId },
      select: { id: true, username: true, role: true, status: true, hashedPassword: true },
    })
    if (!user) {
      throw new AuthServiceError('User not found', 404)
    }

    const isValidCurrentPassword = await this.authUtils.verifyPassword(params.currentPassword, user.hashedPassword)
    if (!isValidCurrentPassword) {
      throw new AuthServiceError('Current password is incorrect', 401)
    }

    const hashedNewPassword = await this.authUtils.hashPassword(params.newPassword)
    await this.prisma.user.update({
      where: { id: params.userId },
      data: { hashedPassword: hashedNewPassword },
    })

    return {
      user: {
        id: user.id,
        username: user.username,
        role: user.role as 'ADMIN' | 'USER',
        status: user.status as 'PENDING' | 'ACTIVE' | 'DISABLED',
      },
    }
  }

  private buildAvatarUrl(avatarPath: string | null | undefined, request: Request) {
    return this.resolveProfileImageUrl(avatarPath ?? null, this.determineProfileImageBaseUrl({ request })) ?? null
  }

  private async resolveUserCreatedAt(userId: number): Promise<Date> {
    const record = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { createdAt: true },
    })
    return record?.createdAt ?? new Date()
  }
}

let authService = new AuthService()

export const setAuthService = (service: AuthService) => {
  authService = service
}

export { authService }
