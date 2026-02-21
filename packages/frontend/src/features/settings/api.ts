import { apiHttpClient } from '@/lib/api'
import type { ApiResponse, PythonRuntimeStatus, SystemSettings } from '@/types'

const client = apiHttpClient

type ImageUploadPayload = {
  data: string
  mime: string
}

export const getSystemSettings = async () => {
  const settingsRes = await client.get<
    ApiResponse<Record<string, unknown>>
  >('/settings/system')

  const parseOptionalInt = (value: unknown): number | undefined => {
    if (value === null || typeof value === 'undefined') return undefined
    if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (trimmed === '') return undefined
      const parsed = Number.parseInt(trimmed, 10)
      if (Number.isFinite(parsed)) return parsed
    }
    return undefined
  }

  const raw: any = settingsRes.data.data || {}
  const allowRegistration = !!raw.registration_enabled
  const brandText = raw.brand_text || 'AIChat'
  const sseHeartbeatIntervalMs = Number(raw.sse_heartbeat_interval_ms ?? 15000)
  const providerMaxIdleMs = Number(raw.provider_max_idle_ms ?? 60000)
  const providerTimeoutMs = Number(raw.provider_timeout_ms ?? 300000)
  const providerInitialGraceMs = Number(raw.provider_initial_grace_ms ?? 120000)
  const providerReasoningIdleMs = Number(raw.provider_reasoning_idle_ms ?? 300000)
  const reasoningKeepaliveIntervalMs = Number(raw.reasoning_keepalive_interval_ms ?? 0)
  const usageEmit = (raw.usage_emit ?? true) as boolean
  const usageProviderOnly = (raw.usage_provider_only ?? false) as boolean
  const reasoningEnabled = (raw.reasoning_enabled ?? true) as boolean
  const reasoningDefaultExpand = (raw.reasoning_default_expand ?? false) as boolean
  const reasoningSaveToDb = (raw.reasoning_save_to_db ?? true) as boolean
  const reasoningTagsMode = (raw.reasoning_tags_mode ?? 'default') as any
  const reasoningCustomTags = (raw.reasoning_custom_tags ?? '') as string
  const streamDeltaChunkSize = Number(raw.stream_delta_chunk_size ?? 1)
  const streamDeltaFlushIntervalMs = (() => {
    const parsed = parseOptionalInt(raw.stream_delta_flush_interval_ms)
    return typeof parsed === 'number' ? Math.max(0, parsed) : undefined
  })()
  const streamReasoningFlushIntervalMs = (() => {
    const parsed = parseOptionalInt(raw.stream_reasoning_flush_interval_ms)
    return typeof parsed === 'number' ? Math.max(0, parsed) : undefined
  })()
  const streamKeepaliveIntervalMs = (() => {
    const parsed = parseOptionalInt(raw.stream_keepalive_interval_ms)
    return typeof parsed === 'number' ? Math.max(0, parsed) : undefined
  })()
  const openaiReasoningEffort = (raw.openai_reasoning_effort ?? '') as any
  const reasoningMaxOutputTokensDefault = (() => {
    const parsed = parseOptionalInt(raw.reasoning_max_output_tokens_default as any)
    if (typeof parsed === 'number' && parsed > 0) {
      return Math.min(256000, parsed)
    }
    return undefined
  })()
  const temperatureDefault = (() => {
    const value = raw.temperature_default
    if (typeof value === 'number' && Number.isFinite(value)) {
      return Math.max(0, Math.min(2, value))
    }
    if (typeof value === 'string' && value.trim() !== '') {
      const parsed = Number.parseFloat(value)
      if (Number.isFinite(parsed)) {
        return Math.max(0, Math.min(2, parsed))
      }
    }
    return undefined
  })()
  const ollamaThink = Boolean(raw.ollama_think ?? false)
  const chatImageRetentionDays = (() => {
    const v = raw.chat_image_retention_days
    if (typeof v === 'number') return v
    if (typeof v === 'string' && v.trim() !== '') {
      const parsed = Number.parseInt(v, 10)
      if (Number.isFinite(parsed) && parsed >= 0) return parsed
    }
    return 30
  })()
  const anonymousRetentionDays = (() => {
    const v = raw.anonymous_retention_days
    if (typeof v === 'number') return Math.max(0, Math.min(15, v))
    if (typeof v === 'string' && v.trim() !== '') {
      const parsed = Number.parseInt(v, 10)
      if (Number.isFinite(parsed)) {
        return Math.max(0, Math.min(15, parsed))
      }
    }
    return 15
  })()
  const anonymousDailyQuota = (() => {
    const v = raw.anonymous_daily_quota
    if (typeof v === 'number') return Math.max(0, v)
    if (typeof v === 'string' && v.trim() !== '') {
      const parsed = Number.parseInt(v, 10)
      if (Number.isFinite(parsed)) return Math.max(0, parsed)
    }
    return 20
  })()
  const defaultUserDailyQuota = (() => {
    const v = raw.default_user_daily_quota
    if (typeof v === 'number') return Math.max(0, v)
    if (typeof v === 'string' && v.trim() !== '') {
      const parsed = Number.parseInt(v, 10)
      if (Number.isFinite(parsed)) return Math.max(0, parsed)
    }
    return 200
  })()
  const battleAllowAnonymous = Boolean(raw.battle_allow_anonymous ?? true)
  const battleAllowUsers = Boolean(raw.battle_allow_users ?? true)
  const battleAnonymousDailyQuota = (() => {
    const v = raw.battle_anonymous_daily_quota
    if (typeof v === 'number') return Math.max(0, v)
    if (typeof v === 'string' && v.trim() !== '') {
      const parsed = Number.parseInt(v, 10)
      if (Number.isFinite(parsed)) return Math.max(0, parsed)
    }
    return 20
  })()
  const battleUserDailyQuota = (() => {
    const v = raw.battle_user_daily_quota
    if (typeof v === 'number') return Math.max(0, v)
    if (typeof v === 'string' && v.trim() !== '') {
      const parsed = Number.parseInt(v, 10)
      if (Number.isFinite(parsed)) return Math.max(0, parsed)
    }
    return 200
  })()
  const modelAccessDefaultAnonymous: 'allow' | 'deny' =
    raw.model_access_default_anonymous === 'allow' ? 'allow' : 'deny'
  const modelAccessDefaultUser: 'allow' | 'deny' =
    raw.model_access_default_user === 'deny' ? 'deny' : 'allow'
  const siteBaseUrl = typeof raw.site_base_url === 'string' ? raw.site_base_url : ''
  const webSearchAgentEnable = Boolean(raw.web_search_agent_enable ?? false)
  const webSearchDefaultEngine = raw.web_search_default_engine || 'tavily'
  const webSearchResultLimit = Number(raw.web_search_result_limit ?? 4)
  const webSearchDomainFilter = Array.isArray(raw.web_search_domain_filter)
    ? (raw.web_search_domain_filter as string[])
    : []
  const webSearchHasApiKey = Boolean(raw.web_search_has_api_key ?? false)
  const webSearchHasApiKeyTavily = Boolean(raw.web_search_has_api_key_tavily ?? webSearchHasApiKey)
  const webSearchHasApiKeyBrave = Boolean(raw.web_search_has_api_key_brave ?? webSearchHasApiKey)
  const webSearchHasApiKeyMetaso = Boolean(raw.web_search_has_api_key_metaso ?? webSearchHasApiKey)
  const aggregatedHasKey =
    webSearchHasApiKeyTavily || webSearchHasApiKeyBrave || webSearchHasApiKeyMetaso || webSearchHasApiKey
  const webSearchScope =
    typeof raw.web_search_scope === 'string'
      ? raw.web_search_scope
      : 'webpage'
  const webSearchIncludeSummary = Boolean(raw.web_search_include_summary ?? false)
  const webSearchIncludeRaw = Boolean(raw.web_search_include_raw ?? false)
  const pythonToolEnable = Boolean(raw.python_tool_enable ?? false)
  const pythonToolTimeoutMs = (() => {
    const v = raw.python_tool_timeout_ms
    if (typeof v === 'number') return Math.max(1000, Math.min(60000, v))
    if (typeof v === 'string' && v.trim() !== '') {
      const parsed = Number.parseInt(v, 10)
      if (Number.isFinite(parsed)) return Math.max(1000, Math.min(60000, parsed))
    }
    return 8000
  })()
  const pythonToolMaxOutputChars = (() => {
    const v = raw.python_tool_max_output_chars
    if (typeof v === 'number') return Math.max(256, Math.min(20000, v))
    if (typeof v === 'string' && v.trim() !== '') {
      const parsed = Number.parseInt(v, 10)
      if (Number.isFinite(parsed)) return Math.max(256, Math.min(20000, parsed))
    }
    return 4000
  })()
  const pythonToolMaxSourceChars = (() => {
    const v = raw.python_tool_max_source_chars
    if (typeof v === 'number') return Math.max(256, Math.min(20000, v))
    if (typeof v === 'string' && v.trim() !== '') {
      const parsed = Number.parseInt(v, 10)
      if (Number.isFinite(parsed)) return Math.max(256, Math.min(20000, parsed))
    }
    return 4000
  })()
  const agentMaxToolIterations = (() => {
    const v = parseOptionalInt(raw.agent_max_tool_iterations)
    if (typeof v === 'number') {
      return Math.max(0, Math.min(20, v))
    }
    return 4
  })()
  const assistantAvatarUrl = (() => {
    const value = raw.assistant_avatar_url
    if (typeof value === 'string' && value.trim().length > 0) return value
    if (value === null) return null
    return null
  })()
  const chatSystemPrompt = typeof raw.chat_system_prompt === 'string' ? raw.chat_system_prompt : ''
  const taskTraceEnabled = Boolean(raw.task_trace_enabled ?? false)
  const taskTraceDefaultOn = Boolean(raw.task_trace_default_on ?? false)
  const taskTraceAdminOnly = (raw.task_trace_admin_only ?? true) as boolean
  const rawEnv = (raw.task_trace_env || '').toLowerCase()
  const taskTraceEnv: 'dev' | 'prod' | 'both' = rawEnv === 'prod' || rawEnv === 'both' ? (rawEnv as 'prod' | 'both') : 'dev'
  const taskTraceRetentionDays = (() => {
    const v = raw.task_trace_retention_days
    if (typeof v === 'number') return Math.max(1, Math.min(365, v))
    if (typeof v === 'string' && v.trim() !== '') {
      const parsed = Number.parseInt(v, 10)
      if (Number.isFinite(parsed)) return Math.max(1, Math.min(365, parsed))
    }
    return 7
  })()
  const taskTraceMaxEvents = (() => {
    const v = raw.task_trace_max_events
    if (typeof v === 'number') return Math.max(100, Math.min(200000, v))
    if (typeof v === 'string' && v.trim() !== '') {
      const parsed = Number.parseInt(v, 10)
      if (Number.isFinite(parsed)) return Math.max(100, Math.min(200000, parsed))
    }
    return 2000
  })()
  const taskTraceIdleTimeoutMs = (() => {
    const v = raw.task_trace_idle_timeout_ms
    if (typeof v === 'number') return Math.max(1000, Math.min(600000, v))
    if (typeof v === 'string' && v.trim() !== '') {
      const parsed = Number.parseInt(v, 10)
      if (Number.isFinite(parsed)) return Math.max(1000, Math.min(600000, parsed))
    }
    return 30000
  })()
  const chatMaxConcurrentStreams = (() => {
    const v = raw.chat_max_concurrent_streams
    if (typeof v === 'number') return Math.max(1, Math.min(8, v))
    if (typeof v === 'string' && v.trim() !== '') {
      const parsed = Number.parseInt(v, 10)
      if (Number.isFinite(parsed)) return Math.max(1, Math.min(8, parsed))
    }
    return 1
  })()
  // 标题智能总结设置
  const titleSummaryEnabled = Boolean(raw.title_summary_enabled ?? false)
  const titleSummaryMaxLength = (() => {
    const v = raw.title_summary_max_length
    if (typeof v === 'number') return Math.max(5, Math.min(50, v))
    if (typeof v === 'string' && v.trim() !== '') {
      const parsed = Number.parseInt(v, 10)
      if (Number.isFinite(parsed)) return Math.max(5, Math.min(50, parsed))
    }
    return 20
  })()
  const titleSummaryModelSource = (raw.title_summary_model_source === 'specified' ? 'specified' : 'current') as 'current' | 'specified'
  const titleSummaryConnectionId = (() => {
    const v = raw.title_summary_connection_id
    if (typeof v === 'number' && v > 0) return v
    return null
  })()
  const titleSummaryModelId = (() => {
    const v = raw.title_summary_model_id
    if (typeof v === 'string' && v.trim().length > 0) return v
    return null
  })()
  return {
    data: {
      allowRegistration,
      brandText,
      sseHeartbeatIntervalMs,
      providerMaxIdleMs,
      providerTimeoutMs,
      providerInitialGraceMs,
      providerReasoningIdleMs,
      reasoningKeepaliveIntervalMs,
      usageEmit,
      usageProviderOnly,
      reasoningEnabled,
      reasoningDefaultExpand,
      reasoningSaveToDb,
      reasoningTagsMode,
      reasoningCustomTags,
      streamDeltaChunkSize,
      streamDeltaFlushIntervalMs,
      streamReasoningFlushIntervalMs,
      streamKeepaliveIntervalMs,
      openaiReasoningEffort,
      reasoningMaxOutputTokensDefault,
      temperatureDefault,
      ollamaThink,
      chatImageRetentionDays,
      assistantReplyHistoryLimit: Number(raw.assistant_reply_history_limit ?? 5),
      siteBaseUrl,
      anonymousRetentionDays,
      anonymousDailyQuota,
      defaultUserDailyQuota,
      battleAllowAnonymous,
      battleAllowUsers,
      battleAnonymousDailyQuota,
      battleUserDailyQuota,
      modelAccessDefaultAnonymous,
      modelAccessDefaultUser,
      webSearchAgentEnable,
      webSearchDefaultEngine,
      webSearchResultLimit,
      webSearchDomainFilter,
      webSearchHasApiKey: aggregatedHasKey,
      webSearchHasApiKeyTavily,
      webSearchHasApiKeyBrave,
      webSearchHasApiKeyMetaso,
      webSearchScope,
      webSearchIncludeSummary,
      webSearchIncludeRaw,
      pythonToolEnable,
      pythonToolTimeoutMs,
      pythonToolMaxOutputChars,
      pythonToolMaxSourceChars,
      agentMaxToolIterations,
      assistantAvatarUrl,
      chatSystemPrompt,
      taskTraceEnabled,
      taskTraceDefaultOn,
      taskTraceAdminOnly,
      taskTraceEnv,
      taskTraceRetentionDays,
      taskTraceMaxEvents,
      taskTraceIdleTimeoutMs,
      chatMaxConcurrentStreams,
      titleSummaryEnabled,
      titleSummaryMaxLength,
      titleSummaryModelSource,
      titleSummaryConnectionId,
      titleSummaryModelId,
      // RAG 设置
      ragEnabled: Boolean(raw.rag_enabled ?? false),
      ragEmbeddingConnectionId: (() => {
        const v = raw.rag_embedding_connection_id
        if (typeof v === 'number' && v > 0) return v
        return null
      })(),
      ragEmbeddingModelId: (() => {
        const v = raw.rag_embedding_model_id
        if (typeof v === 'string' && v.trim().length > 0) return v
        return undefined
      })(),
      ragEmbeddingBatchSize: (() => {
        const v = raw.rag_embedding_batch_size
        if (typeof v === 'number') return Math.max(1, Math.min(128, v))
        return 1
      })(),
      ragEmbeddingConcurrency: (() => {
        const v = raw.rag_embedding_concurrency
        if (typeof v === 'number') return Math.max(1, Math.min(16, v))
        return 1
      })(),
      ragTopK: (() => {
        const v = raw.rag_top_k
        if (typeof v === 'number') return Math.max(1, Math.min(20, v))
        return 5
      })(),
      ragRelevanceThreshold: (() => {
        const v = raw.rag_relevance_threshold
        if (typeof v === 'number') return Math.max(0, Math.min(1, v))
        return 0.3
      })(),
      ragMaxContextTokens: (() => {
        const v = raw.rag_max_context_tokens
        if (typeof v === 'number') return Math.max(500, Math.min(32000, v))
        return 4000
      })(),
      ragChunkSize: (() => {
        const v = raw.rag_chunk_size
        if (typeof v === 'number') return Math.max(100, Math.min(8000, v))
        return 1500
      })(),
      ragChunkOverlap: (() => {
        const v = raw.rag_chunk_overlap
        if (typeof v === 'number') return Math.max(0, Math.min(1000, v))
        return 100
      })(),
      ragMaxFileSizeMb: (() => {
        const v = raw.rag_max_file_size_mb
        if (typeof v === 'number') return Math.max(1, Math.min(200, v))
        return 50
      })(),
      ragMaxPages: (() => {
        const v = raw.rag_max_pages
        if (typeof v === 'number') return Math.max(10, Math.min(1000, v))
        return 200
      })(),
      ragRetentionDays: (() => {
        const v = raw.rag_retention_days
        if (typeof v === 'number') return Math.max(1, Math.min(365, v))
        return 30
      })(),
      // 知识库设置
      knowledgeBaseEnabled: Boolean(raw.knowledge_base_enabled ?? false),
      knowledgeBaseAllowAnonymous: Boolean(raw.knowledge_base_allow_anonymous ?? false),
      knowledgeBaseAllowUsers: Boolean(raw.knowledge_base_allow_users ?? true),
    } as any,
  }
}

