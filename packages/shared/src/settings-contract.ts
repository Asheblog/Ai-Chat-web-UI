export const SYSTEM_SETTINGS_FIELD_MAP = {
  allowRegistration: 'registration_enabled',
  anonymousDailyQuota: 'anonymous_daily_quota',
  anonymousRetentionDays: 'anonymous_retention_days',
  assistantAvatarUpload: 'assistant_avatar',
  assistantAvatarUrl: 'assistant_avatar_url',
  assistantReplyHistoryLimit: 'assistant_reply_history_limit',
  battleAllowAnonymous: 'battle_allow_anonymous',
  battleAllowUsers: 'battle_allow_users',
  battleAnonymousDailyQuota: 'battle_anonymous_daily_quota',
  battleRetentionDays: 'battle_retention_days',
  battleUserDailyQuota: 'battle_user_daily_quota',
  brandText: 'brand_text',
  chatImageRetentionDays: 'chat_image_retention_days',
  chatDynamicSkillRuntimeEnabled: 'chat_dynamic_skill_runtime_enabled',
  chatMaxConcurrentStreams: 'chat_max_concurrent_streams',
  chatSystemPrompt: 'chat_system_prompt',
  contextCompressionEnabled: 'context_compression_enabled',
  contextCompressionTailMessages: 'context_compression_tail_messages',
  contextCompressionThresholdRatio: 'context_compression_threshold_ratio',
  defaultUserDailyQuota: 'default_user_daily_quota',
  knowledgeBaseAllowAnonymous: 'knowledge_base_allow_anonymous',
  knowledgeBaseAllowUsers: 'knowledge_base_allow_users',
  knowledgeBaseEnabled: 'knowledge_base_enabled',
  modelAccessDefaultAnonymous: 'model_access_default_anonymous',
  modelAccessDefaultUser: 'model_access_default_user',
  ollamaThink: 'ollama_think',
  openaiReasoningEffort: 'openai_reasoning_effort',
  providerInitialGraceMs: 'provider_initial_grace_ms',
  providerMaxIdleMs: 'provider_max_idle_ms',
  providerReasoningIdleMs: 'provider_reasoning_idle_ms',
  providerTimeoutMs: 'provider_timeout_ms',
  pythonToolEnable: 'python_tool_enable',
  pythonToolMaxOutputChars: 'python_tool_max_output_chars',
  pythonToolMaxSourceChars: 'python_tool_max_source_chars',
  pythonToolTimeoutMs: 'python_tool_timeout_ms',
  ragChunkOverlap: 'rag_chunk_overlap',
  ragChunkSize: 'rag_chunk_size',
  ragEmbeddingBatchSize: 'rag_embedding_batch_size',
  ragEmbeddingConcurrency: 'rag_embedding_concurrency',
  ragEmbeddingConnectionId: 'rag_embedding_connection_id',
  ragEmbeddingModelId: 'rag_embedding_model_id',
  ragEnabled: 'rag_enabled',
  ragMaxContextTokens: 'rag_max_context_tokens',
  ragMaxFileSizeMb: 'rag_max_file_size_mb',
  ragMaxPages: 'rag_max_pages',
  ragRelevanceThreshold: 'rag_relevance_threshold',
  ragRetentionDays: 'rag_retention_days',
  ragTopK: 'rag_top_k',
  reasoningCustomTags: 'reasoning_custom_tags',
  reasoningDefaultExpand: 'reasoning_default_expand',
  reasoningEnabled: 'reasoning_enabled',
  reasoningKeepaliveIntervalMs: 'reasoning_keepalive_interval_ms',
  reasoningMaxOutputTokensDefault: 'reasoning_max_output_tokens_default',
  reasoningSaveToDb: 'reasoning_save_to_db',
  reasoningTagsMode: 'reasoning_tags_mode',
  siteBaseUrl: 'site_base_url',
  sseHeartbeatIntervalMs: 'sse_heartbeat_interval_ms',
  streamDeltaChunkSize: 'stream_delta_chunk_size',
  streamDeltaFlushIntervalMs: 'stream_delta_flush_interval_ms',
  streamKeepaliveIntervalMs: 'stream_keepalive_interval_ms',
  streamReasoningFlushIntervalMs: 'stream_reasoning_flush_interval_ms',
  taskTraceAdminOnly: 'task_trace_admin_only',
  taskTraceDefaultOn: 'task_trace_default_on',
  taskTraceEnabled: 'task_trace_enabled',
  taskTraceEnv: 'task_trace_env',
  taskTraceIdleTimeoutMs: 'task_trace_idle_timeout_ms',
  taskTraceMaxEvents: 'task_trace_max_events',
  taskTraceRetentionDays: 'task_trace_retention_days',
  temperatureDefault: 'temperature_default',
  titleSummaryConnectionId: 'title_summary_connection_id',
  titleSummaryEnabled: 'title_summary_enabled',
  titleSummaryMaxLength: 'title_summary_max_length',
  titleSummaryModelId: 'title_summary_model_id',
  titleSummaryModelSource: 'title_summary_model_source',
  usageEmit: 'usage_emit',
  usageProviderOnly: 'usage_provider_only',
  webSearchAgentEnable: 'web_search_agent_enable',
  webSearchApiKeyBrave: 'web_search_api_key_brave',
  webSearchApiKeyMetaso: 'web_search_api_key_metaso',
  webSearchApiKeyTavily: 'web_search_api_key_tavily',
  webSearchAutoBilingual: 'web_search_auto_bilingual',
  webSearchAutoBilingualMode: 'web_search_auto_bilingual_mode',
  webSearchAutoReadParallelism: 'web_search_auto_read_parallelism',
  webSearchDomainFilter: 'web_search_domain_filter',
  webSearchEnabledEngines: 'web_search_enabled_engines',
  webSearchEngineOrder: 'web_search_engine_order',
  webSearchHasApiKey: 'web_search_has_api_key',
  webSearchHasApiKeyBrave: 'web_search_has_api_key_brave',
  webSearchHasApiKeyMetaso: 'web_search_has_api_key_metaso',
  webSearchHasApiKeyTavily: 'web_search_has_api_key_tavily',
  webSearchIncludeRaw: 'web_search_include_raw',
  webSearchIncludeSummary: 'web_search_include_summary',
  webSearchParallelMaxEngines: 'web_search_parallel_max_engines',
  webSearchParallelMaxQueriesPerCall: 'web_search_parallel_max_queries_per_call',
  webSearchParallelMergeStrategy: 'web_search_parallel_merge_strategy',
  webSearchParallelTimeoutMs: 'web_search_parallel_timeout_ms',
  webSearchResultLimit: 'web_search_result_limit',
  webSearchScope: 'web_search_scope',
  agentMaxToolIterations: 'agent_max_tool_iterations',
} as const

