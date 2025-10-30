import { Hono } from 'hono';
import { prisma } from '../db';
import { actorMiddleware, requireUserActor, adminOnlyMiddleware } from '../middleware/auth';
import type { ApiResponse } from '../types';

const users = new Hono();

users.use('*', actorMiddleware, requireUserActor, adminOnlyMiddleware)

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

export default users;