export const getPublicBranding = async () => {
  const response = await client.get<ApiResponse<{ brand_text?: string }>>('/settings/branding')
  return response.data
}

export const updateSystemSettings = async (
  settings: Partial<SystemSettings> & {
    assistantAvatarUpload?: ImageUploadPayload | null
    assistantAvatarRemove?: boolean
  },
) => {
  const { assistantAvatarUpload, assistantAvatarRemove, ...rest } = settings
  const payload: any = {}
  if (typeof rest.allowRegistration === 'boolean') payload.registration_enabled = !!rest.allowRegistration
  if (typeof rest.brandText === 'string') payload.brand_text = rest.brandText
  if (typeof rest.sseHeartbeatIntervalMs === 'number') payload.sse_heartbeat_interval_ms = rest.sseHeartbeatIntervalMs
  if (typeof rest.providerMaxIdleMs === 'number') payload.provider_max_idle_ms = rest.providerMaxIdleMs
  if (typeof rest.providerTimeoutMs === 'number') payload.provider_timeout_ms = rest.providerTimeoutMs
  if (typeof rest.providerInitialGraceMs === 'number') payload.provider_initial_grace_ms = rest.providerInitialGraceMs
  if (typeof rest.providerReasoningIdleMs === 'number') payload.provider_reasoning_idle_ms = rest.providerReasoningIdleMs
  if (typeof rest.reasoningKeepaliveIntervalMs === 'number') payload.reasoning_keepalive_interval_ms = rest.reasoningKeepaliveIntervalMs
  if (typeof rest.usageEmit === 'boolean') payload.usage_emit = !!rest.usageEmit
  if (typeof rest.usageProviderOnly === 'boolean') payload.usage_provider_only = !!rest.usageProviderOnly
  if (typeof rest.chatSystemPrompt === 'string') payload.chat_system_prompt = rest.chatSystemPrompt
  if (typeof rest.reasoningEnabled === 'boolean') payload.reasoning_enabled = !!rest.reasoningEnabled
  if (typeof rest.reasoningDefaultExpand === 'boolean') payload.reasoning_default_expand = !!rest.reasoningDefaultExpand
  if (typeof rest.reasoningSaveToDb === 'boolean') payload.reasoning_save_to_db = !!rest.reasoningSaveToDb
  if (typeof rest.reasoningTagsMode === 'string') payload.reasoning_tags_mode = rest.reasoningTagsMode
  if (typeof rest.reasoningCustomTags === 'string') payload.reasoning_custom_tags = rest.reasoningCustomTags
  if (typeof rest.streamDeltaChunkSize === 'number') payload.stream_delta_chunk_size = rest.streamDeltaChunkSize
  if (typeof rest.streamDeltaFlushIntervalMs === 'number') payload.stream_delta_flush_interval_ms = rest.streamDeltaFlushIntervalMs
  if (typeof rest.streamReasoningFlushIntervalMs === 'number') payload.stream_reasoning_flush_interval_ms = rest.streamReasoningFlushIntervalMs
  if (typeof rest.streamKeepaliveIntervalMs === 'number') payload.stream_keepalive_interval_ms = rest.streamKeepaliveIntervalMs
  if (typeof rest.openaiReasoningEffort === 'string') payload.openai_reasoning_effort = rest.openaiReasoningEffort
  if (Object.prototype.hasOwnProperty.call(rest, 'reasoningMaxOutputTokensDefault')) {
    if (typeof rest.reasoningMaxOutputTokensDefault === 'number') {
      payload.reasoning_max_output_tokens_default = rest.reasoningMaxOutputTokensDefault
    } else if (rest.reasoningMaxOutputTokensDefault === null) {
      payload.reasoning_max_output_tokens_default = null
    }
  }
  if (Object.prototype.hasOwnProperty.call(rest, 'temperatureDefault')) {
    if (typeof rest.temperatureDefault === 'number') {
      payload.temperature_default = rest.temperatureDefault
    } else if (rest.temperatureDefault === null) {
      payload.temperature_default = null
    }
  }
  if (typeof rest.ollamaThink === 'boolean') payload.ollama_think = !!rest.ollamaThink
  if (typeof rest.chatImageRetentionDays === 'number') payload.chat_image_retention_days = rest.chatImageRetentionDays
  if (typeof rest.assistantReplyHistoryLimit === 'number') payload.assistant_reply_history_limit = rest.assistantReplyHistoryLimit
  if (typeof rest.siteBaseUrl === 'string') payload.site_base_url = rest.siteBaseUrl
  if (typeof rest.anonymousRetentionDays === 'number') payload.anonymous_retention_days = rest.anonymousRetentionDays
  if (typeof rest.anonymousDailyQuota === 'number') payload.anonymous_daily_quota = rest.anonymousDailyQuota
  if (typeof rest.defaultUserDailyQuota === 'number') payload.default_user_daily_quota = rest.defaultUserDailyQuota
  if (typeof rest.battleAllowAnonymous === 'boolean') payload.battle_allow_anonymous = rest.battleAllowAnonymous
  if (typeof rest.battleAllowUsers === 'boolean') payload.battle_allow_users = rest.battleAllowUsers
  if (typeof rest.battleAnonymousDailyQuota === 'number') payload.battle_anonymous_daily_quota = rest.battleAnonymousDailyQuota
  if (typeof rest.battleUserDailyQuota === 'number') payload.battle_user_daily_quota = rest.battleUserDailyQuota
  if (typeof rest.modelAccessDefaultAnonymous === 'string')
    payload.model_access_default_anonymous = rest.modelAccessDefaultAnonymous
  if (typeof rest.modelAccessDefaultUser === 'string') payload.model_access_default_user = rest.modelAccessDefaultUser
  if (typeof rest.webSearchAgentEnable === 'boolean') payload.web_search_agent_enable = rest.webSearchAgentEnable
  if (typeof rest.webSearchDefaultEngine === 'string') payload.web_search_default_engine = rest.webSearchDefaultEngine
  if (typeof rest.webSearchResultLimit === 'number') payload.web_search_result_limit = rest.webSearchResultLimit
  if (Array.isArray(rest.webSearchDomainFilter)) payload.web_search_domain_filter = rest.webSearchDomainFilter
  if (typeof rest.webSearchScope === 'string') payload.web_search_scope = rest.webSearchScope
  if (typeof rest.webSearchIncludeSummary === 'boolean') payload.web_search_include_summary = rest.webSearchIncludeSummary
  if (typeof rest.webSearchIncludeRaw === 'boolean') payload.web_search_include_raw = rest.webSearchIncludeRaw
  if (typeof rest.pythonToolEnable === 'boolean') payload.python_tool_enable = rest.pythonToolEnable
  if (typeof rest.pythonToolTimeoutMs === 'number') payload.python_tool_timeout_ms = rest.pythonToolTimeoutMs
  if (typeof rest.pythonToolMaxOutputChars === 'number') payload.python_tool_max_output_chars = rest.pythonToolMaxOutputChars
  if (typeof rest.pythonToolMaxSourceChars === 'number') payload.python_tool_max_source_chars = rest.pythonToolMaxSourceChars
  if (typeof rest.agentMaxToolIterations === 'number') {
    const clamped = Math.max(0, Math.min(20, Math.round(rest.agentMaxToolIterations)))
    payload.agent_max_tool_iterations = clamped
  }
  if (typeof rest.webSearchApiKeyTavily === 'string') payload.web_search_api_key_tavily = rest.webSearchApiKeyTavily
  if (typeof rest.webSearchApiKeyBrave === 'string') payload.web_search_api_key_brave = rest.webSearchApiKeyBrave
  if (typeof rest.webSearchApiKeyMetaso === 'string') payload.web_search_api_key_metaso = rest.webSearchApiKeyMetaso
  if (typeof rest.taskTraceEnabled === 'boolean') payload.task_trace_enabled = rest.taskTraceEnabled
  if (typeof rest.taskTraceDefaultOn === 'boolean') payload.task_trace_default_on = rest.taskTraceDefaultOn
  if (typeof rest.taskTraceAdminOnly === 'boolean') payload.task_trace_admin_only = rest.taskTraceAdminOnly
  if (typeof rest.taskTraceEnv === 'string') payload.task_trace_env = rest.taskTraceEnv
  if (typeof rest.taskTraceRetentionDays === 'number') payload.task_trace_retention_days = rest.taskTraceRetentionDays
  if (typeof rest.taskTraceMaxEvents === 'number') payload.task_trace_max_events = rest.taskTraceMaxEvents
  if (typeof rest.taskTraceIdleTimeoutMs === 'number') payload.task_trace_idle_timeout_ms = rest.taskTraceIdleTimeoutMs
  if (typeof rest.chatMaxConcurrentStreams === 'number') {
    payload.chat_max_concurrent_streams = Math.max(1, Math.min(8, Math.floor(rest.chatMaxConcurrentStreams)))
  }
  // 标题智能总结设置
  if (typeof rest.titleSummaryEnabled === 'boolean') payload.title_summary_enabled = rest.titleSummaryEnabled
  if (typeof rest.titleSummaryMaxLength === 'number') {
    payload.title_summary_max_length = Math.max(5, Math.min(50, Math.floor(rest.titleSummaryMaxLength)))
  }
  if (typeof rest.titleSummaryModelSource === 'string') payload.title_summary_model_source = rest.titleSummaryModelSource
  if (Object.prototype.hasOwnProperty.call(rest, 'titleSummaryConnectionId')) {
    payload.title_summary_connection_id = rest.titleSummaryConnectionId ?? null
  }
  if (Object.prototype.hasOwnProperty.call(rest, 'titleSummaryModelId')) {
    payload.title_summary_model_id = rest.titleSummaryModelId ?? null
  }
  // RAG 设置
  if (typeof rest.ragEnabled === 'boolean') payload.rag_enabled = rest.ragEnabled
  if (Object.prototype.hasOwnProperty.call(rest, 'ragEmbeddingConnectionId')) {
    payload.rag_embedding_connection_id = rest.ragEmbeddingConnectionId ?? null
  }
  if (typeof rest.ragEmbeddingModelId === 'string') payload.rag_embedding_model_id = rest.ragEmbeddingModelId
  if (typeof rest.ragEmbeddingBatchSize === 'number') payload.rag_embedding_batch_size = rest.ragEmbeddingBatchSize
  if (typeof rest.ragEmbeddingConcurrency === 'number') payload.rag_embedding_concurrency = rest.ragEmbeddingConcurrency
  if (typeof rest.ragTopK === 'number') payload.rag_top_k = rest.ragTopK
  if (typeof rest.ragRelevanceThreshold === 'number') payload.rag_relevance_threshold = rest.ragRelevanceThreshold
  if (typeof rest.ragMaxContextTokens === 'number') payload.rag_max_context_tokens = rest.ragMaxContextTokens
  if (typeof rest.ragChunkSize === 'number') payload.rag_chunk_size = rest.ragChunkSize
  if (typeof rest.ragChunkOverlap === 'number') payload.rag_chunk_overlap = rest.ragChunkOverlap
  if (typeof rest.ragMaxFileSizeMb === 'number') payload.rag_max_file_size_mb = rest.ragMaxFileSizeMb
  if (typeof rest.ragMaxPages === 'number') payload.rag_max_pages = rest.ragMaxPages
  if (typeof rest.ragRetentionDays === 'number') payload.rag_retention_days = rest.ragRetentionDays
  // 知识库设置
  if (typeof rest.knowledgeBaseEnabled === 'boolean') payload.knowledge_base_enabled = rest.knowledgeBaseEnabled
  if (typeof rest.knowledgeBaseAllowAnonymous === 'boolean') payload.knowledge_base_allow_anonymous = rest.knowledgeBaseAllowAnonymous
  if (typeof rest.knowledgeBaseAllowUsers === 'boolean') payload.knowledge_base_allow_users = rest.knowledgeBaseAllowUsers
  if (assistantAvatarUpload) {
    payload.assistant_avatar = assistantAvatarUpload
  } else if (assistantAvatarRemove) {
    payload.assistant_avatar = null
  }
  await client.put<ApiResponse<any>>('/settings/system', payload)
  const current = await getSystemSettings()
  return current
}

