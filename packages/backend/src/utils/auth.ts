import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import CryptoJS from 'crypto-js';
import type { JWTPayload, AuthPayload } from '../types';

const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-key';
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'aichat-encryption-key-2025';

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
    const jwtPayload: JWTPayload = {
      userId: payload.userId,
      username: payload.username,
      role: payload.role,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60), // 24小时过期
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

  // 加密API Key
  static encryptApiKey(apiKey: string): string {
    return CryptoJS.AES.encrypt(apiKey, ENCRYPTION_KEY).toString();
  }

  // 解密API Key
  static decryptApiKey(encryptedApiKey: string): string {
    const bytes = CryptoJS.AES.decrypt(encryptedApiKey, ENCRYPTION_KEY);
    return bytes.toString(CryptoJS.enc.Utf8);
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