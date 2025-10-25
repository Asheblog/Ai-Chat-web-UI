import { Context, Next } from 'hono';
import { getCookie, deleteCookie } from 'hono/cookie';
import { AuthUtils } from '../utils/auth';
import { prisma } from '../db';
import type { JWTPayload } from '../types';

// 扩展Hono Context类型
declare module 'hono' {
  interface ContextVariableMap {
    user: {
      id: number;
      username: string;
      role: string;
    };
  }
}

export const authMiddleware = async (c: Context, next: Next) => {
  const authHeader = c.req.header('Authorization');
  let token = AuthUtils.extractTokenFromHeader(authHeader);
  // 兼容基于 Cookie 的会话：优先 Header，其次 Cookie
  if (!token) {
    try { token = getCookie(c, 'token') || null } catch { token = null }
  }

  if (!token) {
    try { deleteCookie(c, 'token', { path: '/' }) } catch {}
    return c.json({
      success: false,
      error: 'Missing or invalid authorization header',
    }, 401);
  }

  const payload = AuthUtils.verifyToken(token);
  if (!payload) {
    try { deleteCookie(c, 'token', { path: '/' }) } catch {}
    return c.json({
      success: false,
      error: 'Invalid or expired token',
    }, 401);
  }

  // 验证用户是否仍然存在
  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: { id: true, username: true, role: true },
  });

  if (!user) {
    return c.json({
      success: false,
      error: 'User not found',
    }, 401);
  }

  // 将用户信息添加到上下文
  c.set('user', user);

  await next();
};

// 管理员权限中间件
export const adminOnlyMiddleware = async (c: Context, next: Next) => {
  const user = c.get('user');

  if (!user || user.role !== 'ADMIN') {
    return c.json({
      success: false,
      error: 'Admin access required',
    }, 403);
  }

  await next();
};

// 可选认证中间件（某些接口可以选择性认证）
export const optionalAuthMiddleware = async (c: Context, next: Next) => {
  const authHeader = c.req.header('Authorization');
  let token = AuthUtils.extractTokenFromHeader(authHeader);
  if (!token) {
    try { token = getCookie(c, 'token') || null } catch { token = null }
  }

  if (token) {
    const payload = AuthUtils.verifyToken(token);
    if (payload) {
      const user = await prisma.user.findUnique({
        where: { id: payload.userId },
        select: { id: true, username: true, role: true },
      });

      if (user) {
        c.set('user', user);
      }
    }
  }

  await next();
};
