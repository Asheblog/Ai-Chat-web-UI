import type { PrismaClient, Prisma } from '@prisma/client'
import { prisma as defaultPrisma } from '../../db'
import {
  getQuotaPolicy as defaultGetQuotaPolicy,
  getBattlePolicy as defaultGetBattlePolicy,
  invalidateQuotaPolicyCache as defaultInvalidateQuotaPolicyCache,
  invalidateBattlePolicyCache as defaultInvalidateBattlePolicyCache,
  invalidateReasoningMaxOutputTokensDefaultCache as defaultInvalidateReasoningMaxOutputTokensDefaultCache,
} from '../../utils/system-settings'
import { invalidateTaskTraceConfig as defaultInvalidateTaskTraceConfig } from '../../utils/task-trace'
import { syncSharedAnonymousQuota as defaultSyncSharedAnonymousQuota } from '../../utils/quota'
import {
  replaceProfileImage as defaultReplaceProfileImage,
  resolveProfileImageUrl,
  determineProfileImageBaseUrl,
} from '../../utils/profile-images'
import type { Actor } from '../../types'
import { CHAT_IMAGE_DEFAULT_RETENTION_DAYS } from '../../config/storage'
import { invalidateModelAccessDefaultsCache as defaultInvalidateModelAccessDefaultsCache } from '../../utils/model-access-policy'

export type SetupState = 'required' | 'skipped' | 'completed'

export interface SetupStatusDiagnostics {
  hasEnabledSystemConnection: boolean
  enabledSystemConnections: number
  totalSystemConnections: number
  hasChatModels: boolean
  chatModels: number
  totalModels: number
  securityWarnings: {
    jwtSecretUnsafe: boolean
    encryptionKeyUnsafe: boolean
  }
}

export class SettingsServiceError extends Error {
  statusCode: number

  constructor(message: string, statusCode = 400) {
    super(message)
    this.name = 'SettingsServiceError'
    this.statusCode = statusCode
  }
}

export interface SettingsServiceDeps {
  prisma?: PrismaClient
  getQuotaPolicy?: typeof defaultGetQuotaPolicy
  getBattlePolicy?: typeof defaultGetBattlePolicy
  invalidateQuotaPolicyCache?: typeof defaultInvalidateQuotaPolicyCache
  invalidateBattlePolicyCache?: typeof defaultInvalidateBattlePolicyCache
  invalidateReasoningMaxOutputTokensDefaultCache?: typeof defaultInvalidateReasoningMaxOutputTokensDefaultCache
  invalidateTaskTraceConfig?: typeof defaultInvalidateTaskTraceConfig
  syncSharedAnonymousQuota?: typeof defaultSyncSharedAnonymousQuota
  replaceProfileImage?: typeof defaultReplaceProfileImage
  invalidateModelAccessDefaultsCache?: typeof defaultInvalidateModelAccessDefaultsCache
  now?: () => Date
}

const BRAND_TEXT_CACHE_TTL_MS = 30_000

export class SettingsService {
  private prisma: PrismaClient
  private getQuotaPolicy: typeof defaultGetQuotaPolicy
  private getBattlePolicy: typeof defaultGetBattlePolicy
  private invalidateQuotaPolicyCache: typeof defaultInvalidateQuotaPolicyCache
  private invalidateBattlePolicyCache: typeof defaultInvalidateBattlePolicyCache
  private invalidateReasoningMaxOutputTokensDefaultCache: typeof defaultInvalidateReasoningMaxOutputTokensDefaultCache
  private invalidateTaskTraceConfig: typeof defaultInvalidateTaskTraceConfig
  private syncSharedAnonymousQuota: typeof defaultSyncSharedAnonymousQuota
  private replaceProfileImage: typeof defaultReplaceProfileImage
  private invalidateModelAccessDefaultsCache: typeof defaultInvalidateModelAccessDefaultsCache
  private now: () => Date
  private cachedBrandText: { value: string; expiresAt: number } | null = null

