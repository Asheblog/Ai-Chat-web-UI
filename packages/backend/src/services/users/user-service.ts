import type { Prisma, PrismaClient } from '@prisma/client'
import type { UsageQuotaSnapshot } from '../../types'
import { prisma as defaultPrisma } from '../../db'
import { AuthUtils as defaultAuthUtils } from '../../utils/auth'
import { inspectActorQuota as defaultInspectActorQuota } from '../quota/legacy-utils'

export class UserServiceError extends Error {
  statusCode: number

  constructor(message: string, statusCode = 400) {
    super(message)
    this.name = 'UserServiceError'
    this.statusCode = statusCode
  }
}

const basicUserSelect = {
  id: true,
  username: true,
  role: true,
  status: true,
  createdAt: true,
  approvedAt: true,
  approvedById: true,
  rejectedAt: true,
  rejectedById: true,
  rejectionReason: true,
} as const

// 只在本表内可数的关系走 Prisma _count；用户连接数需要跨 connectionGroups -> credentials
// 两层统计（见 UserService.loadUserConnectionCounts），不能交给 User 的 _count。
const userWithCountsSelect = {
  ...basicUserSelect,
  _count: {
    select: {
      chatSessions: true,
    },
  },
} as const

type BasicUser = Prisma.UserGetPayload<{ select: typeof basicUserSelect }>
type UserWithSessionCounts = Prisma.UserGetPayload<{ select: typeof userWithCountsSelect }>

/**
 * 管理端用户列表/详情的计数口径。
 *
 * connections 是「连接凭据」数量（connections 表行数，即该用户连接组下的 API Key 条数），
 * 不是「连接组」数量，两者不得互相顶替
 * （见 GLOSSARY「Connection Group / Connection Credential」、ADR-0034）。
 */
export interface UserCounts {
  chatSessions: number
  connections: number
}

export type UserWithCounts = Omit<UserWithSessionCounts, '_count'> & {
  _count: UserCounts
}

export type ListStatus = 'PENDING' | 'ACTIVE' | 'DISABLED'

export interface CreateUserPayload {
  username: string
  password: string
  role?: 'ADMIN' | 'USER'
  status?: 'ACTIVE' | 'DISABLED' | 'PENDING'
}

interface ListUsersOptions {
  page: number
  limit: number
  search?: string
  status?: ListStatus
}

export interface UpdateQuotaOptions {
  dailyLimit: number | null
  resetUsed?: boolean
}

export interface UserServiceDeps {
  prisma?: PrismaClient
  authUtils?: Pick<typeof defaultAuthUtils, 'validateUsername' | 'validatePassword' | 'hashPassword'>
  inspectActorQuota?: typeof defaultInspectActorQuota
  now?: () => Date
  logger?: Pick<typeof console, 'warn' | 'error'>
}

type UserServiceAuthUtils = Pick<
  typeof defaultAuthUtils,
  'validateUsername' | 'validatePassword' | 'hashPassword'
>

const ensurePositive = (value: number) => (Number.isFinite(value) && value > 0 ? value : 0)

export class UserService {
  private prisma: PrismaClient
  private authUtils: UserServiceAuthUtils
  private inspectActorQuota: typeof defaultInspectActorQuota
  private now: () => Date
  private logger: Pick<typeof console, 'warn' | 'error'>

  constructor(deps: UserServiceDeps = {}) {
    this.prisma = deps.prisma ?? defaultPrisma
    this.authUtils = deps.authUtils ?? defaultAuthUtils
    this.inspectActorQuota = deps.inspectActorQuota ?? defaultInspectActorQuota
    this.now = deps.now ?? (() => new Date())
    this.logger = deps.logger ?? console
  }