export const updatePersonalSettings = async (
  settings: {
    preferredModel?: { modelId: string; connectionId: number | null; rawId: string | null } | null
    avatar?: ImageUploadPayload | null
    username?: string
    personalPrompt?: string | null
  },
  signal?: AbortSignal,
) => {
  const payload: any = {}
  if (Object.prototype.hasOwnProperty.call(settings, 'preferredModel')) {
    const pref = settings.preferredModel
    payload.preferred_model = pref
      ? {
          modelId: pref.modelId,
          connectionId: pref.connectionId,
          rawId: pref.rawId,
        }
      : null
  }
  if (Object.prototype.hasOwnProperty.call(settings, 'avatar')) {
    payload.avatar = settings.avatar ?? null
  }
  if (Object.prototype.hasOwnProperty.call(settings, 'username')) {
    payload.username = settings.username
  }
  if (Object.prototype.hasOwnProperty.call(settings, 'personalPrompt')) {
    payload.personal_prompt =
      typeof settings.personalPrompt === 'string' ? settings.personalPrompt : null
  }
  const response = await client.put<ApiResponse<any>>('/settings/personal', payload, { signal })
  return response.data?.data
}

export const syncAnonymousQuota = async (options?: { resetUsed?: boolean }) => {
  const response = await client.post<ApiResponse<any>>('/settings/system/anonymous-quota/reset', {
    resetUsed: options?.resetUsed ?? false,
  })
  return response.data
}

