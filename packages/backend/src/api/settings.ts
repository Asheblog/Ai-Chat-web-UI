import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { actorMiddleware, requireUserActor, adminOnlyMiddleware } from '../middleware/auth';
import type { ApiResponse, Actor } from '../types';
import { settingsFacade, SettingsServiceError, HealthServiceError } from '../services/settings/settings-facade'
import type { SettingsFacade } from '../services/settings/settings-facade'
import type { SetupState } from '../services/settings/settings-service'
import { MAX_SYSTEM_PROMPT_LENGTH } from '../constants/prompt'
import { reloadRAGServices } from '../services/rag-initializer'
import {
  pythonRuntimeService as defaultPythonRuntimeService,
  PythonRuntimeServiceError,
  type PythonRuntimeService,
} from '../services/python-runtime'

export interface SettingsApiDeps {
  settingsFacade?: SettingsFacade
  pythonRuntimeService?: PythonRuntimeService
}

export const createSettingsApi = (deps: SettingsApiDeps = {}) => {
  const facade = deps.settingsFacade ?? settingsFacade
  const pythonRuntimeService = deps.pythonRuntimeService ?? defaultPythonRuntimeService
  const settings = new Hono();

  const handleServiceError = (
    c: any,
    error: unknown,
    fallbackMessage: string,
    logLabel: string,
  ) => {
    if (error instanceof SettingsServiceError) {
      return c.json<ApiResponse>({ success: false, error: error.message }, error.statusCode);
    }
    console.error(logLabel, error);
    return c.json<ApiResponse>({ success: false, error: fallbackMessage }, 500);
  };

  settings.get('/branding', async (c) => {
    try {
      const brandText = await facade.getBrandingText();
      return c.json<ApiResponse>({ success: true, data: { brand_text: brandText } });
    } catch (error) {
      return handleServiceError(c, error, 'Failed to fetch branding info', 'Get branding error:');
    }
  });

  const setupStateSchema = z.object({
    state: z.enum(['skipped', 'completed']),
  })

  settings.get('/setup-status', actorMiddleware, async (c) => {
    try {
      const actor = c.get('actor') as Actor | undefined
      const status = await facade.getSetupStatus(actor)

      if (!status.isAdmin) {
        return c.json<ApiResponse>({
          success: true,
          data: {
            setup_state: status.setupState,
            requires_admin: true,
          },
        })
      }

      return c.json<ApiResponse>({
        success: true,
        data: {
          setup_state: status.setupState,
          stored_state: status.storedState,
          forced_by_env: status.forcedByEnv,
          can_complete: status.canComplete,
          diagnostics: status.diagnostics,
        },
      })
    } catch (error) {
      return handleServiceError(c, error, 'Failed to fetch setup status', 'Get setup status error:')
    }
  })

  settings.post(
    '/setup-state',
    actorMiddleware,
    requireUserActor,
    adminOnlyMiddleware,
    zValidator('json', setupStateSchema),
    async (c) => {
      try {
        const payload = c.req.valid('json')
        await facade.setSetupState(payload.state as SetupState)
        return c.json<ApiResponse>({
          success: true,
          message: `Setup state updated to ${payload.state}`,
          data: { setup_state: payload.state },
        })
      } catch (error) {
        return handleServiceError(c, error, 'Failed to update setup state', 'Update setup state error:')
      }
    },
  )

  // 系统设置schema（允许部分字段更新）
  const imagePayloadSchema = z.object({
    data: z.string().min(1),
    mime: z.string().min(1),
  })

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
    stream_delta_flush_interval_ms: z.number().int().min(0).max(3600000).optional(),
    stream_reasoning_flush_interval_ms: z.number().int().min(0).max(3600000).optional(),
    stream_keepalive_interval_ms: z.number().int().min(0).max(3600000).optional(),
    usage_emit: z.boolean().optional(),
    usage_provider_only: z.boolean().optional(),
    chat_system_prompt: z.string().max(MAX_SYSTEM_PROMPT_LENGTH).optional(),
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
    openai_reasoning_effort: z.enum(['low', 'medium', 'high', 'unset']).optional(),
    reasoning_max_output_tokens_default: z.number().int().min(1).max(256000).nullable().optional(),
    temperature_default: z.number().min(0).max(2).nullable().optional(),
    ollama_think: z.boolean().optional(),
    chat_image_retention_days: z.number().int().min(0).max(3650).optional(),
    assistant_reply_history_limit: z.number().int().min(1).max(20).optional(),
    site_base_url: z.string().max(200).optional(),
    anonymous_retention_days: z.number().int().min(0).max(15).optional(),
    anonymous_daily_quota: z.number().int().min(0).optional(),
    default_user_daily_quota: z.number().int().min(0).optional(),
    battle_allow_anonymous: z.boolean().optional(),
    battle_allow_users: z.boolean().optional(),
    battle_anonymous_daily_quota: z.number().int().min(0).optional(),
    battle_user_daily_quota: z.number().int().min(0).optional(),
    model_access_default_anonymous: z.enum(['allow', 'deny']).optional(),
    model_access_default_user: z.enum(['allow', 'deny']).optional(),
    web_search_agent_enable: z.boolean().optional(),
    web_search_default_engine: z.string().min(1).max(32).optional(),
    web_search_api_key_tavily: z.string().optional(),
    web_search_api_key_brave: z.string().optional(),
    web_search_api_key_metaso: z.string().optional(),
    web_search_result_limit: z.number().int().min(1).max(10).optional(),
    web_search_domain_filter: z.array(z.string().min(1)).optional(),
    web_search_scope: z.enum(['webpage', 'document', 'paper', 'image', 'video', 'podcast']).optional(),
    web_search_include_summary: z.boolean().optional(),
    web_search_include_raw: z.boolean().optional(),
    agent_max_tool_iterations: z.number().int().min(0).max(20).optional(),
    python_tool_enable: z.boolean().optional(),
    python_tool_timeout_ms: z.number().int().min(1000).max(60000).optional(),
    python_tool_max_output_chars: z.number().int().min(256).max(20000).optional(),
    python_tool_max_source_chars: z.number().int().min(256).max(20000).optional(),
    assistant_avatar: z.union([imagePayloadSchema, z.null()]).optional(),
    task_trace_enabled: z.boolean().optional(),
    task_trace_default_on: z.boolean().optional(),
    task_trace_admin_only: z.boolean().optional(),
    task_trace_env: z.enum(['dev', 'prod', 'both']).optional(),
    task_trace_retention_days: z.number().int().min(1).max(365).optional(),
    task_trace_max_events: z.number().int().min(100).max(200000).optional(),
    task_trace_idle_timeout_ms: z.number().int().min(1000).max(600000).optional(),
    chat_max_concurrent_streams: z.number().int().min(1).max(8).optional(),
    // 标题智能总结设置
    title_summary_enabled: z.boolean().optional(),
    title_summary_max_length: z.number().int().min(5).max(50).optional(),
    title_summary_model_source: z.enum(['current', 'specified']).optional(),
    title_summary_connection_id: z.number().int().positive().nullable().optional(),
    title_summary_model_id: z.string().min(1).nullable().optional(),
    // RAG 文档解析设置
    rag_enabled: z.boolean().optional(),
    rag_embedding_connection_id: z.number().int().positive().nullable().optional(),
    rag_embedding_model_id: z.string().min(1).max(128).optional(),
    rag_embedding_batch_size: z.number().int().min(1).max(128).optional(),
    rag_embedding_concurrency: z.number().int().min(1).max(16).optional(),
    rag_top_k: z.number().int().min(1).max(20).optional(),
    rag_relevance_threshold: z.number().min(0).max(1).optional(),
    rag_max_context_tokens: z.number().int().min(500).max(32000).optional(),
    rag_chunk_size: z.number().int().min(100).max(8000).optional(),
    rag_chunk_overlap: z.number().int().min(0).max(1000).optional(),
    rag_max_file_size_mb: z.number().int().min(1).max(200).optional(),
    rag_max_pages: z.number().int().min(10).max(1000).optional(),
    rag_retention_days: z.number().int().min(1).max(365).optional(),
    // 知识库设置
    knowledge_base_enabled: z.boolean().optional(),
    knowledge_base_allow_anonymous: z.boolean().optional(),
    knowledge_base_allow_users: z.boolean().optional(),
  });

  const resetAnonymousQuotaSchema = z.object({
    resetUsed: z.boolean().optional(),
  });

  const pythonRuntimeIndexesSchema = z.object({
    indexUrl: z.string().max(512).optional(),
    extraIndexUrls: z.array(z.string().min(1).max(512)).max(64).optional(),
    trustedHosts: z.array(z.string().min(1).max(255)).max(64).optional(),
    autoInstallOnActivate: z.boolean().optional(),
  })

  const pythonRuntimeInstallSchema = z.object({
    requirements: z.array(z.string().min(1).max(256)).min(1).max(128),
    source: z.enum(['manual', 'skill']),
    skillId: z.number().int().positive().optional(),
    versionId: z.number().int().positive().optional(),
  })

  const pythonRuntimeUninstallSchema = z.object({
    packages: z.array(z.string().min(1).max(128)).min(1).max(128),
  })

  const modelPreferenceSchema = z.object({
    modelId: z.string().min(1).nullable().optional(),
    connectionId: z.number().int().positive().nullable().optional(),
    rawId: z.string().min(1).nullable().optional(),
  });

  // 获取系统设置（仅管理员）
  settings.get('/system', actorMiddleware, async (c) => {
    try {
      const actor = c.get('actor') as Actor | undefined
      if (!actor) {
        return c.json<ApiResponse>({ success: false, error: 'Actor unavailable' }, 401)
      }
      const result = await facade.getSystemSettings(actor)
      return c.json<ApiResponse>({ success: true, data: result })
    } catch (error) {
      return handleServiceError(c, error, 'Failed to fetch system settings', 'Get system settings error:')
    }
  });

  // 更新系统设置（仅管理员）
  settings.put(
    '/system',
    actorMiddleware,
    requireUserActor,
    adminOnlyMiddleware,
    zValidator('json', systemSettingSchema),
    async (c) => {
      try {
        const payload = c.req.valid('json')
        await facade.updateSystemSettings(payload)

        // 如果更新了 RAG 相关设置，自动重载 RAG 服务
        const ragKeys = [
          'rag_enabled',
          'rag_embedding_connection_id',
          'rag_embedding_model_id',
          'rag_embedding_batch_size',
          'rag_embedding_concurrency',
          'rag_top_k',
          'rag_relevance_threshold',
          'rag_max_context_tokens',
          'rag_chunk_size',
          'rag_chunk_overlap',
          'rag_max_file_size_mb',
          'rag_retention_days',
        ]
        const hasRagChanges = ragKeys.some(key => key in payload)
        if (hasRagChanges) {
          const ragResult = await reloadRAGServices()
          console.log(`🔄 RAG services reload: ${ragResult.message}`)
        }

        return c.json<ApiResponse>({ success: true, message: 'System settings updated successfully' })
      } catch (error) {
        return handleServiceError(c, error, 'Failed to update system settings', 'Update system settings error:')
      }
    },
  );

  settings.post('/system/anonymous-quota/reset', actorMiddleware, requireUserActor, adminOnlyMiddleware, zValidator('json', resetAnonymousQuotaSchema), async (c) => {
    try {
      const { resetUsed } = c.req.valid('json');
      await facade.resetAnonymousQuota({ resetUsed: Boolean(resetUsed) });
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

  settings.get('/python-runtime', actorMiddleware, requireUserActor, adminOnlyMiddleware, async (c) => {
    try {
      const result = await pythonRuntimeService.getRuntimeStatus()
      return c.json<ApiResponse>({ success: true, data: result })
    } catch (error) {
      if (error instanceof PythonRuntimeServiceError) {
        return c.json<ApiResponse>(
          { success: false, error: error.message, data: error.details ? { code: error.code, details: error.details } : { code: error.code } },
          error.statusCode,
        )
      }
      console.error('Get python runtime status error:', error)
      return c.json<ApiResponse>({ success: false, error: 'Failed to load python runtime status' }, 500)
    }
  })

  settings.put(
    '/python-runtime/indexes',
    actorMiddleware,
    requireUserActor,
    adminOnlyMiddleware,
    zValidator('json', pythonRuntimeIndexesSchema),
    async (c) => {
      try {
        const payload = c.req.valid('json')
        const result = await pythonRuntimeService.updateIndexes(payload)
        return c.json<ApiResponse>({ success: true, data: result })
      } catch (error) {
        if (error instanceof PythonRuntimeServiceError) {
          return c.json<ApiResponse>(
            { success: false, error: error.message, data: error.details ? { code: error.code, details: error.details } : { code: error.code } },
            error.statusCode,
          )
        }
        console.error('Update python runtime indexes error:', error)
        return c.json<ApiResponse>({ success: false, error: 'Failed to update python runtime indexes' }, 500)
      }
    },
  )

  settings.post(
    '/python-runtime/install',
    actorMiddleware,
    requireUserActor,
    adminOnlyMiddleware,
    zValidator('json', pythonRuntimeInstallSchema),
    async (c) => {
      try {
        const payload = c.req.valid('json')
        const result = await pythonRuntimeService.installRequirements({
          requirements: payload.requirements,
          source: payload.source,
          skillId: payload.skillId,
          versionId: payload.versionId,
        })
        return c.json<ApiResponse>({ success: true, data: result })
      } catch (error) {
        if (error instanceof PythonRuntimeServiceError) {
          return c.json<ApiResponse>(
            { success: false, error: error.message, data: error.details ? { code: error.code, details: error.details } : { code: error.code } },
            error.statusCode,
          )
        }
        console.error('Install python requirements error:', error)
        return c.json<ApiResponse>({ success: false, error: 'Failed to install python requirements' }, 500)
      }
    },
  )

  settings.post(
    '/python-runtime/uninstall',
    actorMiddleware,
    requireUserActor,
    adminOnlyMiddleware,
    zValidator('json', pythonRuntimeUninstallSchema),
    async (c) => {
      try {
        const payload = c.req.valid('json')
        const result = await pythonRuntimeService.uninstallPackages(payload.packages)
        return c.json<ApiResponse>({ success: true, data: result })
      } catch (error) {
        if (error instanceof PythonRuntimeServiceError) {
          return c.json<ApiResponse>(
            { success: false, error: error.message, data: error.details ? { code: error.code, details: error.details } : { code: error.code } },
            error.statusCode,
          )
        }
        console.error('Uninstall python packages error:', error)
        return c.json<ApiResponse>({ success: false, error: 'Failed to uninstall python packages' }, 500)
      }
    },
  )

  settings.post(
    '/python-runtime/reconcile',
    actorMiddleware,
    requireUserActor,
    adminOnlyMiddleware,
    async (c) => {
      try {
        const result = await pythonRuntimeService.reconcile()
        return c.json<ApiResponse>({ success: true, data: result })
      } catch (error) {
        if (error instanceof PythonRuntimeServiceError) {
          return c.json<ApiResponse>(
            { success: false, error: error.message, data: error.details ? { code: error.code, details: error.details } : { code: error.code } },
            error.statusCode,
          )
        }
        console.error('Reconcile python runtime error:', error)
        return c.json<ApiResponse>({ success: false, error: 'Failed to reconcile python runtime' }, 500)
      }
    },
  )

  // 获取用户个人设置
  settings.get('/personal', actorMiddleware, requireUserActor, async (c) => {
    try {
      const user = c.get('user');
      if (!user) {
        return c.json<ApiResponse>({ success: false, error: 'User unavailable' }, 401);
      }

      const personalSettings = await facade.getPersonalSettings({ userId: user.id, request: c.req.raw })

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
    preferred_model: modelPreferenceSchema.optional(),
    avatar: z.union([imagePayloadSchema, z.null()]).optional(),
    username: z.string().regex(/^[a-zA-Z0-9_]{3,20}$/).optional(),
    personal_prompt: z.string().max(MAX_SYSTEM_PROMPT_LENGTH).nullable().optional(),
  })), async (c) => {
    try {
      const user = c.get('user');
      const updateData = c.req.valid('json');
      if (!user) {
        return c.json<ApiResponse>({ success: false, error: 'User unavailable' }, 401);
      }

      const updated = await facade.updatePersonalSettings({
        userId: user.id,
        payload: updateData,
        request: c.req.raw,
      })

      const responseData: Record<string, any> = { ...updateData }
      if (Object.prototype.hasOwnProperty.call(responseData, 'avatar')) {
        delete responseData.avatar
      }

      return c.json<ApiResponse>({
        success: true,
        data: {
          ...responseData,
          preferred_model: updated.preferred_model,
          avatar_url: updated.avatar_url,
          username: updated.username,
          personal_prompt: updated.personal_prompt,
        },
        message: 'Personal settings updated successfully',
      });

    } catch (error) {
      console.error('Update personal settings error:', error);
      const status = (error as any)?.statusCode ?? 500
      const message = (error as Error)?.message || 'Failed to update personal settings'
      return c.json<ApiResponse>({
        success: false,
        error: message,
      }, status);
    }
  });

  // 获取应用信息
  settings.get('/app-info', async (c) => {
    try {
      const appInfo = await facade.getAppInfo()

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
      const healthInfo = await facade.checkHealth()
      return c.json<ApiResponse>({
        success: true,
        data: healthInfo,
      });

    } catch (error) {
      console.error('Health check error:', error);

      const status = error instanceof HealthServiceError ? error.statusCode : 503
      const healthInfo = {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Unknown error',
      };

      return c.json<ApiResponse>({
        success: false,
        data: healthInfo,
        error: 'Service is unhealthy',
      }, status);
    }
  });

  return settings;
};

export default createSettingsApi();
