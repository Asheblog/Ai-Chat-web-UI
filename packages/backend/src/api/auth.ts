import { Hono } from 'hono';
import { setCookie, deleteCookie } from 'hono/cookie';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { prisma } from '../db';
import { AuthUtils } from '../utils/auth';
import { actorMiddleware, requireUserActor } from '../middleware/auth';
import type { AuthResponse, ApiResponse, ActorContext, Actor } from '../types';
import { inspectActorQuota, serializeQuotaSnapshot } from '../utils/quota';

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

  // 设置 HttpOnly Cookie，便于前端同域请求时由浏览器自动携带
  try {
    const secure = (process.env.COOKIE_SECURE ?? '').toLowerCase() === 'true' || (process.env.NODE_ENV === 'production');
    setCookie(c, 'token', token, {
      httpOnly: true,
      secure,
      sameSite: 'Lax',
      path: '/',
      maxAge: 24 * 60 * 60, // 与 JWT 过期一致（24h）
    });
  } catch {}

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

  // 设置 HttpOnly Cookie
  try {
    const secure = (process.env.COOKIE_SECURE ?? '').toLowerCase() === 'true' || (process.env.NODE_ENV === 'production');
    setCookie(c, 'token', token, {
      httpOnly: true,
      secure,
      sameSite: 'Lax',
      path: '/',
      maxAge: 24 * 60 * 60,
    });
  } catch {}

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

auth.get('/actor', actorMiddleware, async (c) => {
  const actor = c.get('actor') as Actor | undefined;
  if (!actor) {
    return c.json<ApiResponse>({
      success: false,
      error: 'Actor unavailable',
    }, 401);
  }

  try {
    const quota = await inspectActorQuota(actor);
    let userProfile: ActorContext['user'] = null;

    if (actor.type === 'user') {
      const profile = await prisma.user.findUnique({
        where: { id: actor.id },
        select: { id: true, username: true, role: true, createdAt: true },
      });
      if (profile) {
        userProfile = profile;
      }
    }

    return c.json<ApiResponse<ActorContext>>({
      success: true,
      data: {
        actor,
        quota: serializeQuotaSnapshot(quota),
        user: userProfile,
      },
    });
  } catch (error) {
    console.error('Resolve actor context error:', error);
    return c.json<ApiResponse>({
      success: false,
      error: 'Failed to resolve actor context',
    }, 500);
  }
});

// 获取当前用户信息
auth.get('/me', actorMiddleware, requireUserActor, async (c) => {
  const user = c.get('user');

  return c.json<ApiResponse>({
    success: true,
    data: user,
  });
});

// 更新用户密码
auth.put('/password', actorMiddleware, requireUserActor, zValidator('json', z.object({
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

    const refreshed = await prisma.user.findUnique({
      where: { id: user.id },
      select: { id: true, username: true, role: true },
    });
    if (refreshed) {
      c.set('user', refreshed as any);
    }

    return c.json<ApiResponse<{ user: { id: number; username: string; role: string } }>>({
      success: true,
      data: refreshed ? { user: refreshed } : undefined,
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

// 新增：登出接口（清除 Cookie）
auth.post('/logout', async (c) => {
  try {
    deleteCookie(c, 'token', { path: '/' });
  } catch {}
  return c.json<ApiResponse>({ success: true, message: 'Logged out' });
});
