import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { actorMiddleware, requireUserActor, adminOnlyMiddleware } from '../middleware/auth'
import type { ApiResponse } from '../types'
import { serializeQuotaSnapshot } from '../utils/quota'
import { userService, UserServiceError, type ListStatus } from '../services/users'

const users = new Hono()

users.use('*', actorMiddleware, requireUserActor, adminOnlyMiddleware)

const quotaUpdateSchema = z.object({
  dailyLimit: z.union([z.number().int().min(0), z.literal(null)]),
  resetUsed: z.boolean().optional(),
})

const createUserSchema = z.object({
  username: z.string().min(3).max(20),
  password: z.string().min(8),
  role: z.enum(['ADMIN', 'USER']).optional(),
  status: z.enum(['ACTIVE', 'DISABLED', 'PENDING']).optional(),
})

const updateUsernameSchema = z.object({
  username: z.string().min(3).max(20),
})

const resetPasswordSchema = z.object({
  password: z.string().min(8),
})

const statusUpdateSchema = z.object({
  status: z.enum(['ACTIVE', 'DISABLED']),
  reason: z.string().max(200).optional(),
})

const rejectionSchema = z.object({
  reason: z.string().max(200).optional(),
})

const listStatusValues: ListStatus[] = ['PENDING', 'ACTIVE', 'DISABLED']

const parseId = (value: string): number | null => {
  const parsed = parseInt(value, 10)
  return Number.isNaN(parsed) ? null : parsed
}

const handleServiceError = (
  c: any,
  error: unknown,
  fallbackMessage: string,
  logLabel: string,
) => {
  if (error instanceof UserServiceError) {
    return c.json<ApiResponse>({ success: false, error: error.message }, error.statusCode)
  }
  console.error(logLabel, error)
  return c.json<ApiResponse>({ success: false, error: fallbackMessage }, 500)
}

users.post('/', zValidator('json', createUserSchema), async (c) => {
  try {
    const payload = c.req.valid('json')
    const currentUser = c.get('user')
    const newUser = await userService.createUser(payload, currentUser?.id ?? null)
    return c.json<ApiResponse>({
      success: true,
      data: newUser,
      message: 'User created successfully',
    })
  } catch (error) {
    return handleServiceError(c, error, 'Failed to create user', 'Create user error:')
  }
})

users.get('/', async (c) => {
  try {
    const page = parseInt(c.req.query('page') || '1', 10)
    const limit = parseInt(c.req.query('limit') || '10', 10)
    const search = c.req.query('search') ?? undefined
    const rawStatus = c.req.query('status')
    const normalizedStatus = rawStatus ? rawStatus.toUpperCase() : undefined
    const status = normalizedStatus && listStatusValues.includes(normalizedStatus as ListStatus)
      ? (normalizedStatus as ListStatus)
      : undefined
    const result = await userService.listUsers({ page, limit, search, status })
    return c.json<ApiResponse<typeof result>>({ success: true, data: result })
  } catch (error) {
    return handleServiceError(c, error, 'Failed to fetch users', 'Get users error:')
  }
})

users.get('/:id', async (c) => {
  try {
    const userId = parseId(c.req.param('id'))
    if (!userId) {
      return c.json<ApiResponse>({ success: false, error: 'Invalid user ID' }, 400)
    }
    const user = await userService.getUserWithCounts(userId)
    return c.json<ApiResponse>({ success: true, data: user })
  } catch (error) {
    return handleServiceError(c, error, 'Failed to fetch user', 'Get user error:')
  }
})

users.get('/:id/quota', async (c) => {
  try {
    const targetId = parseId(c.req.param('id'))
    if (!targetId) {
      return c.json<ApiResponse>({ success: false, error: 'Invalid user ID' }, 400)
    }
    const result = await userService.getUserQuota(targetId)
    return c.json<ApiResponse<{ quota: ReturnType<typeof serializeQuotaSnapshot> }>>({
      success: true,
      data: {
        quota: serializeQuotaSnapshot(result.quota),
      },
    })
  } catch (error) {
    return handleServiceError(c, error, 'Failed to fetch user quota', 'Get user quota error:')
  }
})

users.put('/:id/username', zValidator('json', updateUsernameSchema), async (c) => {
  try {
    const targetId = parseId(c.req.param('id'))
    if (!targetId) {
      return c.json<ApiResponse>({ success: false, error: 'Invalid user ID' }, 400)
    }
    const { username } = c.req.valid('json')
    const currentUser = c.get('user')!
    const updated = await userService.updateUsername(targetId, username, currentUser.id)
    return c.json<ApiResponse>({ success: true, data: updated, message: 'Username updated successfully' })
  } catch (error) {
    return handleServiceError(c, error, 'Failed to update username', 'Update username error:')
  }
})

