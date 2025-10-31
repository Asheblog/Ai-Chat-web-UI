import { Hono } from 'hono';
import { z } from 'zod';
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
})

const updateUsernameSchema = z.object({
  username: z.string().min(3).max(20),
})

const resetPasswordSchema = z.object({
  password: z.string().min(8),
})

users.post('/', zValidator('json', createUserSchema), async (c) => {
  try {
    const payload = c.req.valid('json');
    const username = payload.username.trim();
    const password = payload.password;
    const role = payload.role ?? 'USER';

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
    const newUser = await prisma.user.create({
      data: {
        username,
        hashedPassword,
        role,
      },
      select: {
        id: true,
        username: true,
        role: true,
        createdAt: true,
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

    const where = search ? {
      username: {
        contains: search,
      },
    } : {};

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true,
          username: true,
          role: true,
          createdAt: true,
          _count: {
            select: {
              chatSessions: true,
              connections: true,
            },
          },
        },
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
      select: {
        id: true,
        username: true,
        role: true,
        createdAt: true,
        _count: {
          select: {
            chatSessions: true,
            connections: true,
          },
        },
      },
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

    const currentUser = c.get('user');
    if (targetId === currentUser.id) {
      return c.json<ApiResponse>({
        success: false,
        error: 'Use personal settings to rename your own account',
      }, 400);
    }

    const targetUser = await prisma.user.findUnique({
      where: { id: targetId },
      select: { id: true, username: true, role: true },
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
      select: { id: true, username: true, role: true, createdAt: true },
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

    const currentUser = c.get('user');

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
        where: { role: 'ADMIN' },
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
        id: true,
        username: true,
        role: true,
        createdAt: true,
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

    const currentUser = c.get('user');
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

    const currentUser = c.get('user');

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
        where: { role: 'ADMIN' },
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
    const currentUser = c.get('user');

    const targetUser = await prisma.user.findUnique({
      where: { id: targetId },
      select: { id: true, username: true, role: true },
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