  constructor(deps: SettingsServiceDeps = {}) {
    this.prisma = deps.prisma ?? defaultPrisma
    this.getQuotaPolicy = deps.getQuotaPolicy ?? defaultGetQuotaPolicy
    this.getBattlePolicy = deps.getBattlePolicy ?? defaultGetBattlePolicy
    this.invalidateQuotaPolicyCache = deps.invalidateQuotaPolicyCache ?? defaultInvalidateQuotaPolicyCache
    this.invalidateBattlePolicyCache = deps.invalidateBattlePolicyCache ?? defaultInvalidateBattlePolicyCache
    this.invalidateReasoningMaxOutputTokensDefaultCache =
      deps.invalidateReasoningMaxOutputTokensDefaultCache ?? defaultInvalidateReasoningMaxOutputTokensDefaultCache
    this.invalidateTaskTraceConfig = deps.invalidateTaskTraceConfig ?? defaultInvalidateTaskTraceConfig
    this.syncSharedAnonymousQuota = deps.syncSharedAnonymousQuota ?? defaultSyncSharedAnonymousQuota
    this.replaceProfileImage = deps.replaceProfileImage ?? defaultReplaceProfileImage
    this.invalidateModelAccessDefaultsCache = deps.invalidateModelAccessDefaultsCache ?? defaultInvalidateModelAccessDefaultsCache
    this.now = deps.now ?? (() => new Date())
  }

  async getBrandingText() {
    const now = Date.now()
    if (this.cachedBrandText && this.cachedBrandText.expiresAt > now) {
      return this.cachedBrandText.value
    }
    const record = await this.prisma.systemSetting.findUnique({
      where: { key: 'brand_text' },
      select: { value: true },
    })
    const value = (record?.value || '').trim() || 'AIChat'
    this.cachedBrandText = { value, expiresAt: now + BRAND_TEXT_CACHE_TTL_MS }
    return value
  }

  invalidateBrandingCache() {
    this.cachedBrandText = null
  }

  private parseSetupState(value: unknown): SetupState | null {
    if (value === 'required' || value === 'skipped' || value === 'completed') {
      return value
    }
    return null
  }

  private readEnvFlag(value: unknown): boolean {
    const normalized = String(value ?? '').trim().toLowerCase()
    return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'y'
  }

  private async computeSetupDiagnostics(): Promise<SetupStatusDiagnostics> {
    const connections = await this.prisma.connection.findMany({
      where: { ownerUserId: null },
      select: { id: true, enable: true },
    })
    const enabledConnectionIds = connections.filter((c) => c.enable).map((c) => c.id)
    const totalSystemConnections = connections.length
    const enabledSystemConnections = enabledConnectionIds.length

    const totalModels = enabledConnectionIds.length
      ? await this.prisma.modelCatalog.count({
          where: { connectionId: { in: enabledConnectionIds } },
        })
      : 0

    const chatModels = enabledConnectionIds.length
      ? await this.prisma.modelCatalog.count({
          where: {
            connectionId: { in: enabledConnectionIds },
            modelType: { in: ['chat', 'both'] },
          },
        })
      : 0

    const jwtSecret = process.env.JWT_SECRET
    const encryptionKey = process.env.ENCRYPTION_KEY
    const jwtSecretUnsafe =
      !jwtSecret ||
      jwtSecret === 'fallback-secret-key' ||
      jwtSecret === 'aichat-super-secret-jwt-key-2025-production-change-me'
    const encryptionKeyUnsafe = !encryptionKey || encryptionKey === 'aichat-encryption-key-2025'

    return {
      hasEnabledSystemConnection: enabledSystemConnections > 0,
      enabledSystemConnections,
      totalSystemConnections,
      hasChatModels: chatModels > 0,
      chatModels,
      totalModels,
      securityWarnings: {
        jwtSecretUnsafe,
        encryptionKeyUnsafe,
      },
    }
  }

  async getSetupStatus(actor?: Actor | null): Promise<{
    setupState: SetupState
    storedState: SetupState | null
    forcedByEnv: boolean
    canComplete: boolean
    diagnostics: SetupStatusDiagnostics
    isAdmin: boolean
  }> {
    const isAdmin = Boolean(actor && actor.type === 'user' && actor.role === 'ADMIN')
    const record = await this.prisma.systemSetting.findUnique({
      where: { key: 'setup_state' },
      select: { value: true },
    })
    const storedState = this.parseSetupState(record?.value)

    const forcedByEnv = this.readEnvFlag(process.env.DB_INIT_ON_START) || this.readEnvFlag(process.env.FORCE_SETUP_WIZARD)

    const diagnostics = await this.computeSetupDiagnostics()
    const canComplete = diagnostics.hasEnabledSystemConnection && diagnostics.hasChatModels

    const setupState: SetupState = (() => {
      if (storedState) return storedState
      if (forcedByEnv) return 'required'
      return canComplete ? 'completed' : 'required'
    })()

    return {
      setupState,
      storedState,
      forcedByEnv,
      canComplete,
      diagnostics,
      isAdmin,
    }
  }

