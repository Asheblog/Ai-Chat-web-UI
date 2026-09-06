/**
 * 系统设置编解码契约 —— backend / frontend 共用。
 *
 * - 字段映射 / 序列化：见 settings-contract.ts（已收敛）
 * - 本文件补充前端消费的 camelCase `SystemSettings` 类型，消除
 *   frontend types/index.ts 与 backend settings-service 之间的字段漂移。
 */

export type WebSearchEngine = 'tavily' | 'brave' | 'metaso' | 'exa'
export type WebSearchBilingualMode = 'off' | 'conditional' | 'always'
export type WebSearchMergeStrategy = 'hybrid_score_v1'

export interface SystemSettings {
  allowRegistration: boolean
  brandText?: string
  brandPrimary?: string
  brandPrimaryForeground?: string
  brandBackground?: string
  brandSurface?: string
  brandForeground?: string
  brandMutedForeground?: string
  assistantAvatarUpload?: { data: string; mime: string } | null
  assistantAvatarRemove?: boolean
  // 流式/稳定性相关（系统级）
  sseHeartbeatIntervalMs?: number
  providerMaxIdleMs?: number
  providerTimeoutMs?: number
  providerInitialGraceMs?: number
  providerReasoningIdleMs?: number
  reasoningKeepaliveIntervalMs?: number
  usageEmit?: boolean
  usageProviderOnly?: boolean
  contextCompressionEnabled?: boolean
  contextCompressionThresholdRatio?: number
  contextCompressionTailMessages?: number
  // 推理链相关（可选）
  reasoningEnabled?: boolean
  reasoningSaveToDb?: boolean
  reasoningTagsMode?: 'default' | 'custom' | 'off'
  reasoningCustomTags?: string
  streamDeltaChunkSize?: number
  streamDeltaFlushIntervalMs?: number
  streamReasoningFlushIntervalMs?: number
  streamKeepaliveIntervalMs?: number
  // 供应商参数（可选）
  openaiReasoningEffort?: 'low' | 'medium' | 'high' | 'max' | 'xhigh' | '' | 'unset'
  reasoningMaxOutputTokensDefault?: number | null
  temperatureDefault?: number | null
  ollamaThink?: boolean
  chatImageRetentionDays?: number
  assistantReplyHistoryLimit?: number | null
  siteBaseUrl?: string
  anonymousRetentionDays?: number
  anonymousDailyQuota?: number
  defaultUserDailyQuota?: number
  battleAllowAnonymous?: boolean
  battleAllowUsers?: boolean
  battleAnonymousDailyQuota?: number
  battleUserDailyQuota?: number
  battleRetentionDays?: number
  modelAccessDefaultAnonymous?: 'allow' | 'deny'
  modelAccessDefaultUser?: 'allow' | 'deny'
  webSearchAgentEnable?: boolean
  webSearchEnabledEngines?: WebSearchEngine[]
  webSearchEngineOrder?: WebSearchEngine[]
  webSearchResultLimit?: number
  webSearchDomainFilter?: string[]
  webSearchHasApiKey?: boolean
  webSearchHasApiKeyTavily?: boolean
  webSearchHasApiKeyBrave?: boolean
  webSearchHasApiKeyMetaso?: boolean
  webSearchHasApiKeyExa?: boolean
  webSearchApiKeyExa?: string
  webSearchScope?: string
  webSearchIncludeSummary?: boolean
  webSearchIncludeRaw?: boolean
  webSearchParallelMaxEngines?: number
  webSearchParallelMaxQueriesPerCall?: number
  webSearchParallelTimeoutMs?: number
  webSearchParallelMergeStrategy?: WebSearchMergeStrategy
  webSearchAutoBilingual?: boolean
  webSearchAutoBilingualMode?: WebSearchBilingualMode
  webSearchAutoReadParallelism?: number
  pythonToolEnable?: boolean
  chatDynamicSkillRuntimeEnabled?: boolean
  pythonToolTimeoutMs?: number
  pythonToolMaxOutputChars?: number
  pythonToolMaxSourceChars?: number
  agentMaxToolIterations?: number
  mcpGlobalEnabled?: boolean
  assistantAvatarUrl?: string | null
  chatSystemPrompt?: string
  webSearchApiKeyTavily?: string
  webSearchApiKeyBrave?: string
  webSearchApiKeyMetaso?: string
  taskTraceEnabled?: boolean
  taskTraceDefaultOn?: boolean
  taskTraceAdminOnly?: boolean
  taskTraceEnv?: 'dev' | 'prod' | 'both'
  taskTraceRetentionDays?: number
  taskTraceMaxEvents?: number
  taskTraceIdleTimeoutMs?: number
  chatMaxConcurrentStreams?: number
  // 标题智能总结设置
  titleSummaryEnabled?: boolean
  titleSummaryMaxLength?: number
  titleSummaryModelSource?: 'current' | 'specified'
  titleSummaryConnectionId?: number | null
  titleSummaryModelId?: string | null
  // 图片转写设置
  imageTranscriptionEnabled?: boolean
  imageTranscriptionConnectionId?: number | null
  imageTranscriptionModelId?: string | null
  imageTranscriptionReasoningEnabled?: boolean
  imageTranscriptionReasoningEffort?: 'low' | 'medium' | 'high' | 'max' | 'xhigh' | '' | 'unset'
  imageTranscriptionOllamaThink?: boolean
  // RAG 文档解析设置
  ragEnabled?: boolean
  ragEmbeddingConnectionId?: number | null
  ragEmbeddingModelId?: string
  ragEmbeddingBatchSize?: number
  ragEmbeddingConcurrency?: number
  ragTopK?: number
  ragRelevanceThreshold?: number
  ragMaxContextTokens?: number
  ragChunkSize?: number
  ragChunkOverlap?: number
  ragMaxFileSizeMb?: number
  ragMaxPages?: number
  ragRetentionDays?: number
  // 知识库设置
  knowledgeBaseEnabled?: boolean
  knowledgeBaseAllowAnonymous?: boolean
  knowledgeBaseAllowUsers?: boolean
}

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
    if (lowered === 'tavily' || lowered === 'brave' || lowered === 'metaso' || lowered === 'exa') {
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

/**
 * 将后端返回的 storage-key 系统设置载荷解析为前端消费的 camelCase SystemSettings。
 * 与 frontend features/settings/api.ts 历史实现保持一致。
 */
export const parseSystemSettingsPayload = (
  raw: Record<string, unknown>,
): SystemSettings => {
  const allowRegistration = !!raw.registration_enabled
  const brandText = (raw.brand_text || 'AIChat') as string
  const brandPrimary = typeof raw.brand_primary === 'string' ? raw.brand_primary : ''
  const brandPrimaryForeground =
    typeof raw.brand_primary_foreground === 'string' ? raw.brand_primary_foreground : ''
  const brandBackground = typeof raw.brand_background === 'string' ? raw.brand_background : ''
  const brandSurface = typeof raw.brand_surface === 'string' ? raw.brand_surface : ''
  const brandForeground = typeof raw.brand_foreground === 'string' ? raw.brand_foreground : ''
  const brandMutedForeground =
    typeof raw.brand_muted_foreground === 'string' ? raw.brand_muted_foreground : ''
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
  const webSearchHasApiKeyExa = Boolean(raw.web_search_has_api_key_exa ?? webSearchHasApiKey)
  const aggregatedHasKey =
    webSearchHasApiKeyTavily || webSearchHasApiKeyBrave || webSearchHasApiKeyMetaso || webSearchHasApiKeyExa || webSearchHasApiKey
  const webSearchScope =
    typeof raw.web_search_scope === 'string'
      ? raw.web_search_scope
      : 'webpage'
  const webSearchIncludeSummary = Boolean(raw.web_search_include_summary ?? false)
  const webSearchIncludeRaw = Boolean(raw.web_search_include_raw ?? false)
  const webSearchParallelMaxEngines = (() => {
    const parsed = parseOptionalInt(raw.web_search_parallel_max_engines)
    return typeof parsed === 'number' ? Math.max(1, Math.min(4, parsed)) : 3
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
  const mcpGlobalEnabled = (raw.mcp_global_enabled ?? true) as boolean
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
  const rawEnv = String(raw.task_trace_env || '').toLowerCase()
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
  // 图片转写设置
  const imageTranscriptionEnabled = Boolean(raw.image_transcription_enabled ?? false)
  const imageTranscriptionConnectionId = (() => {
    const v = raw.image_transcription_connection_id
    if (typeof v === 'number' && v > 0) return v
    return null
  })()
  const imageTranscriptionModelId = (() => {
    const v = raw.image_transcription_model_id
    if (typeof v === 'string' && v.trim().length > 0) return v
    return null
  })()
  const imageTranscriptionReasoningEnabled = Boolean(raw.image_transcription_reasoning_enabled ?? false)
  const imageTranscriptionReasoningEffort = (raw.image_transcription_reasoning_effort ?? 'unset') as any
  const imageTranscriptionOllamaThink = Boolean(raw.image_transcription_ollama_think ?? false)

  return {
    allowRegistration,
    brandText,
    brandPrimary,
    brandPrimaryForeground,
    brandBackground,
    brandSurface,
    brandForeground,
    brandMutedForeground,
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
    webSearchHasApiKeyExa,
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
    mcpGlobalEnabled,
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
    // 图片转写设置
    imageTranscriptionEnabled,
    imageTranscriptionConnectionId,
    imageTranscriptionModelId,
    imageTranscriptionReasoningEnabled,
    imageTranscriptionReasoningEffort,
    imageTranscriptionOllamaThink,
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
  }
}

export {
  RAG_SYSTEM_SETTINGS_FIELDS,
  RAG_SYSTEM_SETTINGS_KEYS,
  SYSTEM_SETTINGS_FIELD_MAP,
  SYSTEM_SETTINGS_STORAGE_TO_FIELD_MAP,
  deserializeSystemSettingsPayload,
  serializeSystemSettingsPatch,
} from './settings-contract.js'

export type {
  SystemSettingsField,
  SystemSettingsStorageKey,
} from './settings-contract.js'