export const refreshImageAttachments = async () => {
  const res = await client.post<
    ApiResponse<{
      baseUrl: string
      attachments: number
      samples: Array<{ id: number; messageId: number; url: string }>
      refreshedAt: string
    }>
  >('/chat/admin/attachments/refresh')
  return res.data
}

export const getPythonRuntimeStatus = async () => {
  const response = await client.get<ApiResponse<PythonRuntimeStatus>>('/settings/python-runtime')
  return response.data
}

export const updatePythonRuntimeIndexes = async (payload: {
  indexUrl?: string
  extraIndexUrls?: string[]
  trustedHosts?: string[]
  autoInstallOnActivate?: boolean
}) => {
  const response = await client.put<ApiResponse>('/settings/python-runtime/indexes', payload)
  return response.data
}

export const installPythonRuntimeRequirements = async (payload: {
  requirements: string[]
  source: 'manual' | 'skill'
  skillId?: number
  versionId?: number
}) => {
  const response = await client.post<ApiResponse>('/settings/python-runtime/install', payload)
  return response.data
}

export const uninstallPythonRuntimePackages = async (payload: { packages: string[] }) => {
  const response = await client.post<ApiResponse>('/settings/python-runtime/uninstall', payload)
  return response.data
}

export const reconcilePythonRuntime = async () => {
  const response = await client.post<ApiResponse>('/settings/python-runtime/reconcile')
  return response.data
}