users.put('/:id/role', async (c) => {
  try {
    const userId = parseId(c.req.param('id'))
    if (!userId) {
      return c.json<ApiResponse>({ success: false, error: 'Invalid user ID' }, 400)
    }
    const { role } = await c.req.json()
    if (!['ADMIN', 'USER'].includes(role)) {
      return c.json<ApiResponse>({ success: false, error: 'Invalid role. Must be ADMIN or USER' }, 400)
    }
    const currentUser = c.get('user')!
    const updated = await userService.updateRole(userId, role, currentUser.id)
    return c.json<ApiResponse>({ success: true, data: updated, message: 'User role updated successfully' })
  } catch (error) {
    return handleServiceError(c, error, 'Failed to update user role', 'Update user role error:')
  }
})

users.post('/:id/approve', async (c) => {
  try {
    const targetId = parseId(c.req.param('id'))
    if (!targetId) {
      return c.json<ApiResponse>({ success: false, error: 'Invalid user ID' }, 400)
    }
    const currentUser = c.get('user')!
    const updated = await userService.approveUser(targetId, currentUser.id)
    return c.json<ApiResponse>({ success: true, data: updated, message: 'User approved successfully' })
  } catch (error) {
    return handleServiceError(c, error, 'Failed to approve user', 'Approve user error:')
  }
})

users.post('/:id/reject', zValidator('json', rejectionSchema), async (c) => {
  try {
    const targetId = parseId(c.req.param('id'))
    if (!targetId) {
      return c.json<ApiResponse>({ success: false, error: 'Invalid user ID' }, 400)
    }
    const { reason } = c.req.valid('json')
    const currentUser = c.get('user')!
    const updated = await userService.rejectUser(targetId, reason, currentUser.id)
    return c.json<ApiResponse>({ success: true, data: updated, message: 'User request rejected' })
  } catch (error) {
    return handleServiceError(c, error, 'Failed to reject user', 'Reject user error:')
  }
})

users.post('/:id/status', zValidator('json', statusUpdateSchema), async (c) => {
  try {
    const targetId = parseId(c.req.param('id'))
    if (!targetId) {
      return c.json<ApiResponse>({ success: false, error: 'Invalid user ID' }, 400)
    }
    const { status, reason } = c.req.valid('json')
    const currentUser = c.get('user')!
    const updated = await userService.updateStatus(targetId, status, reason, currentUser.id)
    return c.json<ApiResponse>({ success: true, data: updated, message: 'User status updated' })
  } catch (error) {
    return handleServiceError(c, error, 'Failed to update user status', 'Update user status error:')
  }
})

users.put('/:id/password', zValidator('json', resetPasswordSchema), async (c) => {
  try {
    const targetId = parseId(c.req.param('id'))
    if (!targetId) {
      return c.json<ApiResponse>({ success: false, error: 'Invalid user ID' }, 400)
    }
    const { password } = c.req.valid('json')
    const currentUser = c.get('user')!
    await userService.resetPassword(targetId, password, currentUser.id)
    return c.json<ApiResponse>({ success: true, message: 'Password reset successfully' })
  } catch (error) {
    return handleServiceError(c, error, 'Failed to reset password', 'Reset user password error:')
  }
})

users.delete('/:id', async (c) => {
  try {
    const userId = parseId(c.req.param('id'))
    if (!userId) {
      return c.json<ApiResponse>({ success: false, error: 'Invalid user ID' }, 400)
    }
    const currentUser = c.get('user')!
    await userService.deleteUser(userId, currentUser.id)
    return c.json<ApiResponse>({ success: true, message: 'User deleted successfully' })
  } catch (error) {
    return handleServiceError(c, error, 'Failed to delete user', 'Delete user error:')
  }
})

users.put('/:id/quota', zValidator('json', quotaUpdateSchema), async (c) => {
  try {
    const targetId = parseId(c.req.param('id'))
    if (!targetId) {
      return c.json<ApiResponse>({ success: false, error: 'Invalid user ID' }, 400)
    }
    const payload = c.req.valid('json')
    const currentUser = c.get('user')!
    const result = await userService.updateQuota(targetId, payload, currentUser.id)
    return c.json<ApiResponse<{ quota: ReturnType<typeof serializeQuotaSnapshot>; user: typeof result.user }>>({
      success: true,
      data: {
        user: result.user,
        quota: serializeQuotaSnapshot(result.quota),
      },
      message: 'User quota updated',
    })
  } catch (error) {
    return handleServiceError(c, error, 'Failed to update user quota', 'Update user quota error:')
  }
})

export default users