  async setSetupState(state: SetupState): Promise<void> {
    if (state !== 'required' && state !== 'skipped' && state !== 'completed') {
      throw new SettingsServiceError('Invalid setup state', 400)
    }

    const nowIso = this.now().toISOString()
    const upsert = (key: string, value: string) =>
      this.prisma.systemSetting.upsert({
        where: { key },
        update: { value },
        create: { key, value },
      })

    const updates: Array<ReturnType<typeof upsert>> = [upsert('setup_state', state)]
    if (state === 'required') updates.push(upsert('setup_required_at', nowIso))
    if (state === 'skipped') updates.push(upsert('setup_skipped_at', nowIso))
    if (state === 'completed') updates.push(upsert('setup_completed_at', nowIso))
    await Promise.all(updates)
  }

  async getSystemSettings(actor: Actor) {
    const isAdmin = actor.type === 'user' && actor.role === 'ADMIN'
    const rows = await this.prisma.systemSetting.findMany()
    const map = new Map(rows.map((row) => [row.key, row.value]))
    const read = (key: string, fallback = '') => map.get(key) ?? fallback
    const quotaPolicy = await this.getQuotaPolicy()
    const battlePolicy = await this.getBattlePolicy()
    const parseAccessDefault = (value: unknown, fallback: 'allow' | 'deny'): 'allow' | 'deny' => {
      if (value === 'allow') return 'allow'
      if (value === 'deny') return 'deny'
      return fallback
    }

    const settingsObj = Object.fromEntries(map.entries())
    const formatted = {
      brand_text: read('brand_text', process.env.BRAND_TEXT || 'AIChat'),
      registration_enabled: (read('registration_enabled', process.env.REGISTRATION_ENABLED || 'true') || 'true') === 'true',
      sse_heartbeat_interval_ms: Number(read('sse_heartbeat_interval_ms', process.env.SSE_HEARTBEAT_INTERVAL_MS || '15000')),
      provider_max_idle_ms: Number(read('provider_max_idle_ms', process.env.PROVIDER_MAX_IDLE_MS || '30000')),
      provider_timeout_ms: Number(read('provider_timeout_ms', process.env.PROVIDER_TIMEOUT_MS || '300000')),
      provider_initial_grace_ms: Number(read('provider_initial_grace_ms', process.env.PROVIDER_INITIAL_GRACE_MS || '0')),
      provider_reasoning_idle_ms: Number(read('provider_reasoning_idle_ms', process.env.PROVIDER_REASONING_IDLE_MS || '0')),
      reasoning_keepalive_interval_ms: Number(read('reasoning_keepalive_interval_ms', process.env.REASONING_KEEPALIVE_INTERVAL_MS || '0')),
      stream_delta_flush_interval_ms: Number(read('stream_delta_flush_interval_ms', process.env.STREAM_DELTA_FLUSH_INTERVAL_MS || '0')),
      stream_reasoning_flush_interval_ms: Number(read('stream_reasoning_flush_interval_ms', process.env.STREAM_REASONING_FLUSH_INTERVAL_MS || '0')),
      stream_keepalive_interval_ms: Number(read('stream_keepalive_interval_ms', process.env.STREAM_KEEPALIVE_INTERVAL_MS || '0')),
      usage_emit: this.parseBoolean(settingsObj.usage_emit, process.env.USAGE_EMIT),
      usage_provider_only: this.parseBoolean(settingsObj.usage_provider_only, process.env.USAGE_PROVIDER_ONLY),
      chat_system_prompt: settingsObj.chat_system_prompt || process.env.CHAT_SYSTEM_PROMPT || '',
      reasoning_enabled: this.parseBoolean(settingsObj.reasoning_enabled, process.env.REASONING_ENABLED || 'true'),
      reasoning_default_expand: this.parseBoolean(settingsObj.reasoning_default_expand, process.env.REASONING_DEFAULT_EXPAND || 'false'),
      reasoning_save_to_db: this.parseBoolean(settingsObj.reasoning_save_to_db, process.env.REASONING_SAVE_TO_DB || 'false'),
      reasoning_tags_mode: settingsObj.reasoning_tags_mode || process.env.REASONING_TAGS_MODE || 'default',
      reasoning_custom_tags: settingsObj.reasoning_custom_tags || process.env.REASONING_CUSTOM_TAGS || '',
      stream_delta_chunk_size: Number(read('stream_delta_chunk_size', process.env.STREAM_DELTA_CHUNK_SIZE || '3')),
      openai_reasoning_effort: settingsObj.openai_reasoning_effort || process.env.OPENAI_REASONING_EFFORT || 'unset',
      reasoning_max_output_tokens_default: Number(
        read('reasoning_max_output_tokens_default', process.env.REASONING_MAX_OUTPUT_TOKENS_DEFAULT || '32000'),
      ),
      ollama_think: this.parseBoolean(settingsObj.ollama_think, process.env.OLLAMA_THINK || 'false'),
      chat_image_retention_days: Number(read('chat_image_retention_days', String(CHAT_IMAGE_DEFAULT_RETENTION_DAYS))),
      assistant_reply_history_limit: Number(read('assistant_reply_history_limit', process.env.ASSISTANT_REPLY_HISTORY_LIMIT || '5')),
      site_base_url: read('site_base_url', process.env.SITE_BASE_URL || ''),
      anonymous_retention_days: quotaPolicy.anonymousRetentionDays,
      anonymous_daily_quota: quotaPolicy.anonymousDailyQuota,
      default_user_daily_quota: quotaPolicy.defaultUserDailyQuota,
      battle_allow_anonymous: battlePolicy.allowAnonymous,
      battle_allow_users: battlePolicy.allowUsers,
      battle_anonymous_daily_quota: battlePolicy.anonymousDailyQuota,
      battle_user_daily_quota: battlePolicy.userDailyQuota,
      web_search_agent_enable: this.parseBoolean(settingsObj.web_search_agent_enable, process.env.WEB_SEARCH_AGENT_ENABLE || 'false'),
      web_search_default_engine: settingsObj.web_search_default_engine || process.env.WEB_SEARCH_DEFAULT_ENGINE || 'tavily',
      web_search_result_limit: this.parseIntInRange(settingsObj.web_search_result_limit, process.env.WEB_SEARCH_RESULT_LIMIT, 1, 10, 4),
      web_search_domain_filter: this.parseDomainFilter(settingsObj.web_search_domain_filter),
      web_search_has_api_key_tavily: Boolean(
        settingsObj.web_search_api_key_tavily ||
          process.env.WEB_SEARCH_API_KEY_TAVILY ||
          '',
      ),
      web_search_has_api_key_brave: Boolean(
        settingsObj.web_search_api_key_brave ||
          process.env.WEB_SEARCH_API_KEY_BRAVE ||
          '',
      ),
      web_search_has_api_key_metaso: Boolean(
        settingsObj.web_search_api_key_metaso ||
          process.env.WEB_SEARCH_API_KEY_METASO ||
          '',
      ),
      web_search_has_api_key: Boolean(
        (settingsObj.web_search_api_key_tavily || process.env.WEB_SEARCH_API_KEY_TAVILY) ||
        (settingsObj.web_search_api_key_brave || process.env.WEB_SEARCH_API_KEY_BRAVE) ||
        (settingsObj.web_search_api_key_metaso || process.env.WEB_SEARCH_API_KEY_METASO),
      ),
      web_search_scope: settingsObj.web_search_scope || process.env.WEB_SEARCH_SCOPE || 'webpage',
      web_search_include_summary: this.parseBoolean(settingsObj.web_search_include_summary, process.env.WEB_SEARCH_INCLUDE_SUMMARY || 'false'),
      web_search_include_raw: this.parseBoolean(settingsObj.web_search_include_raw, process.env.WEB_SEARCH_INCLUDE_RAW || 'false'),
      agent_max_tool_iterations: this.parseIntInRange(
        settingsObj.agent_max_tool_iterations,
        process.env.AGENT_MAX_TOOL_ITERATIONS,
        0,
        20,
        4,
      ),
      python_tool_enable: this.parseBoolean(settingsObj.python_tool_enable, process.env.PYTHON_TOOL_ENABLE || 'false'),
      python_tool_command: settingsObj.python_tool_command || process.env.PYTHON_TOOL_COMMAND || 'python3',
      python_tool_args: this.parseDomainFilter(settingsObj.python_tool_args || process.env.PYTHON_TOOL_ARGS || '[]'),
      python_tool_timeout_ms: this.parseIntInRange(
        settingsObj.python_tool_timeout_ms,
        process.env.PYTHON_TOOL_TIMEOUT_MS,
        1000,
        60000,
        8000,
      ),
      python_tool_max_output_chars: this.parseIntInRange(
        settingsObj.python_tool_max_output_chars,
        process.env.PYTHON_TOOL_MAX_OUTPUT_CHARS,
        256,
        20000,
        4000,
      ),
      python_tool_max_source_chars: this.parseIntInRange(
        settingsObj.python_tool_max_source_chars,
        process.env.PYTHON_TOOL_MAX_SOURCE_CHARS,
        256,
        20000,
        4000,
      ),
      task_trace_enabled: this.parseBoolean(settingsObj.task_trace_enabled, 'false'),
      task_trace_default_on: this.parseBoolean(settingsObj.task_trace_default_on, 'false'),
      task_trace_admin_only: this.parseBoolean(settingsObj.task_trace_admin_only, 'true'),
      task_trace_env: this.parseTaskTraceEnv(settingsObj.task_trace_env),
      task_trace_retention_days: this.parseIntInRange(settingsObj.task_trace_retention_days, process.env.TASK_TRACE_RETENTION_DAYS, 1, 365, 7),
      task_trace_max_events: this.parseIntInRange(settingsObj.task_trace_max_events, process.env.TASK_TRACE_MAX_EVENTS, 100, 200000, 2000),
      task_trace_idle_timeout_ms: this.parseIntInRange(settingsObj.task_trace_idle_timeout_ms, process.env.TASK_TRACE_IDLE_TIMEOUT_MS, 1000, 600000, 30000),
      chat_max_concurrent_streams: this.parseIntInRange(
        settingsObj.chat_max_concurrent_streams,
        process.env.CHAT_MAX_CONCURRENT_STREAMS,
        1,
        8,
        1,
      ),
      assistant_avatar_url: null as string | null,
      assistant_avatar_path: settingsObj.assistant_avatar_path || null,
      model_access_default_anonymous: parseAccessDefault(map.get('model_access_default_anonymous'), 'deny'),
      model_access_default_user: parseAccessDefault(map.get('model_access_default_user'), 'allow'),
      // 标题智能总结设置
      title_summary_enabled: this.parseBoolean(settingsObj.title_summary_enabled, process.env.TITLE_SUMMARY_ENABLED || 'false'),
      title_summary_max_length: this.parseIntInRange(settingsObj.title_summary_max_length, process.env.TITLE_SUMMARY_MAX_LENGTH, 5, 50, 20),
      title_summary_model_source: (settingsObj.title_summary_model_source || process.env.TITLE_SUMMARY_MODEL_SOURCE || 'current') as 'current' | 'specified',
      title_summary_connection_id: settingsObj.title_summary_connection_id ? Number(settingsObj.title_summary_connection_id) : null,
      title_summary_model_id: settingsObj.title_summary_model_id || null,
      // RAG 文档解析设置
      rag_enabled: this.parseBoolean(settingsObj.rag_enabled, 'false'),
      rag_embedding_connection_id: settingsObj.rag_embedding_connection_id ? Number(settingsObj.rag_embedding_connection_id) : null,
      rag_embedding_model_id: settingsObj.rag_embedding_model_id || null,
      rag_embedding_batch_size: this.parseIntInRange(settingsObj.rag_embedding_batch_size, '1', 1, 128, 1),
      rag_embedding_concurrency: this.parseIntInRange(settingsObj.rag_embedding_concurrency, '1', 1, 16, 1),
      rag_top_k: this.parseIntInRange(settingsObj.rag_top_k, '5', 1, 20, 5),
      rag_relevance_threshold: this.parseFloat(settingsObj.rag_relevance_threshold, 0.3),
      rag_max_context_tokens: this.parseIntInRange(settingsObj.rag_max_context_tokens, '4000', 500, 32000, 4000),
      rag_chunk_size: this.parseIntInRange(settingsObj.rag_chunk_size, '1500', 100, 8000, 1500),
      rag_chunk_overlap: this.parseIntInRange(settingsObj.rag_chunk_overlap, '100', 0, 1000, 100),
      rag_max_file_size_mb: this.parseIntInRange(settingsObj.rag_max_file_size_mb, '50', 1, 200, 50),
      rag_max_pages: this.parseIntInRange(settingsObj.rag_max_pages, '200', 10, 1000, 200),
      rag_retention_days: this.parseIntInRange(settingsObj.rag_retention_days, '30', 1, 365, 30),
      // 知识库设置
      knowledge_base_enabled: this.parseBoolean(settingsObj.knowledge_base_enabled, 'false'),
      knowledge_base_allow_anonymous: this.parseBoolean(settingsObj.knowledge_base_allow_anonymous, 'false'),
      knowledge_base_allow_users: this.parseBoolean(settingsObj.knowledge_base_allow_users, 'true'),
    }

    const assistantAvatarBase = determineProfileImageBaseUrl({
      request: new Request('http://localhost'),
      siteBaseUrl: formatted.site_base_url,
    })
    formatted.assistant_avatar_url = resolveProfileImageUrl(formatted.assistant_avatar_path, assistantAvatarBase)

    if (!isAdmin) {
      return {
        brand_text: formatted.brand_text,
        registration_enabled: formatted.registration_enabled,
        anonymous_retention_days: formatted.anonymous_retention_days,
        anonymous_daily_quota: formatted.anonymous_daily_quota,
        default_user_daily_quota: formatted.default_user_daily_quota,
        battle_allow_anonymous: formatted.battle_allow_anonymous,
        battle_allow_users: formatted.battle_allow_users,
        battle_anonymous_daily_quota: formatted.battle_anonymous_daily_quota,
        battle_user_daily_quota: formatted.battle_user_daily_quota,
        model_access_default_anonymous: formatted.model_access_default_anonymous,
        model_access_default_user: formatted.model_access_default_user,
        web_search_agent_enable: formatted.web_search_agent_enable,
        web_search_default_engine: formatted.web_search_default_engine,
        web_search_result_limit: formatted.web_search_result_limit,
        web_search_domain_filter: formatted.web_search_domain_filter,
      web_search_has_api_key: formatted.web_search_has_api_key,
      web_search_has_api_key_tavily: formatted.web_search_has_api_key_tavily,
      web_search_has_api_key_brave: formatted.web_search_has_api_key_brave,
      web_search_has_api_key_metaso: formatted.web_search_has_api_key_metaso,
        web_search_scope: formatted.web_search_scope,
        web_search_include_summary: formatted.web_search_include_summary,
        web_search_include_raw: formatted.web_search_include_raw,
        python_tool_enable: formatted.python_tool_enable,
        assistant_avatar_url: formatted.assistant_avatar_url,
        chat_system_prompt: formatted.chat_system_prompt,
        chat_max_concurrent_streams: formatted.chat_max_concurrent_streams,
        // 标题总结设置（所有用户可见）
        title_summary_enabled: formatted.title_summary_enabled,
        title_summary_max_length: formatted.title_summary_max_length,
        title_summary_model_source: formatted.title_summary_model_source,
        title_summary_connection_id: formatted.title_summary_connection_id,
        title_summary_model_id: formatted.title_summary_model_id,
      }
    }
    return formatted
  }

