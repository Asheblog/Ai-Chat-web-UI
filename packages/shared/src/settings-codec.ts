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
