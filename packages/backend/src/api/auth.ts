import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { prisma } from '../db';
import { AuthUtils } from '../utils/auth';
import { authMiddleware, adminOnlyMiddleware } from '../middleware/auth';
import type { AuthResponse, ApiResponse } from '../types';

const auth = new Hono();

// 注册schema
const registerSchema = z.object({
  username: z.string().min(3).max(20),
  password: z.string().min(8),
});

// 登录schema
const loginSchema = z.object({
  username: z.string(),
  password: z.string(),
});

// 用户注册
auth.post('/register', zValidator('json', registerSchema), async (c) => {
  try {
    const { username, password } = c.req.valid('json');

    // 验证输入格式
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

    // 检查是否开启注册
    const appMode = process.env.APP_MODE || 'single';
    if (appMode === 'single') {
      const existingUser = await prisma.user.findFirst();
      if (existingUser) {
        return c.json<ApiResponse>({
          success: false,
          error: 'Registration is disabled in single user mode',
        }, 403);
      }
    } else {
      // 多用户模式检查系统设置
      const registrationEnabled = await prisma.systemSetting.findUnique({
        where: { key: 'registration_enabled' },
      });

      if (registrationEnabled?.value !== 'true') {
        return c.json<ApiResponse>({
          success: false,
          error: 'Registration is currently disabled',
        }, 403);
      }
    }

    // 检查用户名是否已存在
    const existingUser = await prisma.user.findUnique({
      where: { username },
    });

    if (existingUser) {
      return c.json<ApiResponse>({
        success: false,
        error: 'Username already exists',
      }, 409);
    }

    // 哈希密码
    const hashedPassword = await AuthUtils.hashPassword(password);

    // 确定用户角色
    const userCount = await prisma.user.count();
    const role = userCount === 0 ? 'ADMIN' : 'USER';

    // 创建用户
    const user = await prisma.user.create({
      data: {
        username,
        hashedPassword,
        role,
      },
    });

    // 生成JWT
    const token = AuthUtils.generateToken({
      userId: user.id,
      username: user.username,
      role: user.role,
    });

    const response: AuthResponse = {
      user: {
        id: user.id,
        username: user.username,
        role: user.role as 'ADMIN' | 'USER',
      },
      token,
    };

    return c.json<ApiResponse<AuthResponse>>({
      success: true,
      data: response,
      message: 'Registration successful',
    });

  } catch (error) {
    console.error('Registration error:', error);
    return c.json<ApiResponse>({
      success: false,
      error: 'Registration failed',
    }, 500);
  }
});

// 用户登录
auth.post('/login', zValidator('json', loginSchema), async (c) => {
  try {
    const { username, password } = c.req.valid('json');

    // 查找用户
    const user = await prisma.user.findUnique({
      where: { username },
    });

    if (!user) {
      return c.json<ApiResponse>({
        success: false,
        error: 'Invalid username or password',
      }, 401);
    }

    // 验证密码
    const isValidPassword = await AuthUtils.verifyPassword(password, user.hashedPassword);
    if (!isValidPassword) {
      return c.json<ApiResponse>({
        success: false,
        error: 'Invalid username or password',
      }, 401);
    }

    // 生成JWT
    const token = AuthUtils.generateToken({
      userId: user.id,
      username: user.username,
      role: user.role,
    });

    const response: AuthResponse = {
      user: {
        id: user.id,
        username: user.username,
        role: user.role as 'ADMIN' | 'USER',
      },
      token,
    };

    return c.json<ApiResponse<AuthResponse>>({
      success: true,
      data: response,
      message: 'Login successful',
    });

  } catch (error) {
    console.error('Login error:', error);
    return c.json<ApiResponse>({
      success: false,
      error: 'Login failed',
    }, 500);
  }
});

// 获取当前用户信息
auth.get('/me', authMiddleware, async (c) => {
  const user = c.get('user');

  return c.json<ApiResponse>({
    success: true,
    data: user,
  });
});

// 更新用户密码
auth.put('/password', authMiddleware, zValidator('json', z.object({
  currentPassword: z.string(),
  newPassword: z.string().min(8),
})), async (c) => {
  try {
    const user = c.get('user');
    const { currentPassword, newPassword } = c.req.valid('json');

    if (!AuthUtils.validatePassword(newPassword)) {
      return c.json<ApiResponse>({
        success: false,
        error: 'New password must be at least 8 characters with letters and numbers',
      }, 400);
    }

    // 获取完整用户信息包括密码
    const fullUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: { hashedPassword: true },
    });

    if (!fullUser) {
      return c.json<ApiResponse>({
        success: false,
        error: 'User not found',
      }, 404);
    }

    // 验证当前密码
    const isValidCurrentPassword = await AuthUtils.verifyPassword(currentPassword, fullUser.hashedPassword);
    if (!isValidCurrentPassword) {
      return c.json<ApiResponse>({
        success: false,
        error: 'Current password is incorrect',
      }, 401);
    }

    // 更新密码
    const hashedNewPassword = await AuthUtils.hashPassword(newPassword);
    await prisma.user.update({
      where: { id: user.id },
      data: { hashedPassword: hashedNewPassword },
    });

    return c.json<ApiResponse>({
      success: true,
      message: 'Password updated successfully',
    });

  } catch (error) {
    console.error('Password update error:', error);
    return c.json<ApiResponse>({
      success: false,
      error: 'Password update failed',
    }, 500);
  }
});

export default auth;