  async updateSystemSettings(payload: Record<string, any>) {
    const upsert = async (key: string, value: string) => {
      await this.prisma.systemSetting.upsert({
        where: { key },
        update: { value },
        create: { key, value },
      })
    }

    const updates: Array<Promise<unknown>> = []
    const assignIfNumber = (field: string, value: unknown) => {
      if (typeof value === 'number') {
        updates.push(upsert(field, String(value)))
      }
    }

    if (typeof payload.registration_enabled === 'boolean') {
      updates.push(upsert('registration_enabled', String(payload.registration_enabled)))
    }
    if (typeof payload.brand_text === 'string') {
      updates.push(upsert('brand_text', payload.brand_text))
      this.invalidateBrandingCache()
    }

    assignIfNumber('sse_heartbeat_interval_ms', payload.sse_heartbeat_interval_ms)
    assignIfNumber('provider_max_idle_ms', payload.provider_max_idle_ms)
    assignIfNumber('provider_timeout_ms', payload.provider_timeout_ms)
    assignIfNumber('provider_initial_grace_ms', payload.provider_initial_grace_ms)
    assignIfNumber('provider_reasoning_idle_ms', payload.provider_reasoning_idle_ms)
    assignIfNumber('reasoning_keepalive_interval_ms', payload.reasoning_keepalive_interval_ms)
    assignIfNumber('stream_delta_flush_interval_ms', payload.stream_delta_flush_interval_ms)
    assignIfNumber('stream_reasoning_flush_interval_ms', payload.stream_reasoning_flush_interval_ms)
    assignIfNumber('stream_keepalive_interval_ms', payload.stream_keepalive_interval_ms)
    assignIfNumber('stream_delta_chunk_size', payload.stream_delta_chunk_size)
    assignIfNumber('chat_image_retention_days', payload.chat_image_retention_days)
    assignIfNumber('assistant_reply_history_limit', payload.assistant_reply_history_limit)
    assignIfNumber('web_search_result_limit', payload.web_search_result_limit)
    assignIfNumber('agent_max_tool_iterations', payload.agent_max_tool_iterations)
    assignIfNumber('python_tool_timeout_ms', payload.python_tool_timeout_ms)
    assignIfNumber('python_tool_max_output_chars', payload.python_tool_max_output_chars)
    assignIfNumber('python_tool_max_source_chars', payload.python_tool_max_source_chars)
    assignIfNumber('task_trace_retention_days', payload.task_trace_retention_days)
    assignIfNumber('task_trace_max_events', payload.task_trace_max_events)
    assignIfNumber('task_trace_idle_timeout_ms', payload.task_trace_idle_timeout_ms)
    assignIfNumber('chat_max_concurrent_streams', payload.chat_max_concurrent_streams)
    assignIfNumber('title_summary_max_length', payload.title_summary_max_length)
    assignIfNumber('title_summary_connection_id', payload.title_summary_connection_id)
    // RAG 数字字段
    assignIfNumber('rag_top_k', payload.rag_top_k)
    assignIfNumber('rag_relevance_threshold', payload.rag_relevance_threshold)
    assignIfNumber('rag_max_context_tokens', payload.rag_max_context_tokens)
    assignIfNumber('rag_chunk_size', payload.rag_chunk_size)
    assignIfNumber('rag_chunk_overlap', payload.rag_chunk_overlap)
    assignIfNumber('rag_max_file_size_mb', payload.rag_max_file_size_mb)
    assignIfNumber('rag_max_pages', payload.rag_max_pages)
    assignIfNumber('rag_retention_days', payload.rag_retention_days)
    assignIfNumber('rag_embedding_batch_size', payload.rag_embedding_batch_size)
    assignIfNumber('rag_embedding_concurrency', payload.rag_embedding_concurrency)

    const boolFields = [
      'usage_emit',
      'usage_provider_only',
      'reasoning_enabled',
      'reasoning_default_expand',
      'reasoning_save_to_db',
      'ollama_think',
      'battle_allow_anonymous',
      'battle_allow_users',
      'web_search_agent_enable',
      'web_search_include_summary',
      'web_search_include_raw',
      'python_tool_enable',
      'task_trace_enabled',
      'task_trace_default_on',
      'task_trace_admin_only',
      'title_summary_enabled',
      'rag_enabled',
      'knowledge_base_enabled',
      'knowledge_base_allow_anonymous',
      'knowledge_base_allow_users',
    ] as const
    boolFields.forEach((key) => {
      if (typeof payload[key] === 'boolean') {
        updates.push(upsert(key, String(payload[key])))
      }
    })

    const accessDefaults: Array<{ key: 'model_access_default_anonymous' | 'model_access_default_user'; value: unknown }> = [
      { key: 'model_access_default_anonymous', value: payload.model_access_default_anonymous },
      { key: 'model_access_default_user', value: payload.model_access_default_user },
    ]
    accessDefaults.forEach(({ key, value }) => {
      if (value === undefined) return
      if (value !== 'allow' && value !== 'deny') {
        throw new SettingsServiceError('model access default must be allow or deny', 400)
      }
      updates.push(upsert(key, value))
      this.invalidateModelAccessDefaultsCache()
    })

    const stringFields: Array<{ key: string; value?: unknown }> = [
      { key: 'reasoning_tags_mode', value: payload.reasoning_tags_mode },
      { key: 'reasoning_custom_tags', value: payload.reasoning_custom_tags },
      { key: 'openai_reasoning_effort', value: payload.openai_reasoning_effort },
      { key: 'site_base_url', value: payload.site_base_url },
      { key: 'chat_system_prompt', value: payload.chat_system_prompt },
      { key: 'web_search_default_engine', value: payload.web_search_default_engine },
      { key: 'web_search_api_key_tavily', value: payload.web_search_api_key_tavily },
      { key: 'web_search_api_key_brave', value: payload.web_search_api_key_brave },
      { key: 'web_search_api_key_metaso', value: payload.web_search_api_key_metaso },
      { key: 'web_search_domain_filter', value: Array.isArray(payload.web_search_domain_filter) ? JSON.stringify(payload.web_search_domain_filter) : undefined },
      { key: 'web_search_scope', value: payload.web_search_scope },
      { key: 'python_tool_command', value: payload.python_tool_command },
      { key: 'python_tool_args', value: Array.isArray(payload.python_tool_args) ? JSON.stringify(payload.python_tool_args) : undefined },
      { key: 'task_trace_env', value: payload.task_trace_env },
      { key: 'title_summary_model_source', value: payload.title_summary_model_source },
      { key: 'title_summary_model_id', value: payload.title_summary_model_id },
      { key: 'rag_embedding_model_id', value: payload.rag_embedding_model_id },
    ]
    stringFields.forEach(({ key, value }) => {
      if (typeof value === 'string') {
        updates.push(upsert(key, value))
      }
    })

    // RAG embedding connection ID (需要特殊处理 null 值)
    if (typeof payload.rag_embedding_connection_id === 'number') {
      updates.push(upsert('rag_embedding_connection_id', String(payload.rag_embedding_connection_id)))
    } else if (payload.rag_embedding_connection_id === null) {
      updates.push(upsert('rag_embedding_connection_id', ''))
    }

    if (typeof payload.anonymous_retention_days === 'number') {
      updates.push(upsert('anonymous_retention_days', String(payload.anonymous_retention_days)))
      this.invalidateQuotaPolicyCache()
    }
    if (typeof payload.anonymous_daily_quota === 'number') {
      updates.push(upsert('anonymous_daily_quota', String(payload.anonymous_daily_quota)))
      this.invalidateQuotaPolicyCache()
    }
    if (typeof payload.default_user_daily_quota === 'number') {
      updates.push(upsert('default_user_daily_quota', String(payload.default_user_daily_quota)))
      this.invalidateQuotaPolicyCache()
    }
    if (typeof payload.battle_anonymous_daily_quota === 'number') {
      updates.push(upsert('battle_anonymous_daily_quota', String(payload.battle_anonymous_daily_quota)))
      this.invalidateBattlePolicyCache()
    }
    if (typeof payload.battle_user_daily_quota === 'number') {
      updates.push(upsert('battle_user_daily_quota', String(payload.battle_user_daily_quota)))
      this.invalidateBattlePolicyCache()
    }

    if (payload.assistant_avatar) {
      let storedPath: string | null
      try {
        storedPath = await this.replaceProfileImage(payload.assistant_avatar, { currentPath: undefined })
      } catch (error) {
        throw new SettingsServiceError('Invalid assistant avatar payload', 400)
      }
      if (storedPath) {
        updates.push(upsert('assistant_avatar_path', storedPath))
      }
    }
    if (payload.assistant_avatar === null) {
      updates.push(upsert('assistant_avatar_path', ''))
    }

    if (typeof payload.reasoning_max_output_tokens_default === 'number') {
      updates.push(
        upsert('reasoning_max_output_tokens_default', String(payload.reasoning_max_output_tokens_default)),
      )
      this.invalidateReasoningMaxOutputTokensDefaultCache()
    } else if (payload.reasoning_max_output_tokens_default === null) {
      updates.push(this.prisma.systemSetting.deleteMany({ where: { key: 'reasoning_max_output_tokens_default' } }))
      this.invalidateReasoningMaxOutputTokensDefaultCache()
    }

    await Promise.all(updates)

    if (payload.reset_quota_cache) {
      this.invalidateQuotaPolicyCache()
      await this.syncSharedAnonymousQuota()
    }
    if (payload.battle_allow_anonymous !== undefined || payload.battle_allow_users !== undefined) {
      this.invalidateBattlePolicyCache()
    }
    if (payload.reset_reasoning_tokens_cache) {
      this.invalidateReasoningMaxOutputTokensDefaultCache()
    }
    if (
      payload.task_trace_enabled !== undefined ||
      payload.task_trace_default_on !== undefined ||
      payload.task_trace_admin_only !== undefined ||
      payload.task_trace_env !== undefined
    ) {
      this.invalidateTaskTraceConfig()
    }
  }