  async createUser(payload: CreateUserPayload, actorId: number | null): Promise<BasicUser> {
    const username = payload.username?.trim() || ''
    if (!this.authUtils.validateUsername(username)) {
      throw new UserServiceError('Username must be 3-20 characters, letters, numbers, and underscores only')
    }

    if (!this.authUtils.validatePassword(payload.password ?? '')) {
      throw new UserServiceError('Password must be at least 8 characters with letters and numbers')
    }

    const existing = await this.prisma.user.findUnique({ where: { username } })
    if (existing) {
      throw new UserServiceError('Username already exists', 409)
    }

    const now = this.now()
    const hashedPassword = await this.authUtils.hashPassword(payload.password)
    const user = await this.prisma.user.create({
      data: {
        username,
        hashedPassword,
        role: payload.role ?? 'USER',
        status: payload.status ?? 'ACTIVE',
        approvedAt: payload.status === 'ACTIVE' ? now : null,
        approvedById: payload.status === 'ACTIVE' ? actorId ?? null : null,
        rejectedAt: payload.status === 'DISABLED' ? now : null,
        rejectedById: payload.status === 'DISABLED' ? actorId ?? null : null,
      },
      select: basicUserSelect,
    })
    return user
  }

  async listUsers(options: ListUsersOptions) {
    const { page, limit } = this.normalizePagination(options.page, options.limit)
    const where: Prisma.UserWhereInput = {}
    if (options.search) {
      where.username = { contains: options.search }
    }
    if (options.status) {
      where.status = options.status
    }

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: userWithCountsSelect,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.user.count({ where }),
    ])

    return {
      users: await this.attachCounts(users),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    }
  }

  async getUserWithCounts(id: number): Promise<UserWithCounts> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: userWithCountsSelect,
    })
    if (!user) {
      throw new UserServiceError('User not found', 404)
    }
    const [withCounts] = await this.attachCounts([user])
    return withCounts
  }

  async getUserQuota(id: number): Promise<{ user: { id: number; username: string; role: 'ADMIN' | 'USER' }; quota: UsageQuotaSnapshot }> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, username: true, role: true, status: true },
    })
    if (!user) {
      throw new UserServiceError('User not found', 404)
    }
    const snapshot = await this.inspectActorQuota({
      type: 'user',
      id: user.id,
      username: user.username,
      role: user.role as 'ADMIN' | 'USER',
      status: user.status as 'PENDING' | 'ACTIVE' | 'DISABLED',
      identifier: `user:${user.id}`,
    })
    return {
      user: {
        id: user.id,
        username: user.username,
        role: user.role as 'ADMIN' | 'USER',
      },
      quota: snapshot,
    }
  }

  async updateUsername(targetId: number, username: string, actorId: number): Promise<BasicUser> {
    if (targetId === actorId) {
      throw new UserServiceError('Use personal settings to rename your own account')
    }
    const normalized = username?.trim() || ''
    if (!this.authUtils.validateUsername(normalized)) {
      throw new UserServiceError('Username must be 3-20 characters, letters, numbers, and underscores only')
    }
    const targetUser = await this.ensureUser(targetId, { id: true, username: true })
    const occupied = await this.prisma.user.findUnique({ where: { username: normalized }, select: { id: true } })
    if (occupied && occupied.id !== targetId) {
      throw new UserServiceError('Username already exists', 409)
    }
    return this.prisma.user.update({
      where: { id: targetId },
      data: { username: normalized },
      select: basicUserSelect,
    })
  }

  async updateRole(targetId: number, role: 'ADMIN' | 'USER', actorId: number): Promise<BasicUser> {
    if (targetId === actorId) {
      throw new UserServiceError('Cannot modify your own role')
    }
    await this.ensureUser(targetId, { id: true })
    if (role === 'USER') {
      await this.ensureAnotherActiveAdmin(targetId)
    }
    return this.prisma.user.update({
      where: { id: targetId },
      data: { role },
      select: basicUserSelect,
    })
  }

  async approveUser(targetId: number, actorId: number): Promise<BasicUser> {
    const pending = await this.prisma.user.findUnique({
      where: { id: targetId },
      select: { id: true, status: true },
    })
    if (!pending) {
      throw new UserServiceError('User not found', 404)
    }
    if (pending.status !== 'PENDING') {
      throw new UserServiceError('Only pending users can be approved')
    }
    const now = this.now()
    return this.prisma.user.update({
      where: { id: targetId },
      data: {
        status: 'ACTIVE',
        approvedAt: now,
        approvedById: actorId,
        rejectedAt: null,
        rejectedById: null,
        rejectionReason: null,
      },
      select: basicUserSelect,
    })
  }

  async rejectUser(targetId: number, reason: string | undefined, actorId: number): Promise<BasicUser> {
    const pending = await this.prisma.user.findUnique({
      where: { id: targetId },
      select: { id: true, status: true },
    })
    if (!pending) {
      throw new UserServiceError('User not found', 404)
    }
    if (pending.status !== 'PENDING') {
      throw new UserServiceError('Only pending users can be rejected here')
    }
    const now = this.now()
    const trimmed = reason?.trim().slice(0, 200) || null
    return this.prisma.user.update({
      where: { id: targetId },
      data: {
        status: 'DISABLED',
        rejectedAt: now,
        rejectedById: actorId,
        rejectionReason: trimmed,
      },
      select: basicUserSelect,
    })
  }

  async updateStatus(targetId: number, status: 'ACTIVE' | 'DISABLED', reason: string | undefined, actorId: number): Promise<BasicUser> {
    const targetUser = await this.prisma.user.findUnique({
      where: { id: targetId },
      select: { id: true, status: true, role: true },
    })
    if (!targetUser) {
      throw new UserServiceError('User not found', 404)
    }
    if (targetUser.status === 'PENDING') {
      throw new UserServiceError('Pending users must be approved or rejected first')
    }
    if (status === targetUser.status) {
      const unchanged = await this.prisma.user.findUnique({ where: { id: targetId }, select: basicUserSelect })
      if (!unchanged) {
        throw new UserServiceError('User not found', 404)
      }
      return unchanged
    }
    if (status === 'DISABLED') {
      if (targetId === actorId) {
        throw new UserServiceError('You cannot disable your own account')
      }
      if (targetUser.role === 'ADMIN') {
        await this.ensureAnotherActiveAdmin(targetId)
      }
    }

    const now = this.now()
    const trimmed = reason?.trim().slice(0, 200) || null
    const updateData: Prisma.UserUpdateInput = { status }
    if (status === 'ACTIVE') {
      updateData.approvedAt = now
      updateData.approvedById = actorId
      updateData.rejectedAt = null
      updateData.rejectedById = null
      updateData.rejectionReason = null
    } else {
      updateData.rejectedAt = now
      updateData.rejectedById = actorId
      updateData.rejectionReason = trimmed
    }

    return this.prisma.user.update({
      where: { id: targetId },
      data: updateData,
      select: basicUserSelect,
    })
  }

  async resetPassword(targetId: number, password: string, actorId: number): Promise<void> {
    if (targetId === actorId) {
      throw new UserServiceError('Use personal settings to change your own password')
    }
    if (!this.authUtils.validatePassword(password)) {
      throw new UserServiceError('Password must be at least 8 characters with letters and numbers')
    }
    await this.ensureUser(targetId, { id: true })
    const hashedPassword = await this.authUtils.hashPassword(password)
    await this.prisma.user.update({ where: { id: targetId }, data: { hashedPassword } })
  }

  async deleteUser(targetId: number, actorId: number): Promise<void> {
    if (targetId === actorId) {
      throw new UserServiceError('Cannot delete your own account')
    }
    const user = await this.prisma.user.findUnique({ where: { id: targetId }, select: { id: true, role: true } })
    if (!user) {
      throw new UserServiceError('User not found', 404)
    }
    if (user.role === 'ADMIN') {
      await this.ensureAnotherActiveAdmin(targetId)
    }
    await this.prisma.user.delete({ where: { id: targetId } })
  }

  async updateQuota(targetId: number, options: UpdateQuotaOptions, actorId: number) {
    const targetUser = await this.prisma.user.findUnique({
      where: { id: targetId },
      select: { id: true, username: true, role: true, status: true },
    })
    if (!targetUser) {
      throw new UserServiceError('User not found', 404)
    }
    const sanitizedLimit = options.dailyLimit === null ? null : Math.max(0, options.dailyLimit)
    if (targetUser.id === actorId && sanitizedLimit !== null && sanitizedLimit < 1) {
      throw new UserServiceError('Cannot set your own daily limit below 1 to avoid lock-out')
    }

    const identifier = `user:${targetUser.id}`
    const now = this.now()
    const updatePayload: {
      customDailyLimit: number | null
      userId: number
      usedCount?: number
      lastResetAt?: Date
    } = {
      customDailyLimit: sanitizedLimit,
      userId: targetUser.id,
    }
    if (options.resetUsed) {
      updatePayload.usedCount = 0
      updatePayload.lastResetAt = now
    }

    await this.prisma.usageQuota.upsert({
      where: { scope_identifier: { scope: 'USER', identifier } },
      update: updatePayload,
      create: {
        scope: 'USER',
        identifier,
        customDailyLimit: sanitizedLimit,
        usedCount: 0,
        lastResetAt: now,
        userId: targetUser.id,
      },
    })

    const snapshot = await this.inspectActorQuota({
      type: 'user',
      id: targetUser.id,
      username: targetUser.username,
      role: targetUser.role as 'ADMIN' | 'USER',
      status: targetUser.status as 'PENDING' | 'ACTIVE' | 'DISABLED',
      identifier,
    })

    return {
      user: targetUser,
      quota: snapshot,
    }
  }

  /**
   * 批量统计用户的连接凭据数：一次 connectionGroup 查询取回所有用户的组及其
   * 组内 credentials 计数再按 owner 累加，避免按用户 N+1 次 count。
   *
   * 只数 connections 表行（凭据），不把连接组数量当连接数量。
   */
  private async loadUserConnectionCounts(userIds: number[]): Promise<Map<number, number>> {
    const counts = new Map<number, number>()
    if (userIds.length === 0) return counts

    const groups = await this.prisma.connectionGroup.findMany({
      where: { ownerUserId: { in: userIds } },
      select: {
        ownerUserId: true,
        _count: { select: { credentials: true } },
      },
    })

    for (const group of groups) {
      // ownerUserId 为 null 的是系统级连接组，不属于任何用户
      if (group.ownerUserId === null) continue
      counts.set(group.ownerUserId, (counts.get(group.ownerUserId) ?? 0) + group._count.credentials)
    }

    return counts
  }

  private async attachCounts(users: UserWithSessionCounts[]): Promise<UserWithCounts[]> {
    const connectionCounts = await this.loadUserConnectionCounts(users.map((user) => user.id))
    return users.map((user) => ({
      ...user,
      _count: {
        chatSessions: user._count.chatSessions,
        connections: connectionCounts.get(user.id) ?? 0,
      },
    }))
  }

  private normalizePagination(page: number, limit: number) {
    const normalizedPage = ensurePositive(page) || 1
    const normalizedLimit = ensurePositive(limit) || 20
    return { page: normalizedPage, limit: normalizedLimit }
  }

  private async ensureUser<T extends Prisma.UserSelect>(id: number, select: T): Promise<Prisma.UserGetPayload<{ select: T }>> {
    const user = await this.prisma.user.findUnique({ where: { id }, select })
    if (!user) {
      throw new UserServiceError('User not found', 404)
    }
    return user
  }

  private async ensureAnotherActiveAdmin(excludeUserId: number) {
    const adminCount = await this.prisma.user.count({
      where: {
        role: 'ADMIN',
        status: 'ACTIVE',
        id: { not: excludeUserId },
      },
    })
    if (adminCount < 1) {
      throw new UserServiceError('At least one active admin is required')
    }
  }
}

export { basicUserSelect, userWithCountsSelect }
