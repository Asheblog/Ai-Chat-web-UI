import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { prisma } from '../db';
import { actorMiddleware, requireUserActor, adminOnlyMiddleware } from '../middleware/auth';
import type { ApiResponse, Actor } from '../types';
import { CHAT_IMAGE_DEFAULT_RETENTION_DAYS } from '../config/storage';
import { getQuotaPolicy, invalidateQuotaPolicyCache } from '../utils/system-settings';
import { syncSharedAnonymousQuota } from '../utils/quota';

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
  provider_initial_grace_ms: z.number().int().min(0).max(3600000).optional(),
  provider_reasoning_idle_ms: z.number().int().min(0).max(3600000).optional(),
  reasoning_keepalive_interval_ms: z.number().int().min(0).max(3600000).optional(),
  usage_emit: z.boolean().optional(),
  usage_provider_only: z.boolean().optional(),
  // 推理链（思维链）相关
  reasoning_enabled: z.boolean().optional(),
  reasoning_default_expand: z.boolean().optional(),
  reasoning_save_to_db: z.boolean().optional(),
  reasoning_tags_mode: z.enum(['default', 'custom', 'off']).optional(),
  // JSON 字符串，如 ["<think>", "</think>"]
  reasoning_custom_tags: z.string().optional(),
  // 服务端流分片大小（可选）
  stream_delta_chunk_size: z.number().int().min(1).max(100).optional(),
  // 供应商参数（可选）
  openai_reasoning_effort: z.enum(['low', 'medium', 'high']).optional(),
  ollama_think: z.boolean().optional(),
  chat_image_retention_days: z.number().int().min(0).max(3650).optional(),
  site_base_url: z.string().max(200).optional(),
  anonymous_retention_days: z.number().int().min(0).max(15).optional(),
  anonymous_daily_quota: z.number().int().min(0).optional(),
  default_user_daily_quota: z.number().int().min(0).optional(),
});

const resetAnonymousQuotaSchema = z.object({
  resetUsed: z.boolean().optional(),
});

