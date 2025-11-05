import { Hono } from 'hono';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { zValidator } from '@hono/zod-validator';
import { prisma } from '../db';
import { actorMiddleware, requireUserActor, adminOnlyMiddleware } from '../middleware/auth';
import type { ApiResponse, Actor } from '../types';
import { inspectActorQuota, serializeQuotaSnapshot } from '../utils/quota';
import { AuthUtils } from '../utils/auth';

const users = new Hono();

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

const listStatusValues = ['PENDING', 'ACTIVE', 'DISABLED'] as const
type ListStatus = typeof listStatusValues[number]

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

const userWithCountsSelect = {
  ...basicUserSelect,
  _count: {
    select: {
      chatSessions: true,
      connections: true,
    },
  },
} as const

users.post('/', zValidator('json', createUserSchema), async (c) => {
  try {
    const payload = c.req.valid('json');
    const username = payload.username.trim();
    const password = payload.password;
    const role = payload.role ?? 'USER';
    const status = payload.status ?? 'ACTIVE';

    if (!AuthUtils.validateUsername(username)) {
      return c.json<ApiResponse>({
        success: false,
        error: 'Username must be 3-20 characters, letters, numbers, and underscores only',
      }, 400);
    }

    if (!AuthUtils.validatePassword(password)) {
      return c.json<ApiResponse>({
        success: false,
        error: 'Password must be at least 8 characters with letters and numbers',
      }, 400);
    }

    const existing = await prisma.user.findUnique({ where: { username } });
    if (existing) {
      return c.json<ApiResponse>({
        success: false,
        error: 'Username already exists',
      }, 409);
    }

    const hashedPassword = await AuthUtils.hashPassword(password);
    const now = new Date();
    const newUser = await prisma.user.create({
      data: {
        username,
        hashedPassword,
        role,
        status,
        approvedAt: status === 'ACTIVE' ? now : null,
        approvedById: status === 'ACTIVE' ? c.get('user')?.id ?? null : null,
        rejectedAt: status === 'DISABLED' ? now : null,
        rejectedById: status === 'DISABLED' ? c.get('user')?.id ?? null : null,
      },
      select: {
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
      },
    });

    return c.json<ApiResponse>({
      success: true,
      data: newUser,
      message: 'User created successfully',
    });
  } catch (error) {
    console.error('Create user error:', error);
    return c.json<ApiResponse>({
      success: false,
      error: 'Failed to create user',
    }, 500);
  }
});

// 获取所有用户 (仅管理员)
users.get('/', async (c) => {
  try {
    const page = parseInt(c.req.query('page') || '1');
    const limit = parseInt(c.req.query('limit') || '10');
    const search = c.req.query('search');
    const rawStatus = c.req.query('status');
    const normalisedStatus = rawStatus ? rawStatus.toUpperCase() : undefined;
    const statusFilter = normalisedStatus && (listStatusValues as readonly string[]).includes(normalisedStatus)
      ? (normalisedStatus as ListStatus)
      : undefined;

    const where: Prisma.UserWhereInput = {};
    if (search) {
      where.username = {
        contains: search,
      };
    }
    if (statusFilter) {
      where.status = statusFilter;
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: userWithCountsSelect,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.user.count({ where }),
    ]);

    return c.json<ApiResponse>({
      success: true,
      data: {
        users,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    });

  } catch (error) {
    console.error('Get users error:', error);
    return c.json<ApiResponse>({
      success: false,
      error: 'Failed to fetch users',
    }, 500);
  }
});

// 获取单个用户详情 (仅管理员)
users.get('/:id', async (c) => {
  try {
    const userId = parseInt(c.req.param('id'));

    if (isNaN(userId)) {
      return c.json<ApiResponse>({
        success: false,
        error: 'Invalid user ID',
      }, 400);
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: userWithCountsSelect,
    });

    if (!user) {
      return c.json<ApiResponse>({
        success: false,
        error: 'User not found',
      }, 404);
    }

    return c.json<ApiResponse>({
      success: true,
      data: user,
    });

  } catch (error) {
    console.error('Get user error:', error);
    return c.json<ApiResponse>({
      success: false,
      error: 'Failed to fetch user',
    }, 500);
  }
});

