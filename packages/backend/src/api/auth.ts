import { Hono } from 'hono';
import { setCookie, deleteCookie } from 'hono/cookie';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { prisma } from '../db';
import { AuthUtils } from '../utils/auth';
import { actorMiddleware, requireUserActor } from '../middleware/auth';
import type { AuthResponse, RegisterResponse, ApiResponse, ActorContext, Actor } from '../types';
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

    // 首个用户始终允许注册；其余用户受系统设置控制
    const existingUsers = await prisma.user.count();
    if (existingUsers > 0) {
      const registrationSetting = await prisma.systemSetting.findUnique({
        where: { key: 'registration_enabled' },
      });
      const registrationEnabled = registrationSetting?.value !== 'false';
      if (!registrationEnabled) {
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

    // 创建用户，首个注册者成为管理员并立即激活，其余用户需管理员审批
    const role = existingUsers === 0 ? 'ADMIN' : 'USER';
    const status = existingUsers === 0 ? 'ACTIVE' : 'PENDING';
    const now = new Date();

    const user = await prisma.user.create({
      data: {
        username,
        hashedPassword,
        role,
        status,
        approvedAt: status === 'ACTIVE' ? now : null,
      },
    });

    if (status === 'ACTIVE') {
      const token = AuthUtils.generateToken({
        userId: user.id,
        username: user.username,
        role: user.role,
      });

      const registerResponse: RegisterResponse = {
        user: {
          id: user.id,
          username: user.username,
          role: user.role as 'ADMIN' | 'USER',
          status: user.status as 'PENDING' | 'ACTIVE' | 'DISABLED',
        },
        token,
      };

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

      return c.json<ApiResponse<RegisterResponse>>({
        success: true,
        data: registerResponse,
        message: 'Registration successful',
      });
    }

    const registerResponse: RegisterResponse = {
      user: {
        id: user.id,
        username: user.username,
        role: user.role as 'ADMIN' | 'USER',
        status: user.status as 'PENDING' | 'ACTIVE' | 'DISABLED',
      },
    };

    return c.json<ApiResponse<RegisterResponse>>({
      success: true,
      data: registerResponse,
      message: 'Registration submitted. Await admin approval.',
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
      select: {
        id: true,
        username: true,
        hashedPassword: true,
        role: true,
        status: true,
        rejectionReason: true,
      },
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

    if (user.status !== 'ACTIVE') {
      const locked = user.status === 'PENDING';
      const reason = locked ? 'Account pending approval' : 'Account has been disabled';
      const response: ApiResponse<{ status: typeof user.status; rejectionReason?: string }> = {
        success: false,
        error: reason,
        data: {
          status: user.status,
          rejectionReason: user.rejectionReason ?? undefined,
        },
      };
      return c.json(response, locked ? 423 : 403);
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
        status: user.status as 'PENDING' | 'ACTIVE' | 'DISABLED',
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

    let preference: { modelId: string | null; connectionId: number | null; rawId: string | null } | null = null;

    if (actor.type === 'user') {
      const profile = await prisma.user.findUnique({
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
        },
      });
      if (profile) {
        userProfile = {
          ...profile,
          role: profile.role === 'ADMIN' ? 'ADMIN' : 'USER',
          status: profile.status as 'PENDING' | 'ACTIVE' | 'DISABLED',
        };
        preference = {
          modelId: profile.preferredModelId ?? null,
          connectionId: profile.preferredConnectionId ?? null,
          rawId: profile.preferredModelRawId ?? null,
        };
      }
    }

    return c.json<ApiResponse<ActorContext>>({
      success: true,
      data: {
        actor,
        quota: serializeQuotaSnapshot(quota),
        user: userProfile,
        preferredModel: actor.type === 'user'
          ? {
              modelId: actor.preferredModel?.modelId ?? preference?.modelId ?? null,
              connectionId: actor.preferredModel?.connectionId ?? preference?.connectionId ?? null,
              rawId: actor.preferredModel?.rawId ?? preference?.rawId ?? null,
            }
          : null,
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
  const user = c.get('user')!; // requireUserActor 已确保 user 存在

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
    const user = c.get('user')!; // requireUserActor 已确保 user 存在
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
      select: { id: true, username: true, role: true, status: true },
    });
    const normalised: { id: number; username: string; role: 'ADMIN' | 'USER'; status: 'PENDING' | 'ACTIVE' | 'DISABLED' } | null = refreshed
      ? {
          id: refreshed.id,
          username: refreshed.username,
          role: refreshed.role === 'ADMIN' ? 'ADMIN' : 'USER',
          status: refreshed.status as 'PENDING' | 'ACTIVE' | 'DISABLED',
        }
      : null;
    if (normalised) {
      c.set('user', normalised);
    }

    return c.json<ApiResponse<{ user: { id: number; username: string; role: 'ADMIN' | 'USER'; status: 'PENDING' | 'ACTIVE' | 'DISABLED' } }>>({
      success: true,
      data: normalised ? { user: normalised } : undefined,
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
