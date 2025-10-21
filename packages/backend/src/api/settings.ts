import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { prisma } from '../db';
import { authMiddleware, adminOnlyMiddleware } from '../middleware/auth';
import type { ApiResponse } from '../types';

const settings = new Hono();

// 系统设置schema（允许部分字段更新）
const systemSettingSchema = z.object({
  registration_enabled: z.boolean().optional(),
  // 文字LOGO，最多40字符
  brand_text: z.string().min(1).max(40).optional(),
  // 流式/稳定性相关配置
  sse_heartbeat_interval_ms: z.number().int().min(1000).max(600000).optional(),
  provider_max_idle_ms: z.number().int().min(0).max(3600000).optional(),
  provider_timeout_ms: z.number().int().min(10000).max(3600000).optional(),
  usage_emit: z.boolean().optional(),
  usage_provider_only: z.boolean().optional(),
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
    const settingsObj = systemSettings.reduce((acc: Record<string, string>, setting: { key: string; value: string }) => {
      acc[setting.key] = setting.value;
      return acc;
    }, {} as Record<string, string>);

    // 转换布尔值
    const formattedSettings = {
      registration_enabled: settingsObj.registration_enabled === 'true',
      app_mode: settingsObj.app_mode || 'single',
      max_context_tokens: parseInt(settingsObj.max_context_tokens || '4000'),
      brand_text: settingsObj.brand_text || 'AIChat',
      // 流式/稳定性（若DB无配置，则回退到环境变量或默认值）
      sse_heartbeat_interval_ms: parseInt(settingsObj.sse_heartbeat_interval_ms || process.env.SSE_HEARTBEAT_INTERVAL_MS || '15000'),
      provider_max_idle_ms: parseInt(settingsObj.provider_max_idle_ms || process.env.PROVIDER_MAX_IDLE_MS || '60000'),
      provider_timeout_ms: parseInt(settingsObj.provider_timeout_ms || process.env.PROVIDER_TIMEOUT_MS || '300000'),
      usage_emit: (settingsObj.usage_emit ?? (process.env.USAGE_EMIT ?? 'true')).toString().toLowerCase() !== 'false',
      usage_provider_only: (settingsObj.usage_provider_only ?? (process.env.USAGE_PROVIDER_ONLY ?? 'false')).toString().toLowerCase() === 'true',
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
    const { registration_enabled, brand_text, sse_heartbeat_interval_ms, provider_max_idle_ms, provider_timeout_ms, usage_emit, usage_provider_only } = c.req.valid('json');

    // 条件更新：仅对传入的字段做 upsert
    if (typeof registration_enabled === 'boolean') {
      await prisma.systemSetting.upsert({
        where: { key: 'registration_enabled' },
        update: { value: registration_enabled.toString() },
        create: { key: 'registration_enabled', value: registration_enabled.toString() },
      });
    }

    if (typeof brand_text === 'string') {
      await prisma.systemSetting.upsert({
        where: { key: 'brand_text' },
        update: { value: brand_text },
        create: { key: 'brand_text', value: brand_text },
      });
    }

    // 以下为流式/稳定性配置（仅对传入字段进行 upsert）
    if (typeof sse_heartbeat_interval_ms === 'number') {
      await prisma.systemSetting.upsert({
        where: { key: 'sse_heartbeat_interval_ms' },
        update: { value: String(sse_heartbeat_interval_ms) },
        create: { key: 'sse_heartbeat_interval_ms', value: String(sse_heartbeat_interval_ms) },
      });
    }

    if (typeof provider_max_idle_ms === 'number') {
      await prisma.systemSetting.upsert({
        where: { key: 'provider_max_idle_ms' },
        update: { value: String(provider_max_idle_ms) },
        create: { key: 'provider_max_idle_ms', value: String(provider_max_idle_ms) },
      });
    }

    if (typeof provider_timeout_ms === 'number') {
      await prisma.systemSetting.upsert({
        where: { key: 'provider_timeout_ms' },
        update: { value: String(provider_timeout_ms) },
        create: { key: 'provider_timeout_ms', value: String(provider_timeout_ms) },
      });
    }

    if (typeof usage_emit === 'boolean') {
      await prisma.systemSetting.upsert({
        where: { key: 'usage_emit' },
        update: { value: usage_emit.toString() },
        create: { key: 'usage_emit', value: usage_emit.toString() },
      });
    }

    if (typeof usage_provider_only === 'boolean') {
      await prisma.systemSetting.upsert({
        where: { key: 'usage_provider_only' },
        update: { value: usage_provider_only.toString() },
        create: { key: 'usage_provider_only', value: usage_provider_only.toString() },
      });
    }

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
