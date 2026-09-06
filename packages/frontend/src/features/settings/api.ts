import { apiHttpClient } from '@/lib/api'
import { serializeSystemSettingsPatch } from '@aichat/shared'
import { parseSystemSettingsPayload } from '@aichat/shared/settings-codec'
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

  const raw = settingsRes.data.data || {}
  return {
    data: parseSystemSettingsPayload(raw),
  }
}


export type PublicBrandingResponse = {
  brand_text?: string
  brand_primary?: string
  brand_primary_foreground?: string
  brand_background?: string
  brand_surface?: string
  brand_foreground?: string
  brand_muted_foreground?: string
}

export const getPublicBranding = async () => {
  const response = await client.get<ApiResponse<PublicBrandingResponse>>('/settings/branding')
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
  const assignBrandColor = (
    field:
      | 'brandPrimary'
      | 'brandPrimaryForeground'
      | 'brandBackground'
      | 'brandSurface'
      | 'brandForeground'
      | 'brandMutedForeground',
  ) => {
    if (!Object.prototype.hasOwnProperty.call(rest, field)) return
    const value = rest[field]
    if (typeof value === 'string') {
      patch[field] = value.trim()
    } else if (value === null || value === undefined) {
      patch[field] = ''
    }
  }
  assignBrandColor('brandPrimary')
  assignBrandColor('brandPrimaryForeground')
  assignBrandColor('brandBackground')
  assignBrandColor('brandSurface')
  assignBrandColor('brandForeground')
  assignBrandColor('brandMutedForeground')
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
  if (typeof rest.mcpGlobalEnabled === 'boolean') patch.mcpGlobalEnabled = rest.mcpGlobalEnabled
  if (typeof rest.webSearchApiKeyTavily === 'string') patch.webSearchApiKeyTavily = rest.webSearchApiKeyTavily
  if (typeof rest.webSearchApiKeyBrave === 'string') patch.webSearchApiKeyBrave = rest.webSearchApiKeyBrave
  if (typeof rest.webSearchApiKeyMetaso === 'string') patch.webSearchApiKeyMetaso = rest.webSearchApiKeyMetaso
  if (typeof rest.webSearchApiKeyExa === 'string') patch.webSearchApiKeyExa = rest.webSearchApiKeyExa
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
  // 图片转写设置
  if (typeof rest.imageTranscriptionEnabled === 'boolean') patch.imageTranscriptionEnabled = rest.imageTranscriptionEnabled
  if (Object.prototype.hasOwnProperty.call(rest, 'imageTranscriptionConnectionId')) {
    patch.imageTranscriptionConnectionId = rest.imageTranscriptionConnectionId ?? null
  }
  if (Object.prototype.hasOwnProperty.call(rest, 'imageTranscriptionModelId')) {
    patch.imageTranscriptionModelId = rest.imageTranscriptionModelId ?? null
  }
  if (typeof rest.imageTranscriptionReasoningEnabled === 'boolean') {
    patch.imageTranscriptionReasoningEnabled = rest.imageTranscriptionReasoningEnabled
  }
  if (typeof rest.imageTranscriptionReasoningEffort === 'string') {
    patch.imageTranscriptionReasoningEffort = rest.imageTranscriptionReasoningEffort
  }
  if (typeof rest.imageTranscriptionOllamaThink === 'boolean') {
    patch.imageTranscriptionOllamaThink = rest.imageTranscriptionOllamaThink
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

export type ImageTranscriptionProbeStepName = 'transcribe' | 'relevance'

export type ImageTranscriptionProbeStep = {
  name: ImageTranscriptionProbeStepName
  ok: boolean
  durationMs: number
  detail?: string
  error?: string
}

export type ImageTranscriptionProbeResult = {
  ok: boolean
  steps: ImageTranscriptionProbeStep[]
}

export const IMAGE_TRANSCRIPTION_PROBE_TIMEOUT_MS = 50_000

export const probeImageTranscription = async (payload?: {
  imageBase64?: string
  mime?: string
}) => {
  const response = await client.post<ApiResponse<ImageTranscriptionProbeResult>>(
    '/settings/image-transcription/probe',
    payload ?? {},
    { timeout: IMAGE_TRANSCRIPTION_PROBE_TIMEOUT_MS },
  )
  return response.data
}
