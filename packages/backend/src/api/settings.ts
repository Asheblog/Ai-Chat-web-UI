import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { prisma } from '../db';
import { authMiddleware, adminOnlyMiddleware } from '../middleware/auth';
import type { ApiResponse } from '../types';

const settings = new Hono();

// 系统设置schema
const systemSettingSchema = z.object({
  registration_enabled: z.boolean(),
});

// 获取系统设置（仅管理员）
settings.get('/system', authMiddleware, adminOnlyMiddleware, async (c) => {
  try {
    const systemSettings = await prisma.systemSetting.findMany({
      select: {
        key: true,
        value: true,
      },
    });

    // 转换为键值对对象
    const settingsObj = systemSettings.reduce((acc, setting) => {
      acc[setting.key] = setting.value;
      return acc;
    }, {} as Record<string, string>);

    // 转换布尔值
    const formattedSettings = {
      registration_enabled: settingsObj.registration_enabled === 'true',
      app_mode: settingsObj.app_mode || 'single',
      max_context_tokens: parseInt(settingsObj.max_context_tokens || '4000'),
    };

    return c.json<ApiResponse>({
      success: true,
      data: formattedSettings,
    });

  } catch (error) {
    console.error('Get system settings error:', error);
    return c.json<ApiResponse>({
      success: false,
      error: 'Failed to fetch system settings',
    }, 500);
  }
});

// 更新系统设置（仅管理员）
settings.put('/system', authMiddleware, adminOnlyMiddleware, zValidator('json', systemSettingSchema), async (c) => {
  try {
    const { registration_enabled } = c.req.valid('json');

    // 更新设置
    await prisma.systemSetting.upsert({
      where: { key: 'registration_enabled' },
      update: { value: registration_enabled.toString() },
      create: {
        key: 'registration_enabled',
        value: registration_enabled.toString(),
      },
    });

    return c.json<ApiResponse>({
      success: true,
      message: 'System settings updated successfully',
    });

  } catch (error) {
    console.error('Update system settings error:', error);
    return c.json<ApiResponse>({
      success: false,
      error: 'Failed to update system settings',
    }, 500);
  }
});

// 获取用户个人设置
settings.get('/personal', authMiddleware, async (c) => {
  try {
    const user = c.get('user');

    // 获取用户的个人设置（目前使用默认值，可扩展）
    const personalSettings = {
      context_token_limit: parseInt(process.env.DEFAULT_CONTEXT_TOKEN_LIMIT || '4000'),
      theme: 'light', // 可扩展主题设置
    };

    return c.json<ApiResponse>({
      success: true,
      data: personalSettings,
    });

  } catch (error) {
    console.error('Get personal settings error:', error);
    return c.json<ApiResponse>({
      success: false,
      error: 'Failed to fetch personal settings',
    }, 500);
  }
});

// 更新用户个人设置
settings.put('/personal', authMiddleware, zValidator('json', z.object({
  context_token_limit: z.number().int().min(1000).max(32000).optional(),
  theme: z.enum(['light', 'dark']).optional(),
})), async (c) => {
  try {
    const user = c.get('user');
    const updateData = c.req.valid('json');

    // 这里可以扩展为存储用户个人设置到数据库
    // 目前返回成功响应
    return c.json<ApiResponse>({
      success: true,
      data: updateData,
      message: 'Personal settings updated successfully',
    });

  } catch (error) {
    console.error('Update personal settings error:', error);
    return c.json<ApiResponse>({
      success: false,
      error: 'Failed to update personal settings',
    }, 500);
  }
});

// 获取应用信息
settings.get('/app-info', async (c) => {
  try {
    const appInfo = {
      name: 'AI Chat Platform',
      version: '1.0.0',
      mode: process.env.APP_MODE || 'single',
      features: {
        registration: process.env.APP_MODE === 'multi',
        streaming: true,
        file_upload: false, // 未来功能
        long_term_memory: false, // 未来功能
      },
    };

    return c.json<ApiResponse>({
      success: true,
      data: appInfo,
    });

  } catch (error) {
    console.error('Get app info error:', error);
    return c.json<ApiResponse>({
      success: false,
      error: 'Failed to fetch app information',
    }, 500);
  }
});

// 健康检查接口
settings.get('/health', async (c) => {
  try {
    // 检查数据库连接
    await prisma.$queryRaw`SELECT 1`;

    const healthInfo = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      database: 'connected',
      memory: process.memoryUsage(),
    };

    return c.json<ApiResponse>({
      success: true,
      data: healthInfo,
    });

  } catch (error) {
    console.error('Health check error:', error);

    const healthInfo = {
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Unknown error',
    };

    return c.json<ApiResponse>({
      success: false,
      data: healthInfo,
      error: 'Service is unhealthy',
    }, 503);
  }
});

export default settings;