users.get('/:id/quota', async (c) => {
  try {
    const targetId = parseInt(c.req.param('id'));
    if (Number.isNaN(targetId)) {
      return c.json<ApiResponse>({
        success: false,
        error: 'Invalid user ID',
      }, 400);
    }

    const user = await prisma.user.findUnique({
      where: { id: targetId },
      select: { id: true, username: true, role: true },
    });

    if (!user) {
      return c.json<ApiResponse>({
        success: false,
        error: 'User not found',
      }, 404);
    }

    const quotaActor: Actor = {
      type: 'user',
      id: user.id,
      username: user.username,
      role: user.role as 'ADMIN' | 'USER',
      identifier: `user:${user.id}`,
    };

    const snapshot = await inspectActorQuota(quotaActor);

    return c.json<ApiResponse<{ quota: ReturnType<typeof serializeQuotaSnapshot> }>>({
      success: true,
      data: {
        quota: serializeQuotaSnapshot(snapshot),
      },
    });
  } catch (error) {
    console.error('Get user quota error:', error);
    return c.json<ApiResponse>({
      success: false,
      error: 'Failed to fetch user quota',
    }, 500);
  }
});

users.put('/:id/username', zValidator('json', updateUsernameSchema), async (c) => {
  try {
    const targetId = parseInt(c.req.param('id'));
    if (Number.isNaN(targetId)) {
      return c.json<ApiResponse>({ success: false, error: 'Invalid user ID' }, 400);
    }

    const { username } = c.req.valid('json');
    const normalized = username.trim();
    if (!AuthUtils.validateUsername(normalized)) {
      return c.json<ApiResponse>({
        success: false,
        error: 'Username must be 3-20 characters, letters, numbers, and underscores only',
      }, 400);
    }

    const currentUser = c.get('user')!; // requireUserActor 已确保 user 存在
    if (targetId === currentUser.id) {
      return c.json<ApiResponse>({
        success: false,
        error: 'Use personal settings to rename your own account',
      }, 400);
    }

    const targetUser = await prisma.user.findUnique({
      where: { id: targetId },
      select: { id: true, username: true, role: true, status: true },
    });
    if (!targetUser) {
      return c.json<ApiResponse>({ success: false, error: 'User not found' }, 404);
    }

    const occupied = await prisma.user.findUnique({
      where: { username: normalized },
      select: { id: true },
    });
    if (occupied && occupied.id !== targetId) {
      return c.json<ApiResponse>({
        success: false,
        error: 'Username already exists',
      }, 409);
    }

    const updated = await prisma.user.update({
      where: { id: targetId },
      data: { username: normalized },
      select: {
        ...basicUserSelect,
      },
    });

    return c.json<ApiResponse>({
      success: true,
      data: updated,
      message: 'Username updated successfully',
    });
  } catch (error) {
    console.error('Update user username error:', error);
    return c.json<ApiResponse>({
      success: false,
      error: 'Failed to update username',
    }, 500);
  }
});

