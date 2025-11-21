import { Hono } from 'hono';
import { setCookie, deleteCookie } from 'hono/cookie';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { actorMiddleware, requireUserActor } from '../middleware/auth';
import type { AuthResponse, RegisterResponse, ApiResponse, ActorContext, Actor } from '../types';
import { serializeQuotaSnapshot } from '../utils/quota';
import { authService, AuthServiceError } from '../services/auth/auth-service';
import { getAppConfig } from '../config/app-config';

const auth = new Hono();
const appConfig = getAppConfig();

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
    const result = await authService.register({ username, password });

    if (result.token) {
      try {
        const secure = appConfig.server.cookieSecure;
        setCookie(c, 'token', result.token, {
          httpOnly: true,
          secure,
          sameSite: 'Lax',
          path: '/',
          maxAge: 24 * 60 * 60,
        });
      } catch {}
    }

    const registerResponse: RegisterResponse = {
      user: {
        id: result.user.id,
        username: result.user.username,
        role: result.user.role,
        status: result.user.status,
        avatarUrl: result.user.avatarUrl ?? null,
      },
      ...(result.token ? { token: result.token } : {}),
    };

    return c.json<ApiResponse<RegisterResponse>>({
      success: true,
      data: registerResponse,
      message: result.token ? 'Registration successful' : 'Registration submitted. Await admin approval.',
    });
  } catch (error) {
    if (error instanceof AuthServiceError) {
      return c.json<ApiResponse>({ success: false, error: error.message }, error.statusCode);
    }
    console.error('Registration error:', error);
    return c.json<ApiResponse>({ success: false, error: 'Registration failed' }, 500);
  }
});

// 用户登录
auth.post('/login', zValidator('json', loginSchema), async (c) => {
  try {
    const { username, password } = c.req.valid('json');
    const result = await authService.login({ username, password, request: c.req.raw });

    try {
      const secure = appConfig.server.cookieSecure;
      setCookie(c, 'token', result.token, {
        httpOnly: true,
        secure,
        sameSite: 'Lax',
        path: '/',
        maxAge: 24 * 60 * 60,
      });
    } catch {}

    const response: AuthResponse = {
      user: {
        id: result.user.id,
        username: result.user.username,
        role: result.user.role,
        status: result.user.status,
        avatarUrl: result.user.avatarUrl ?? null,
      },
      token: result.token,
    };

    return c.json<ApiResponse<AuthResponse>>({
      success: true,
      data: response,
      message: 'Login successful',
    });
  } catch (error) {
    if (error instanceof AuthServiceError) {
      const payload: ApiResponse = { success: false, error: error.message }
      if (error.details) {
        payload.data = error.details as any
      }
      return c.json(payload, error.statusCode);
    }
    console.error('Login error:', error);
    return c.json<ApiResponse>({ success: false, error: 'Login failed' }, 500);
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
    const context = await authService.resolveActorContext(actor, c.req.raw);
    const preferredModel =
      actor.type === 'user'
        ? actor.preferredModel ?? context.preferredModel ?? null
        : null;

    return c.json<ApiResponse<ActorContext>>({
      success: true,
      data: {
        actor: context.actor,
        quota: context.quota ? serializeQuotaSnapshot(context.quota) : null,
        user: context.user,
        preferredModel,
        assistantAvatarUrl: context.assistantAvatarUrl,
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
    const result = await authService.updatePassword({
      userId: user.id,
      currentPassword,
      newPassword,
    });
    c.set('user', result.user);
    return c.json<ApiResponse<{ user: typeof result.user }>>({
      success: true,
      data: { user: result.user },
      message: 'Password updated successfully',
    });
  } catch (error) {
    if (error instanceof AuthServiceError) {
      return c.json<ApiResponse>({ success: false, error: error.message }, error.statusCode);
    }
    console.error('Password update error:', error);
    return c.json<ApiResponse>({ success: false, error: 'Password update failed' }, 500);
  }
});

// 新增：登出接口（清除 Cookie）
auth.post('/logout', async (c) => {
  try {
    deleteCookie(c, 'token', { path: '/' });
  } catch {}
  return c.json<ApiResponse>({ success: true, message: 'Logged out' });
});

export default auth;
