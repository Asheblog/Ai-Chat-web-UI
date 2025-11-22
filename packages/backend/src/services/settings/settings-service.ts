import type { PrismaClient, Prisma } from '@prisma/client'
import { prisma as defaultPrisma } from '../../db'
import {
  getQuotaPolicy as defaultGetQuotaPolicy,
  invalidateQuotaPolicyCache as defaultInvalidateQuotaPolicyCache,
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
  invalidateQuotaPolicyCache?: typeof defaultInvalidateQuotaPolicyCache
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
  private invalidateQuotaPolicyCache: typeof defaultInvalidateQuotaPolicyCache
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
    this.invalidateQuotaPolicyCache = deps.invalidateQuotaPolicyCache ?? defaultInvalidateQuotaPolicyCache
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

  async getSystemSettings(actor: Actor) {
    const isAdmin = actor.type === 'user' && actor.role === 'ADMIN'
    const rows = await this.prisma.systemSetting.findMany()
    const map = new Map(rows.map((row) => [row.key, row.value]))
    const read = (key: string, fallback = '') => map.get(key) ?? fallback
    const quotaPolicy = await this.getQuotaPolicy()
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
      web_search_agent_enable: this.parseBoolean(settingsObj.web_search_agent_enable, process.env.WEB_SEARCH_AGENT_ENABLE || 'false'),
      web_search_default_engine: settingsObj.web_search_default_engine || process.env.WEB_SEARCH_DEFAULT_ENGINE || 'tavily',
      web_search_result_limit: this.parseIntInRange(settingsObj.web_search_result_limit, process.env.WEB_SEARCH_RESULT_LIMIT, 1, 10, 4),
      web_search_domain_filter: this.parseDomainFilter(settingsObj.web_search_domain_filter),
      web_search_has_api_key: Boolean(settingsObj.web_search_api_key || process.env.WEB_SEARCH_API_KEY),
      task_trace_enabled: this.parseBoolean(settingsObj.task_trace_enabled, 'false'),
      task_trace_default_on: this.parseBoolean(settingsObj.task_trace_default_on, 'false'),
      task_trace_admin_only: !this.parseBoolean(settingsObj.task_trace_admin_only, 'false'),
      task_trace_env: this.parseTaskTraceEnv(settingsObj.task_trace_env),
      task_trace_retention_days: this.parseIntInRange(settingsObj.task_trace_retention_days, process.env.TASK_TRACE_RETENTION_DAYS, 1, 365, 7),
      task_trace_max_events: this.parseIntInRange(settingsObj.task_trace_max_events, process.env.TASK_TRACE_MAX_EVENTS, 100, 200000, 2000),
      task_trace_idle_timeout_ms: this.parseIntInRange(settingsObj.task_trace_idle_timeout_ms, process.env.TASK_TRACE_IDLE_TIMEOUT_MS, 1000, 600000, 30000),
      assistant_avatar_url: null as string | null,
      assistant_avatar_path: settingsObj.assistant_avatar_path || null,
      model_access_default_anonymous: parseAccessDefault(map.get('model_access_default_anonymous'), 'deny'),
      model_access_default_user: parseAccessDefault(map.get('model_access_default_user'), 'allow'),
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
        model_access_default_anonymous: formatted.model_access_default_anonymous,
        model_access_default_user: formatted.model_access_default_user,
        web_search_agent_enable: formatted.web_search_agent_enable,
        web_search_default_engine: formatted.web_search_default_engine,
        web_search_result_limit: formatted.web_search_result_limit,
        web_search_domain_filter: formatted.web_search_domain_filter,
        web_search_has_api_key: formatted.web_search_has_api_key,
        assistant_avatar_url: formatted.assistant_avatar_url,
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
    assignIfNumber('task_trace_retention_days', payload.task_trace_retention_days)
    assignIfNumber('task_trace_max_events', payload.task_trace_max_events)
    assignIfNumber('task_trace_idle_timeout_ms', payload.task_trace_idle_timeout_ms)

    const boolFields = [
      'usage_emit',
      'usage_provider_only',
      'reasoning_enabled',
      'reasoning_default_expand',
      'reasoning_save_to_db',
      'ollama_think',
      'web_search_agent_enable',
      'task_trace_enabled',
      'task_trace_default_on',
      'task_trace_admin_only',
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
      { key: 'web_search_default_engine', value: payload.web_search_default_engine },
      { key: 'web_search_api_key', value: payload.web_search_api_key },
      { key: 'web_search_domain_filter', value: Array.isArray(payload.web_search_domain_filter) ? JSON.stringify(payload.web_search_domain_filter) : undefined },
      { key: 'task_trace_env', value: payload.task_trace_env },
    ]
    stringFields.forEach(({ key, value }) => {
      if (typeof value === 'string') {
        updates.push(upsert(key, value))
      }
    })

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