// 更新用户角色 (仅管理员)
users.put('/:id/role', async (c) => {
  try {
    const userId = parseInt(c.req.param('id'));
    const { role } = await c.req.json();

    if (isNaN(userId)) {
      return c.json<ApiResponse>({
        success: false,
        error: 'Invalid user ID',
      }, 400);
    }

    if (!['ADMIN', 'USER'].includes(role)) {
      return c.json<ApiResponse>({
        success: false,
        error: 'Invalid role. Must be ADMIN or USER',
      }, 400);
    }

    const currentUser = c.get('user')!; // requireUserActor 已确保 user 存在

    // 防止管理员修改自己的角色
    if (userId === currentUser.id) {
      return c.json<ApiResponse>({
        success: false,
        error: 'Cannot modify your own role',
      }, 400);
    }

    // 检查是否是最后一个管理员
    if (role === 'USER') {
      const adminCount = await prisma.user.count({
        where: { role: 'ADMIN', status: 'ACTIVE' },
      });

      if (adminCount <= 1) {
        return c.json<ApiResponse>({
          success: false,
          error: 'Cannot change role: at least one admin is required',
        }, 400);
      }
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { role },
      select: {
        ...basicUserSelect,
      },
    });

    return c.json<ApiResponse>({
      success: true,
      data: updatedUser,
      message: 'User role updated successfully',
    });

  } catch (error) {
    console.error('Update user role error:', error);
    return c.json<ApiResponse>({
      success: false,
      error: 'Failed to update user role',
    }, 500);
  }
});

// 审批待注册用户
users.post('/:id/approve', async (c) => {
  try {
    const targetId = parseInt(c.req.param('id'));
    if (Number.isNaN(targetId)) {
      return c.json<ApiResponse>({ success: false, error: 'Invalid user ID' }, 400);
    }

    const currentUser = c.get('user')!;
    const pendingUser = await prisma.user.findUnique({
      where: { id: targetId },
      select: { id: true, status: true, role: true },
    });

    if (!pendingUser) {
      return c.json<ApiResponse>({ success: false, error: 'User not found' }, 404);
    }
    if (pendingUser.status !== 'PENDING') {
      return c.json<ApiResponse>({
        success: false,
        error: 'Only pending users can be approved',
      }, 400);
    }

    const now = new Date();
    const updated = await prisma.user.update({
      where: { id: targetId },
      data: {
        status: 'ACTIVE',
        approvedAt: now,
        approvedById: currentUser.id,
        rejectedAt: null,
        rejectedById: null,
        rejectionReason: null,
      },
      select: {
        ...basicUserSelect,
      },
    });

    return c.json<ApiResponse>({
      success: true,
      data: updated,
      message: 'User approved successfully',
    });
  } catch (error) {
    console.error('Approve user error:', error);
    return c.json<ApiResponse>({
      success: false,
      error: 'Failed to approve user',
    }, 500);
  }
});

// 拒绝待注册用户或将用户标记为禁用（保留记录）
users.post('/:id/reject', zValidator('json', rejectionSchema), async (c) => {
  try {
    const targetId = parseInt(c.req.param('id'));
    if (Number.isNaN(targetId)) {
      return c.json<ApiResponse>({ success: false, error: 'Invalid user ID' }, 400);
    }
    const { reason } = c.req.valid('json');
    const trimmedReason = reason ? reason.trim().slice(0, 200) : '';
    const currentUser = c.get('user')!;

    const targetUser = await prisma.user.findUnique({
      where: { id: targetId },
      select: { id: true, status: true, role: true },
    });
    if (!targetUser) {
      return c.json<ApiResponse>({ success: false, error: 'User not found' }, 404);
    }
    if (targetUser.status !== 'PENDING') {
      return c.json<ApiResponse>({
        success: false,
        error: 'Only pending users can be rejected here',
      }, 400);
    }

    const now = new Date();
    const updated = await prisma.user.update({
      where: { id: targetId },
      data: {
        status: 'DISABLED',
        rejectedAt: now,
        rejectedById: currentUser.id,
        rejectionReason: trimmedReason || null,
      },
      select: {
        ...basicUserSelect,
      },
    });

    return c.json<ApiResponse>({
      success: true,
      data: updated,
      message: 'User request rejected',
    });
  } catch (error) {
    console.error('Reject user error:', error);
    return c.json<ApiResponse>({
      success: false,
      error: 'Failed to reject user',
    }, 500);
  }
});

