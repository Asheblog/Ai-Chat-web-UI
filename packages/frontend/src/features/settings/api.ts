import { apiHttpClient } from '@/lib/api'
import { serializeSystemSettingsPatch } from '@aichat/shared'
import type {
  ApiResponse,
  PythonRuntimeStatus,
  SystemSettings,
  WebSearchBilingualMode,
  WebSearchEngine,
  WebSearchMergeStrategy,
} from '@/types'

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

  const parseWebSearchEngineList = (
    value: unknown,
    fallback: WebSearchEngine[],
  ): WebSearchEngine[] => {
    const normalize = (item: unknown): WebSearchEngine | null => {
      if (typeof item !== 'string') return null
      const lowered = item.trim().toLowerCase()
      if (lowered === 'tavily' || lowered === 'brave' || lowered === 'metaso') {
        return lowered
      }
      return null
    }

    let source: unknown[] = []
    if (Array.isArray(value)) {
      source = value
    } else if (typeof value === 'string') {
      const trimmed = value.trim()
      if (trimmed.startsWith('[')) {
        try {
          const parsed = JSON.parse(trimmed)
          if (Array.isArray(parsed)) source = parsed
        } catch {
          source = []
        }
      } else if (trimmed.length > 0) {
        source = trimmed.split(/[,\n]/)
      }
    }

    const normalized = Array.from(
      new Set(
        source
          .map((item) => normalize(item))
          .filter((item): item is WebSearchEngine => item !== null),
      ),
    )
    if (normalized.length === 0) return [...fallback]
    return normalized
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
  const contextCompressionEnabled = Boolean(raw.context_compression_enabled ?? true)
  const contextCompressionThresholdRatio = (() => {
    const value = raw.context_compression_threshold_ratio
    if (typeof value === 'number' && Number.isFinite(value)) {
      return Math.max(0.2, Math.min(0.9, value))
    }
    if (typeof value === 'string' && value.trim() !== '') {
      const parsed = Number.parseFloat(value)
      if (Number.isFinite(parsed)) return Math.max(0.2, Math.min(0.9, parsed))
    }
    return 0.5
  })()
  const contextCompressionTailMessages = (() => {
    const value = raw.context_compression_tail_messages
    if (typeof value === 'number' && Number.isFinite(value)) {
      return Math.max(4, Math.min(50, Math.floor(value)))
    }
    if (typeof value === 'string' && value.trim() !== '') {
      const parsed = Number.parseInt(value, 10)
      if (Number.isFinite(parsed)) return Math.max(4, Math.min(50, parsed))
    }
    return 12
  })()
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
  const battleRetentionDays = (() => {
    const v = raw.battle_retention_days
    if (typeof v === 'number') return Math.max(0, Math.min(3650, v))
    if (typeof v === 'string' && v.trim() !== '') {
      const parsed = Number.parseInt(v, 10)
      if (Number.isFinite(parsed)) return Math.max(0, Math.min(3650, parsed))
    }
    return 15
  })()
  const modelAccessDefaultAnonymous: 'allow' | 'deny' =
    raw.model_access_default_anonymous === 'allow' ? 'allow' : 'deny'
  const modelAccessDefaultUser: 'allow' | 'deny' =
    raw.model_access_default_user === 'deny' ? 'deny' : 'allow'
  const siteBaseUrl = typeof raw.site_base_url === 'string' ? raw.site_base_url : ''
  const webSearchAgentEnable = Boolean(raw.web_search_agent_enable ?? false)
  const webSearchEnabledEngines = parseWebSearchEngineList(
    raw.web_search_enabled_engines,
    ['tavily'],
  )
  const webSearchEngineOrderRaw = parseWebSearchEngineList(
    raw.web_search_engine_order,
    webSearchEnabledEngines,
  )
  const webSearchEngineOrder = [
    ...webSearchEngineOrderRaw.filter((engine) => webSearchEnabledEngines.includes(engine)),
    ...webSearchEnabledEngines.filter((engine) => !webSearchEngineOrderRaw.includes(engine)),
  ]
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
  const webSearchParallelMaxEngines = (() => {
    const parsed = parseOptionalInt(raw.web_search_parallel_max_engines)
    return typeof parsed === 'number' ? Math.max(1, Math.min(3, parsed)) : 3
  })()
  const webSearchParallelMaxQueriesPerCall = (() => {
    const parsed = parseOptionalInt(raw.web_search_parallel_max_queries_per_call)
    return typeof parsed === 'number' ? Math.max(1, Math.min(3, parsed)) : 2
  })()
  const webSearchParallelTimeoutMs = (() => {
    const parsed = parseOptionalInt(raw.web_search_parallel_timeout_ms)
    return typeof parsed === 'number' ? Math.max(1000, Math.min(120000, parsed)) : 12000
  })()
  const webSearchParallelMergeStrategy: WebSearchMergeStrategy =
    raw.web_search_parallel_merge_strategy === 'hybrid_score_v1'
      ? 'hybrid_score_v1'
      : 'hybrid_score_v1'
  const webSearchAutoBilingual = Boolean(raw.web_search_auto_bilingual ?? true)
  const webSearchAutoBilingualMode: WebSearchBilingualMode =
    raw.web_search_auto_bilingual_mode === 'off' || raw.web_search_auto_bilingual_mode === 'always'
      ? raw.web_search_auto_bilingual_mode
      : 'conditional'
  const webSearchAutoReadParallelism = (() => {
    const parsed = parseOptionalInt(raw.web_search_auto_read_parallelism)
    return typeof parsed === 'number' ? Math.max(1, Math.min(4, parsed)) : 2
  })()
  const pythonToolEnable = Boolean(raw.python_tool_enable ?? false)
  const chatDynamicSkillRuntimeEnabled = Boolean(raw.chat_dynamic_skill_runtime_enabled ?? false)
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
      contextCompressionEnabled,
      contextCompressionThresholdRatio,
      contextCompressionTailMessages,
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
      battleRetentionDays,
      modelAccessDefaultAnonymous,
      modelAccessDefaultUser,
      webSearchAgentEnable,
      webSearchEnabledEngines,
      webSearchEngineOrder,
      webSearchResultLimit,
      webSearchDomainFilter,
      webSearchHasApiKey: aggregatedHasKey,
      webSearchHasApiKeyTavily,
      webSearchHasApiKeyBrave,
      webSearchHasApiKeyMetaso,
      webSearchScope,
      webSearchIncludeSummary,
      webSearchIncludeRaw,
      webSearchParallelMaxEngines,
      webSearchParallelMaxQueriesPerCall,
      webSearchParallelTimeoutMs,
      webSearchParallelMergeStrategy,
      webSearchAutoBilingual,
      webSearchAutoBilingualMode,
      webSearchAutoReadParallelism,
      pythonToolEnable,
      chatDynamicSkillRuntimeEnabled,
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
  const patch: Record<string, unknown> = {}
  if (typeof rest.allowRegistration === 'boolean') patch.allowRegistration = !!rest.allowRegistration
  if (typeof rest.brandText === 'string') patch.brandText = rest.brandText
  if (typeof rest.sseHeartbeatIntervalMs === 'number') patch.sseHeartbeatIntervalMs = rest.sseHeartbeatIntervalMs
  if (typeof rest.providerMaxIdleMs === 'number') patch.providerMaxIdleMs = rest.providerMaxIdleMs
  if (typeof rest.providerTimeoutMs === 'number') patch.providerTimeoutMs = rest.providerTimeoutMs
  if (typeof rest.providerInitialGraceMs === 'number') patch.providerInitialGraceMs = rest.providerInitialGraceMs
  if (typeof rest.providerReasoningIdleMs === 'number') patch.providerReasoningIdleMs = rest.providerReasoningIdleMs
  if (typeof rest.reasoningKeepaliveIntervalMs === 'number') patch.reasoningKeepaliveIntervalMs = rest.reasoningKeepaliveIntervalMs
  if (typeof rest.usageEmit === 'boolean') patch.usageEmit = !!rest.usageEmit
  if (typeof rest.usageProviderOnly === 'boolean') patch.usageProviderOnly = !!rest.usageProviderOnly
  if (typeof rest.contextCompressionEnabled === 'boolean') patch.contextCompressionEnabled = !!rest.contextCompressionEnabled
  if (typeof rest.contextCompressionThresholdRatio === 'number') patch.contextCompressionThresholdRatio = rest.contextCompressionThresholdRatio
  if (typeof rest.contextCompressionTailMessages === 'number') patch.contextCompressionTailMessages = rest.contextCompressionTailMessages
  if (typeof rest.chatSystemPrompt === 'string') patch.chatSystemPrompt = rest.chatSystemPrompt
  if (typeof rest.reasoningEnabled === 'boolean') patch.reasoningEnabled = !!rest.reasoningEnabled
  if (typeof rest.reasoningDefaultExpand === 'boolean') patch.reasoningDefaultExpand = !!rest.reasoningDefaultExpand
  if (typeof rest.reasoningSaveToDb === 'boolean') patch.reasoningSaveToDb = !!rest.reasoningSaveToDb
  if (typeof rest.reasoningTagsMode === 'string') patch.reasoningTagsMode = rest.reasoningTagsMode
  if (typeof rest.reasoningCustomTags === 'string') patch.reasoningCustomTags = rest.reasoningCustomTags
  if (typeof rest.streamDeltaChunkSize === 'number') patch.streamDeltaChunkSize = rest.streamDeltaChunkSize
  if (typeof rest.streamDeltaFlushIntervalMs === 'number') patch.streamDeltaFlushIntervalMs = rest.streamDeltaFlushIntervalMs
  if (typeof rest.streamReasoningFlushIntervalMs === 'number') patch.streamReasoningFlushIntervalMs = rest.streamReasoningFlushIntervalMs
  if (typeof rest.streamKeepaliveIntervalMs === 'number') patch.streamKeepaliveIntervalMs = rest.streamKeepaliveIntervalMs
  if (typeof rest.openaiReasoningEffort === 'string') patch.openaiReasoningEffort = rest.openaiReasoningEffort
  if (Object.prototype.hasOwnProperty.call(rest, 'reasoningMaxOutputTokensDefault')) {
    if (typeof rest.reasoningMaxOutputTokensDefault === 'number') {
      patch.reasoningMaxOutputTokensDefault = rest.reasoningMaxOutputTokensDefault
    } else if (rest.reasoningMaxOutputTokensDefault === null) {
      patch.reasoningMaxOutputTokensDefault = null
    }
  }
  if (Object.prototype.hasOwnProperty.call(rest, 'temperatureDefault')) {
    if (typeof rest.temperatureDefault === 'number') {
      patch.temperatureDefault = rest.temperatureDefault
    } else if (rest.temperatureDefault === null) {
      patch.temperatureDefault = null
    }
  }
  if (typeof rest.ollamaThink === 'boolean') patch.ollamaThink = !!rest.ollamaThink
  if (typeof rest.chatImageRetentionDays === 'number') patch.chatImageRetentionDays = rest.chatImageRetentionDays
  if (typeof rest.assistantReplyHistoryLimit === 'number') patch.assistantReplyHistoryLimit = rest.assistantReplyHistoryLimit
  if (typeof rest.siteBaseUrl === 'string') patch.siteBaseUrl = rest.siteBaseUrl
  if (typeof rest.anonymousRetentionDays === 'number') patch.anonymousRetentionDays = rest.anonymousRetentionDays
  if (typeof rest.anonymousDailyQuota === 'number') patch.anonymousDailyQuota = rest.anonymousDailyQuota
  if (typeof rest.defaultUserDailyQuota === 'number') patch.defaultUserDailyQuota = rest.defaultUserDailyQuota
  if (typeof rest.battleAllowAnonymous === 'boolean') patch.battleAllowAnonymous = rest.battleAllowAnonymous
  if (typeof rest.battleAllowUsers === 'boolean') patch.battleAllowUsers = rest.battleAllowUsers
  if (typeof rest.battleAnonymousDailyQuota === 'number') patch.battleAnonymousDailyQuota = rest.battleAnonymousDailyQuota
  if (typeof rest.battleUserDailyQuota === 'number') patch.battleUserDailyQuota = rest.battleUserDailyQuota
  if (typeof rest.battleRetentionDays === 'number') patch.battleRetentionDays = rest.battleRetentionDays
  if (typeof rest.modelAccessDefaultAnonymous === 'string')
    patch.modelAccessDefaultAnonymous = rest.modelAccessDefaultAnonymous
  if (typeof rest.modelAccessDefaultUser === 'string') patch.modelAccessDefaultUser = rest.modelAccessDefaultUser
  if (typeof rest.webSearchAgentEnable === 'boolean') patch.webSearchAgentEnable = rest.webSearchAgentEnable
  if (Array.isArray(rest.webSearchEnabledEngines)) patch.webSearchEnabledEngines = rest.webSearchEnabledEngines
  if (Array.isArray(rest.webSearchEngineOrder)) patch.webSearchEngineOrder = rest.webSearchEngineOrder
  if (typeof rest.webSearchResultLimit === 'number') patch.webSearchResultLimit = rest.webSearchResultLimit
  if (Array.isArray(rest.webSearchDomainFilter)) patch.webSearchDomainFilter = rest.webSearchDomainFilter
  if (typeof rest.webSearchScope === 'string') patch.webSearchScope = rest.webSearchScope
  if (typeof rest.webSearchIncludeSummary === 'boolean') patch.webSearchIncludeSummary = rest.webSearchIncludeSummary
  if (typeof rest.webSearchIncludeRaw === 'boolean') patch.webSearchIncludeRaw = rest.webSearchIncludeRaw
  if (typeof rest.webSearchParallelMaxEngines === 'number') patch.webSearchParallelMaxEngines = rest.webSearchParallelMaxEngines
  if (typeof rest.webSearchParallelMaxQueriesPerCall === 'number') {
    patch.webSearchParallelMaxQueriesPerCall = rest.webSearchParallelMaxQueriesPerCall
  }
  if (typeof rest.webSearchParallelTimeoutMs === 'number') patch.webSearchParallelTimeoutMs = rest.webSearchParallelTimeoutMs
  if (typeof rest.webSearchParallelMergeStrategy === 'string') {
    patch.webSearchParallelMergeStrategy = rest.webSearchParallelMergeStrategy
  }
  if (typeof rest.webSearchAutoBilingual === 'boolean') patch.webSearchAutoBilingual = rest.webSearchAutoBilingual
  if (typeof rest.webSearchAutoBilingualMode === 'string') patch.webSearchAutoBilingualMode = rest.webSearchAutoBilingualMode
  if (typeof rest.webSearchAutoReadParallelism === 'number') {
    patch.webSearchAutoReadParallelism = rest.webSearchAutoReadParallelism
  }
  if (typeof rest.pythonToolEnable === 'boolean') patch.pythonToolEnable = rest.pythonToolEnable
  if (typeof rest.chatDynamicSkillRuntimeEnabled === 'boolean') {
    patch.chatDynamicSkillRuntimeEnabled = rest.chatDynamicSkillRuntimeEnabled
  }
  if (typeof rest.pythonToolTimeoutMs === 'number') patch.pythonToolTimeoutMs = rest.pythonToolTimeoutMs
  if (typeof rest.pythonToolMaxOutputChars === 'number') patch.pythonToolMaxOutputChars = rest.pythonToolMaxOutputChars
  if (typeof rest.pythonToolMaxSourceChars === 'number') patch.pythonToolMaxSourceChars = rest.pythonToolMaxSourceChars
  if (typeof rest.agentMaxToolIterations === 'number') {
    const clamped = Math.max(0, Math.min(20, Math.round(rest.agentMaxToolIterations)))
    patch.agentMaxToolIterations = clamped
  }
  if (typeof rest.webSearchApiKeyTavily === 'string') patch.webSearchApiKeyTavily = rest.webSearchApiKeyTavily
  if (typeof rest.webSearchApiKeyBrave === 'string') patch.webSearchApiKeyBrave = rest.webSearchApiKeyBrave
  if (typeof rest.webSearchApiKeyMetaso === 'string') patch.webSearchApiKeyMetaso = rest.webSearchApiKeyMetaso
  if (typeof rest.taskTraceEnabled === 'boolean') patch.taskTraceEnabled = rest.taskTraceEnabled
  if (typeof rest.taskTraceDefaultOn === 'boolean') patch.taskTraceDefaultOn = rest.taskTraceDefaultOn
  if (typeof rest.taskTraceAdminOnly === 'boolean') patch.taskTraceAdminOnly = rest.taskTraceAdminOnly
  if (typeof rest.taskTraceEnv === 'string') patch.taskTraceEnv = rest.taskTraceEnv
  if (typeof rest.taskTraceRetentionDays === 'number') patch.taskTraceRetentionDays = rest.taskTraceRetentionDays
  if (typeof rest.taskTraceMaxEvents === 'number') patch.taskTraceMaxEvents = rest.taskTraceMaxEvents
  if (typeof rest.taskTraceIdleTimeoutMs === 'number') patch.taskTraceIdleTimeoutMs = rest.taskTraceIdleTimeoutMs
  if (typeof rest.chatMaxConcurrentStreams === 'number') {
    patch.chatMaxConcurrentStreams = Math.max(1, Math.min(8, Math.floor(rest.chatMaxConcurrentStreams)))
  }
  // 标题智能总结设置
  if (typeof rest.titleSummaryEnabled === 'boolean') patch.titleSummaryEnabled = rest.titleSummaryEnabled
  if (typeof rest.titleSummaryMaxLength === 'number') {
    patch.titleSummaryMaxLength = Math.max(5, Math.min(50, Math.floor(rest.titleSummaryMaxLength)))
  }
  if (typeof rest.titleSummaryModelSource === 'string') patch.titleSummaryModelSource = rest.titleSummaryModelSource
  if (Object.prototype.hasOwnProperty.call(rest, 'titleSummaryConnectionId')) {
    patch.titleSummaryConnectionId = rest.titleSummaryConnectionId ?? null
  }
  if (Object.prototype.hasOwnProperty.call(rest, 'titleSummaryModelId')) {
    patch.titleSummaryModelId = rest.titleSummaryModelId ?? null
  }
  // RAG 设置
  if (typeof rest.ragEnabled === 'boolean') patch.ragEnabled = rest.ragEnabled
  if (Object.prototype.hasOwnProperty.call(rest, 'ragEmbeddingConnectionId')) {
    patch.ragEmbeddingConnectionId = rest.ragEmbeddingConnectionId ?? null
  }
  if (typeof rest.ragEmbeddingModelId === 'string') patch.ragEmbeddingModelId = rest.ragEmbeddingModelId
  if (typeof rest.ragEmbeddingBatchSize === 'number') patch.ragEmbeddingBatchSize = rest.ragEmbeddingBatchSize
  if (typeof rest.ragEmbeddingConcurrency === 'number') patch.ragEmbeddingConcurrency = rest.ragEmbeddingConcurrency
  if (typeof rest.ragTopK === 'number') patch.ragTopK = rest.ragTopK
  if (typeof rest.ragRelevanceThreshold === 'number') patch.ragRelevanceThreshold = rest.ragRelevanceThreshold
  if (typeof rest.ragMaxContextTokens === 'number') patch.ragMaxContextTokens = rest.ragMaxContextTokens
  if (typeof rest.ragChunkSize === 'number') patch.ragChunkSize = rest.ragChunkSize
  if (typeof rest.ragChunkOverlap === 'number') patch.ragChunkOverlap = rest.ragChunkOverlap
  if (typeof rest.ragMaxFileSizeMb === 'number') patch.ragMaxFileSizeMb = rest.ragMaxFileSizeMb
  if (typeof rest.ragMaxPages === 'number') patch.ragMaxPages = rest.ragMaxPages
  if (typeof rest.ragRetentionDays === 'number') patch.ragRetentionDays = rest.ragRetentionDays
  // 知识库设置
  if (typeof rest.knowledgeBaseEnabled === 'boolean') patch.knowledgeBaseEnabled = rest.knowledgeBaseEnabled
  if (typeof rest.knowledgeBaseAllowAnonymous === 'boolean') patch.knowledgeBaseAllowAnonymous = rest.knowledgeBaseAllowAnonymous
  if (typeof rest.knowledgeBaseAllowUsers === 'boolean') patch.knowledgeBaseAllowUsers = rest.knowledgeBaseAllowUsers
  if (assistantAvatarUpload) {
    patch.assistantAvatarUpload = assistantAvatarUpload
  } else if (assistantAvatarRemove) {
    patch.assistantAvatarUpload = null
  }
  const payload = serializeSystemSettingsPatch(patch as any)
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
  autoInstallOnMissing?: boolean
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
