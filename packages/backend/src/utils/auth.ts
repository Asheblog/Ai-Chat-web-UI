import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { JWTPayload, AuthPayload } from '../types';

const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-key';

const DEFAULT_TOKEN_TTL_SECONDS = 24 * 60 * 60;
const MIN_TOKEN_TTL_SECONDS = 60;
const MAX_TOKEN_TTL_SECONDS = 365 * 24 * 60 * 60;

/** 登录态有效期（秒）：由 JWT_TTL_SECONDS 覆盖，非法值回落 24h */
export const resolveTokenTtlSeconds = (raw?: string | null): number => {
  const parsed = Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_TOKEN_TTL_SECONDS;
  return Math.min(Math.max(parsed, MIN_TOKEN_TTL_SECONDS), MAX_TOKEN_TTL_SECONDS);
};

export const AUTH_TOKEN_TTL_SECONDS = resolveTokenTtlSeconds(process.env.JWT_TTL_SECONDS);
/** 剩余寿命不足一半即滑动续期，避免每个请求都重签 Cookie */
export const AUTH_TOKEN_RENEW_REMAINING_SECONDS = Math.floor(AUTH_TOKEN_TTL_SECONDS / 2);
export const AUTH_TOKEN_COOKIE = 'token';

export interface AuthTokenCookieOptions {
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'Lax';
  path: string;
  maxAge: number;
}

export const buildAuthTokenCookieOptions = (
  secure: boolean,
  maxAge: number = AUTH_TOKEN_TTL_SECONDS,
): AuthTokenCookieOptions => ({
  httpOnly: true,
  secure,
  sameSite: 'Lax',
  path: '/',
  maxAge,
});

/**
 * 是否需要重签令牌（滑动续期判据）：
 * - 有 exp：剩余寿命 <= 半个 TTL 就续（调大 TTL 后旧令牌会立刻升级）
 * - 只有 iat：已存活超过半个 TTL 就续
 * - 两者都没有：直接续
 */
export const shouldRenewAuthToken = (
  payload: Pick<JWTPayload, 'iat' | 'exp'> | null | undefined,
  nowSeconds: number = Math.floor(Date.now() / 1000),
  ttlSeconds: number = AUTH_TOKEN_TTL_SECONDS,
): boolean => {
  const renewRemainingSeconds = Math.floor(ttlSeconds / 2);
  const exp = payload?.exp;
  if (typeof exp === 'number' && Number.isFinite(exp)) {
    return exp - nowSeconds <= renewRemainingSeconds;
  }
  const iat = payload?.iat;
  if (typeof iat === 'number' && Number.isFinite(iat)) {
    return nowSeconds - iat >= renewRemainingSeconds;
  }
  return true;
};

export class AuthUtils {
  // 密码哈希
  static async hashPassword(password: string): Promise<string> {
    const saltRounds = 12;
    return bcrypt.hash(password, saltRounds);
  }

  // 验证密码
  static async verifyPassword(password: string, hashedPassword: string): Promise<boolean> {
    return bcrypt.compare(password, hashedPassword);
  }

  // 生成JWT Token
  static generateToken(payload: AuthPayload): string {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const jwtPayload: JWTPayload = {
      userId: payload.userId,
      username: payload.username,
      role: payload.role,
      iat: nowSeconds,
      exp: nowSeconds + AUTH_TOKEN_TTL_SECONDS,
    };

    return jwt.sign(jwtPayload, JWT_SECRET);
  }

  // 验证JWT Token
  static verifyToken(token: string): JWTPayload | null {
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as JWTPayload;
      return decoded;
    } catch (error) {
      console.error('JWT verification failed:', error);
      return null;
    }
  }

  // 从Authorization header中提取token
  static extractTokenFromHeader(authHeader?: string): string | null {
    if (!authHeader) return null;

    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      return null;
    }

    return parts[1];
  }

  // 验证用户名格式
  static validateUsername(username: string): boolean {
    // 用户名长度3-20字符，只能包含字母、数字、下划线
    const usernameRegex = /^[a-zA-Z0-9_]{3,20}$/;
    return usernameRegex.test(username);
  }

  // 验证密码强度
  static validatePassword(password: string): boolean {
    // 密码长度至少8字符，包含字母和数字
    return password.length >= 8 && /[a-zA-Z]/.test(password) && /[0-9]/.test(password);
  }

  // 验证URL格式
  static validateUrl(url: string): boolean {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }
}