// 更新非待审核用户状态（启用/禁用）
users.post('/:id/status', zValidator('json', statusUpdateSchema), async (c) => {
  try {
    const targetId = parseInt(c.req.param('id'));
    if (Number.isNaN(targetId)) {
      return c.json<ApiResponse>({ success: false, error: 'Invalid user ID' }, 400);
    }

    const { status, reason } = c.req.valid('json');
    const trimmedReason = reason ? reason.trim().slice(0, 200) : '';
    const currentUser = c.get('user')!;

    const targetUser = await prisma.user.findUnique({
      where: { id: targetId },
      select: { id: true, status: true, role: true },
    });
    if (!targetUser) {
      return c.json<ApiResponse>({ success: false, error: 'User not found' }, 404);
    }

    if (targetUser.status === 'PENDING') {
      return c.json<ApiResponse>({
        success: false,
        error: 'Pending users must be approved or rejected first',
      }, 400);
    }

    if (status === targetUser.status) {
      const unchanged = await prisma.user.findUnique({
        where: { id: targetId },
        select: {
          ...basicUserSelect,
        },
      });
      return c.json<ApiResponse>({
        success: true,
        data: unchanged ?? undefined,
        message: 'User status unchanged',
      });
    }

    if (status === 'DISABLED') {
      if (targetId === currentUser.id) {
        return c.json<ApiResponse>({
          success: false,
          error: 'You cannot disable your own account',
        }, 400);
      }
      if (targetUser.role === 'ADMIN') {
        const activeAdmins = await prisma.user.count({
          where: {
            role: 'ADMIN',
            status: 'ACTIVE',
            id: { not: targetId },
          },
        });
        if (activeAdmins < 1) {
          return c.json<ApiResponse>({
            success: false,
            error: 'At least one active admin is required',
          }, 400);
        }
      }
    }

    const now = new Date();
    const updateData: Prisma.UserUpdateInput = {
      status,
    };

    if (status === 'ACTIVE') {
      updateData.approvedAt = now;
      updateData.approvedById = currentUser.id;
      updateData.rejectedAt = null;
      updateData.rejectedById = null;
      updateData.rejectionReason = null;
    } else {
      updateData.rejectedAt = now;
      updateData.rejectedById = currentUser.id;
      updateData.rejectionReason = trimmedReason || null;
    }

    const updated = await prisma.user.update({
      where: { id: targetId },
      data: updateData,
      select: {
        ...basicUserSelect,
      },
    });

    return c.json<ApiResponse>({
      success: true,
      data: updated,
      message: 'User status updated',
    });
  } catch (error) {
    console.error('Update user status error:', error);
    return c.json<ApiResponse>({
      success: false,
      error: 'Failed to update user status',
    }, 500);
  }
});

users.put('/:id/password', zValidator('json', resetPasswordSchema), async (c) => {
  try {
    const targetId = parseInt(c.req.param('id'));
    if (Number.isNaN(targetId)) {
      return c.json<ApiResponse>({ success: false, error: 'Invalid user ID' }, 400);
    }

    const { password } = c.req.valid('json');
    if (!AuthUtils.validatePassword(password)) {
      return c.json<ApiResponse>({
        success: false,
        error: 'Password must be at least 8 characters with letters and numbers',
      }, 400);
    }

    const currentUser = c.get('user')!; // requireUserActor 已确保 user 存在
    if (targetId === currentUser.id) {
      return c.json<ApiResponse>({
        success: false,
        error: 'Use personal settings to change your own password',
      }, 400);
    }

    const targetUser = await prisma.user.findUnique({ where: { id: targetId }, select: { id: true } });
    if (!targetUser) {
      return c.json<ApiResponse>({ success: false, error: 'User not found' }, 404);
    }

    const hashedPassword = await AuthUtils.hashPassword(password);
    await prisma.user.update({
      where: { id: targetId },
      data: { hashedPassword },
    });

    return c.json<ApiResponse>({
      success: true,
      message: 'Password reset successfully',
    });
  } catch (error) {
    console.error('Reset user password error:', error);
    return c.json<ApiResponse>({
      success: false,
      error: 'Failed to reset password',
    }, 500);
  }
});