// 获取系统设置（仅管理员）
settings.get('/system', actorMiddleware, async (c) => {
  try {
    const actor = c.get('actor') as Actor | undefined;
    if (!actor) {
      return c.json<ApiResponse>({
        success: false,
        error: 'Actor unavailable',
      }, 401);
    }
    const isAdmin = actor.type === 'user' && actor.role === 'ADMIN';
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

    const quotaPolicy = await getQuotaPolicy();

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
      provider_initial_grace_ms: parseInt(settingsObj.provider_initial_grace_ms || process.env.PROVIDER_INITIAL_GRACE_MS || '120000'),
      provider_reasoning_idle_ms: parseInt(settingsObj.provider_reasoning_idle_ms || process.env.PROVIDER_REASONING_IDLE_MS || '300000'),
      reasoning_keepalive_interval_ms: parseInt(settingsObj.reasoning_keepalive_interval_ms || process.env.REASONING_KEEPALIVE_INTERVAL_MS || '0'),
      // 推理链
      reasoning_enabled: (settingsObj.reasoning_enabled ?? (process.env.REASONING_ENABLED ?? 'true')).toString().toLowerCase() !== 'false',
      reasoning_default_expand: (settingsObj.reasoning_default_expand ?? (process.env.REASONING_DEFAULT_EXPAND ?? 'false')).toString().toLowerCase() === 'true',
      // 默认 true（按你的要求）
      reasoning_save_to_db: (settingsObj.reasoning_save_to_db ?? (process.env.REASONING_SAVE_TO_DB ?? 'true')).toString().toLowerCase() === 'true',
      reasoning_tags_mode: (settingsObj.reasoning_tags_mode ?? (process.env.REASONING_TAGS_MODE ?? 'default')).toString(),
      reasoning_custom_tags: settingsObj.reasoning_custom_tags || process.env.REASONING_CUSTOM_TAGS || '',
      stream_delta_chunk_size: parseInt(settingsObj.stream_delta_chunk_size || process.env.STREAM_DELTA_CHUNK_SIZE || '1'),
      openai_reasoning_effort: (settingsObj.openai_reasoning_effort || process.env.OPENAI_REASONING_EFFORT || ''),
      ollama_think: (settingsObj.ollama_think ?? (process.env.OLLAMA_THINK ?? 'false')).toString().toLowerCase() === 'true',
      chat_image_retention_days: (() => {
        const raw = settingsObj.chat_image_retention_days ?? process.env.CHAT_IMAGE_RETENTION_DAYS ?? `${CHAT_IMAGE_DEFAULT_RETENTION_DAYS}`
        const parsed = Number.parseInt(String(raw), 10)
        return Number.isFinite(parsed) && parsed >= 0 ? parsed : CHAT_IMAGE_DEFAULT_RETENTION_DAYS
      })(),
      site_base_url: settingsObj.site_base_url || process.env.CHAT_IMAGE_BASE_URL || '',
      anonymous_retention_days: quotaPolicy.anonymousRetentionDays,
      anonymous_daily_quota: quotaPolicy.anonymousDailyQuota,
      default_user_daily_quota: quotaPolicy.defaultUserDailyQuota,
    };

    if (!isAdmin) {
      const publicSettings = {
        brand_text: formattedSettings.brand_text,
        registration_enabled: formattedSettings.registration_enabled,
        anonymous_retention_days: formattedSettings.anonymous_retention_days,
        anonymous_daily_quota: formattedSettings.anonymous_daily_quota,
        default_user_daily_quota: formattedSettings.default_user_daily_quota,
      };
      return c.json<ApiResponse>({
        success: true,
        data: publicSettings,
      });
    }

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
settings.put('/system', actorMiddleware, requireUserActor, adminOnlyMiddleware, zValidator('json', systemSettingSchema), async (c) => {
  try {
    const { registration_enabled, brand_text, sse_heartbeat_interval_ms, provider_max_idle_ms, provider_timeout_ms, provider_initial_grace_ms, provider_reasoning_idle_ms, reasoning_keepalive_interval_ms, usage_emit, usage_provider_only, reasoning_enabled, reasoning_default_expand, reasoning_save_to_db, reasoning_tags_mode, reasoning_custom_tags, stream_delta_chunk_size, openai_reasoning_effort, ollama_think, chat_image_retention_days, site_base_url, anonymous_retention_days, anonymous_daily_quota, default_user_daily_quota } = c.req.valid('json');
    let anonymousQuotaUpdated = false;

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

    if (typeof provider_initial_grace_ms === 'number') {
      await prisma.systemSetting.upsert({
        where: { key: 'provider_initial_grace_ms' },
        update: { value: String(provider_initial_grace_ms) },
        create: { key: 'provider_initial_grace_ms', value: String(provider_initial_grace_ms) },
      });
    }

    if (typeof provider_reasoning_idle_ms === 'number') {
      await prisma.systemSetting.upsert({
        where: { key: 'provider_reasoning_idle_ms' },
        update: { value: String(provider_reasoning_idle_ms) },
        create: { key: 'provider_reasoning_idle_ms', value: String(provider_reasoning_idle_ms) },
      });
    }

    if (typeof reasoning_keepalive_interval_ms === 'number') {
      await prisma.systemSetting.upsert({
        where: { key: 'reasoning_keepalive_interval_ms' },
        update: { value: String(reasoning_keepalive_interval_ms) },
        create: { key: 'reasoning_keepalive_interval_ms', value: String(reasoning_keepalive_interval_ms) },
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

    // 推理链相关
    if (typeof reasoning_enabled === 'boolean') {
      await prisma.systemSetting.upsert({
        where: { key: 'reasoning_enabled' },
        update: { value: reasoning_enabled.toString() },
        create: { key: 'reasoning_enabled', value: reasoning_enabled.toString() },
      });
    }

    if (typeof reasoning_default_expand === 'boolean') {
      await prisma.systemSetting.upsert({
        where: { key: 'reasoning_default_expand' },
        update: { value: reasoning_default_expand.toString() },
        create: { key: 'reasoning_default_expand', value: reasoning_default_expand.toString() },
      });
    }

    if (typeof reasoning_save_to_db === 'boolean') {
      await prisma.systemSetting.upsert({
        where: { key: 'reasoning_save_to_db' },
        update: { value: reasoning_save_to_db.toString() },
        create: { key: 'reasoning_save_to_db', value: reasoning_save_to_db.toString() },
      });
    }

    if (typeof reasoning_tags_mode === 'string') {
      await prisma.systemSetting.upsert({
        where: { key: 'reasoning_tags_mode' },
        update: { value: reasoning_tags_mode },
        create: { key: 'reasoning_tags_mode', value: reasoning_tags_mode },
      });
    }

    if (typeof reasoning_custom_tags === 'string') {
      await prisma.systemSetting.upsert({
        where: { key: 'reasoning_custom_tags' },
        update: { value: reasoning_custom_tags },
        create: { key: 'reasoning_custom_tags', value: reasoning_custom_tags },
      });
    }

    if (typeof stream_delta_chunk_size === 'number') {
      await prisma.systemSetting.upsert({
        where: { key: 'stream_delta_chunk_size' },
        update: { value: String(stream_delta_chunk_size) },
        create: { key: 'stream_delta_chunk_size', value: String(stream_delta_chunk_size) },
      });
    }

    if (typeof openai_reasoning_effort === 'string') {
      await prisma.systemSetting.upsert({
        where: { key: 'openai_reasoning_effort' },
        update: { value: openai_reasoning_effort },
        create: { key: 'openai_reasoning_effort', value: openai_reasoning_effort },
      });
    }

    if (typeof ollama_think === 'boolean') {
      await prisma.systemSetting.upsert({
        where: { key: 'ollama_think' },
        update: { value: ollama_think.toString() },
        create: { key: 'ollama_think', value: ollama_think.toString() },
      });
    }

    if (typeof chat_image_retention_days === 'number') {
      await prisma.systemSetting.upsert({
        where: { key: 'chat_image_retention_days' },
        update: { value: String(chat_image_retention_days) },
        create: { key: 'chat_image_retention_days', value: String(chat_image_retention_days) },
      });
    }

    if (typeof site_base_url === 'string') {
      const trimmed = site_base_url.trim()
      if (trimmed) {
        await prisma.systemSetting.upsert({
          where: { key: 'site_base_url' },
          update: { value: trimmed },
          create: { key: 'site_base_url', value: trimmed },
        });
      } else {
        await prisma.systemSetting.deleteMany({ where: { key: 'site_base_url' } })
      }
    }

    if (typeof anonymous_retention_days === 'number') {
      const clamped = Math.max(0, Math.min(15, anonymous_retention_days))
      await prisma.systemSetting.upsert({
        where: { key: 'anonymous_retention_days' },
        update: { value: String(clamped) },
        create: { key: 'anonymous_retention_days', value: String(clamped) },
      })
    }

    if (typeof anonymous_daily_quota === 'number') {
      const sanitized = Math.max(0, anonymous_daily_quota)
      await prisma.systemSetting.upsert({
        where: { key: 'anonymous_daily_quota' },
        update: { value: String(sanitized) },
        create: { key: 'anonymous_daily_quota', value: String(sanitized) },
      })
      anonymousQuotaUpdated = true;
    }

    if (typeof default_user_daily_quota === 'number') {
      const sanitized = Math.max(0, default_user_daily_quota)
      await prisma.systemSetting.upsert({
        where: { key: 'default_user_daily_quota' },
        update: { value: String(sanitized) },
        create: { key: 'default_user_daily_quota', value: String(sanitized) },
      })
    }

    if (anonymousQuotaUpdated) {
      await syncSharedAnonymousQuota({ resetUsed: false })
    }

    invalidateQuotaPolicyCache();

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

settings.post('/system/anonymous-quota/reset', actorMiddleware, requireUserActor, adminOnlyMiddleware, zValidator('json', resetAnonymousQuotaSchema), async (c) => {
  try {
    const { resetUsed } = c.req.valid('json');
    await syncSharedAnonymousQuota({ resetUsed: Boolean(resetUsed) });
    invalidateQuotaPolicyCache();
    return c.json<ApiResponse>({
      success: true,
      message: 'Anonymous quota synchronized',
    });
  } catch (error) {
    console.error('Reset anonymous quota error:', error);
    return c.json<ApiResponse>({
      success: false,
      error: 'Failed to synchronize anonymous quota',
    }, 500);
  }
});

// 获取用户个人设置
settings.get('/personal', actorMiddleware, requireUserActor, async (c) => {
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
settings.put('/personal', actorMiddleware, requireUserActor, zValidator('json', z.object({
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
      version: 'v1.1.0',
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
      version: 'v1.1.0',
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