export type SystemSettingsField = keyof typeof SYSTEM_SETTINGS_FIELD_MAP
export type SystemSettingsStorageKey =
  (typeof SYSTEM_SETTINGS_FIELD_MAP)[SystemSettingsField]

const HAS_OWN = Object.prototype.hasOwnProperty

const fieldMapEntries = Object.entries(SYSTEM_SETTINGS_FIELD_MAP) as Array<[
  SystemSettingsField,
  SystemSettingsStorageKey,
]>

export const SYSTEM_SETTINGS_STORAGE_TO_FIELD_MAP: Record<string, SystemSettingsField> =
  fieldMapEntries.reduce<Record<string, SystemSettingsField>>((acc, [field, storageKey]) => {
    acc[storageKey] = field
    return acc
  }, {})

export const serializeSystemSettingsPatch = (
  patch: Partial<Record<SystemSettingsField, unknown>>,
): Record<string, unknown> => {
  const payload: Record<string, unknown> = {}
  for (const [field, storageKey] of fieldMapEntries) {
    if (!HAS_OWN.call(patch, field)) continue
    payload[storageKey] = patch[field]
  }
  return payload
}

export const deserializeSystemSettingsPayload = (
  payload: Record<string, unknown>,
): Partial<Record<SystemSettingsField, unknown>> => {
  const patch: Partial<Record<SystemSettingsField, unknown>> = {}
  for (const [field, storageKey] of fieldMapEntries) {
    if (!HAS_OWN.call(payload, storageKey)) continue
    patch[field] = payload[storageKey]
  }
  return patch
}

export const RAG_SYSTEM_SETTINGS_FIELDS = [
  'ragEnabled',
  'ragEmbeddingConnectionId',
  'ragEmbeddingModelId',
  'ragEmbeddingBatchSize',
  'ragEmbeddingConcurrency',
  'ragTopK',
  'ragRelevanceThreshold',
  'ragMaxContextTokens',
  'ragChunkSize',
  'ragChunkOverlap',
  'ragMaxFileSizeMb',
  'ragMaxPages',
  'ragRetentionDays',
] as const satisfies readonly SystemSettingsField[]

export const RAG_SYSTEM_SETTINGS_KEYS = RAG_SYSTEM_SETTINGS_FIELDS.map(
  (field) => SYSTEM_SETTINGS_FIELD_MAP[field],
) as readonly SystemSettingsStorageKey[]