// 删除用户 (仅管理员)
users.delete('/:id', async (c) => {
  try {
    const userId = parseInt(c.req.param('id'));

    if (isNaN(userId)) {
      return c.json<ApiResponse>({
        success: false,
        error: 'Invalid user ID',
      }, 400);
    }

    const currentUser = c.get('user')!; // requireUserActor 已确保 user 存在

    // 防止管理员删除自己
    if (userId === currentUser.id) {
      return c.json<ApiResponse>({
        success: false,
        error: 'Cannot delete your own account',
      }, 400);
    }

    // 检查用户是否存在
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });

    if (!user) {
      return c.json<ApiResponse>({
        success: false,
        error: 'User not found',
      }, 404);
    }

    // 检查是否是最后一个管理员
    if (user.role === 'ADMIN') {
      const adminCount = await prisma.user.count({
        where: { role: 'ADMIN', status: 'ACTIVE' },
      });

      if (adminCount <= 1) {
        return c.json<ApiResponse>({
          success: false,
          error: 'Cannot delete user: at least one admin is required',
        }, 400);
      }
    }

    // 删除用户（相关数据会通过Prisma的cascade删除）
    await prisma.user.delete({
      where: { id: userId },
    });

    return c.json<ApiResponse>({
      success: true,
      message: 'User deleted successfully',
    });

  } catch (error) {
    console.error('Delete user error:', error);
    return c.json<ApiResponse>({
      success: false,
      error: 'Failed to delete user',
    }, 500);
  }
});

users.put('/:id/quota', zValidator('json', quotaUpdateSchema), async (c) => {
  try {
    const targetId = parseInt(c.req.param('id'));
    if (Number.isNaN(targetId)) {
      return c.json<ApiResponse>({
        success: false,
        error: 'Invalid user ID',
      }, 400);
    }

    const { dailyLimit, resetUsed } = c.req.valid('json');
    const sanitizedLimit = dailyLimit === null ? null : Math.max(0, dailyLimit);
    const currentUser = c.get('user')!; // requireUserActor 已确保 user 存在

    const targetUser = await prisma.user.findUnique({
      where: { id: targetId },
      select: { id: true, username: true, role: true, status: true },
    });
    if (!targetUser) {
      return c.json<ApiResponse>({ success: false, error: 'User not found' }, 404);
    }

    if (targetUser.id === currentUser.id && sanitizedLimit !== null && sanitizedLimit < 1) {
      return c.json<ApiResponse>({
        success: false,
        error: 'Cannot set your own daily limit below 1 to avoid lock-out',
      }, 400);
    }

    const identifier = `user:${targetUser.id}`;
    const now = new Date();
    const updatePayload: {
      customDailyLimit: number | null;
      userId: number;
      usedCount?: number;
      lastResetAt?: Date;
    } = {
      customDailyLimit: sanitizedLimit,
      userId: targetUser.id,
    };
    if (resetUsed) {
      updatePayload.usedCount = 0;
      updatePayload.lastResetAt = now;
    }

    await prisma.usageQuota.upsert({
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
    });

    const quotaActor: Actor = {
      type: 'user',
      id: targetUser.id,
      username: targetUser.username,
      role: targetUser.role as 'ADMIN' | 'USER',
      identifier,
    };

    const snapshot = await inspectActorQuota(quotaActor);

    return c.json<ApiResponse<{ quota: ReturnType<typeof serializeQuotaSnapshot>; user: typeof targetUser }>>({
      success: true,
      data: {
        user: targetUser,
        quota: serializeQuotaSnapshot(snapshot),
      },
      message: 'User quota updated',
    });
  } catch (error) {
    console.error('Update user quota error:', error);
    return c.json<ApiResponse>({
      success: false,
      error: 'Failed to update user quota',
    }, 500);
  }
});

export default users;