  private parseBoolean(value: unknown, fallback: string | undefined) {
    if (typeof value === 'boolean') return value
    if (typeof value === 'string') {
      return value.toLowerCase() === 'true'
    }
    return (fallback || '').toLowerCase() === 'true'
  }

  private parseIntInRange(value: unknown, fallback: string | undefined, min: number, max: number, defaultValue: number) {
    const parsed = Number.parseInt(String(value ?? fallback ?? ''), 10)
    if (Number.isFinite(parsed)) {
      return Math.max(min, Math.min(max, parsed))
    }
    return defaultValue
  }

  private parseFloat(value: unknown, defaultValue: number) {
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string') {
      const parsed = Number.parseFloat(value)
      if (Number.isFinite(parsed)) return parsed
    }
    return defaultValue
  }

  private parseDomainFilter(raw: unknown) {
    if (typeof raw === 'string' && raw.trim() !== '') {
      try {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) {
          return parsed
            .map((item) => (typeof item === 'string' ? item.trim() : ''))
            .filter(Boolean)
        }
      } catch {}
    }
    return []
  }

  private parseTaskTraceEnv(value?: string | null) {
    const normalized = (value || '').toLowerCase()
    if (normalized === 'both' || normalized === 'prod') {
      return normalized
    }
    return 'dev'
  }
}
