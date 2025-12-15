/**
 * ServiceAccessor - 类型安全的服务访问器
 *
 * 提供类型安全的服务获取函数，替代分散的全局实例导入。
 */

import { ServiceRegistry } from './service-registry'

// Service Keys - 用于注册和解析
export const SERVICE_KEYS = {
  // Core
  context: 'context',
  connectionRepository: 'connectionRepository',
  modelResolverRepository: 'modelResolverRepository',

  // Services
  connectionService: 'connectionService',
  modelResolverService: 'modelResolverService',
  modelCatalogService: 'modelCatalogService',
  sessionService: 'sessionService',
  userService: 'userService',
  authService: 'authService',
  authContextService: 'authContextService',
  quotaService: 'quotaService',
  tokenizerService: 'tokenizerService',
  contextWindowService: 'contextWindowService',
  openaiCompatMessageService: 'openaiCompatMessageService',
  settingsService: 'settingsService',
  personalSettingsService: 'personalSettingsService',
  settingsFacade: 'settingsFacade',
  appInfoService: 'appInfoService',
  healthService: 'healthService',
  taskTraceService: 'taskTraceService',
  taskTraceFileService: 'taskTraceFileService',
  chatService: 'chatService',
  shareService: 'shareService',

  // Phase 3: New Utils-layer Services
  systemSettingsService: 'systemSettingsService',
  anonymousCleanupService: 'anonymousCleanupService',
  chatImageService: 'chatImageService',
  taskTraceConfigService: 'taskTraceConfigService',

  // Chat Module Services
  streamSseService: 'streamSseService',
  streamUsageService: 'streamUsageService',
  streamTraceService: 'streamTraceService',
  assistantProgressService: 'assistantProgressService',
  nonStreamFallbackService: 'nonStreamFallbackService',
  nonStreamChatService: 'nonStreamChatService',
  chatMessageQueryService: 'chatMessageQueryService',
  providerRequester: 'providerRequester',

  // Stream Module
  streamMetaStore: 'streamMetaStore',

  // Document Services
  documentServices: 'documentServices',
} as const

export type ServiceKey = (typeof SERVICE_KEYS)[keyof typeof SERVICE_KEYS]

// Type imports for accessor functions
import type { AppContext } from '../context/app-context'
import type { ConnectionRepository } from '../repositories/connection-repository'
import type { ModelResolverRepository } from '../repositories/model-resolver-repository'
import type { ConnectionService } from '../services/connections'
import type { ModelResolverService } from '../services/catalog/model-resolver-service'
import type { ModelCatalogService } from '../services/catalog/model-catalog-service'
import type { SessionService } from '../services/sessions/session-service'
import type { UserService } from '../services/users/user-service'
import type { AuthService } from '../services/auth/auth-service'
import type { AuthContextService } from '../services/auth/auth-context-service'
import type { QuotaService } from '../services/quota/quota-service'
import type { TokenizerService } from '../services/tokenizer/tokenizer-service'
import type { ContextWindowService } from '../services/context/context-window-service'
import type { OpenAICompatMessageService } from '../services/openai-compat/message-service'
import type { SettingsService } from '../services/settings'
import type { PersonalSettingsService } from '../services/settings/personal-settings-service'
import type { SettingsFacade } from '../services/settings/settings-facade'
import type { AppInfoService } from '../services/settings/app-info-service'
import type { HealthService } from '../services/settings/health-service'
import type { TaskTraceService } from '../services/task-trace/task-trace-service'
import type { TaskTraceFileService } from '../services/task-trace/task-trace-file-service'
import type { ChatService } from '../services/chat/chat-service'
import type { ShareService } from '../services/shares'

// Phase 3: New Utils-layer Service types
import type { SystemSettingsService } from '../services/settings/system-settings-service'
import type { AnonymousCleanupService } from '../services/cleanup/anonymous-cleanup-service'
import type { ChatImageService } from '../services/attachment/chat-image-service'
import type { TaskTraceConfigService } from '../services/task-trace/task-trace-config-service'

// Lazy type imports for chat module services (to avoid circular deps)
type StreamSseService = import('../modules/chat/services/stream-sse-service').StreamSseService
type StreamUsageService = import('../modules/chat/services/stream-usage-service').StreamUsageService
type StreamTraceService = import('../modules/chat/services/stream-trace-service').StreamTraceService
type AssistantProgressService =
  import('../modules/chat/services/assistant-progress-service').AssistantProgressService
type NonStreamFallbackService =
  import('../modules/chat/services/non-stream-fallback-service').NonStreamFallbackService
type NonStreamChatService =
  import('../modules/chat/services/non-stream-chat-service').NonStreamChatService
type ChatMessageQueryService =
  import('../modules/chat/services/message-query-service').ChatMessageQueryService
type ProviderRequester = import('../modules/chat/services/provider-requester').ProviderRequester
type StreamMetaStore = import('../services/chat/stream-meta-store').StreamMetaStore
type DocumentServices = import('../services/document-services-factory').DocumentServices

// Helper to get registry
const getRegistry = () => ServiceRegistry.getInstance()

// ============================================================================
// Core Accessors
// ============================================================================

export const getAppContext = (): AppContext => getRegistry().resolve(SERVICE_KEYS.context)

export const getConnectionRepository = (): ConnectionRepository =>
  getRegistry().resolve(SERVICE_KEYS.connectionRepository)

export const getModelResolverRepository = (): ModelResolverRepository =>
  getRegistry().resolve(SERVICE_KEYS.modelResolverRepository)

// ============================================================================
// Service Accessors
// ============================================================================

export const getConnectionService = (): ConnectionService =>
  getRegistry().resolve(SERVICE_KEYS.connectionService)

export const getModelResolverService = (): ModelResolverService =>
  getRegistry().resolve(SERVICE_KEYS.modelResolverService)

export const getModelCatalogService = (): ModelCatalogService =>
  getRegistry().resolve(SERVICE_KEYS.modelCatalogService)

export const getSessionService = (): SessionService =>
  getRegistry().resolve(SERVICE_KEYS.sessionService)

export const getUserService = (): UserService => getRegistry().resolve(SERVICE_KEYS.userService)

export const getAuthService = (): AuthService => getRegistry().resolve(SERVICE_KEYS.authService)

export const getAuthContextService = (): AuthContextService =>
  getRegistry().resolve(SERVICE_KEYS.authContextService)

export const getQuotaService = (): QuotaService => getRegistry().resolve(SERVICE_KEYS.quotaService)

export const getTokenizerService = (): TokenizerService =>
  getRegistry().resolve(SERVICE_KEYS.tokenizerService)

export const getContextWindowService = (): ContextWindowService =>
  getRegistry().resolve(SERVICE_KEYS.contextWindowService)

export const getOpenAICompatMessageService = (): OpenAICompatMessageService =>
  getRegistry().resolve(SERVICE_KEYS.openaiCompatMessageService)

export const getSettingsService = (): SettingsService =>
  getRegistry().resolve(SERVICE_KEYS.settingsService)

export const getPersonalSettingsService = (): PersonalSettingsService =>
  getRegistry().resolve(SERVICE_KEYS.personalSettingsService)

export const getSettingsFacade = (): SettingsFacade =>
  getRegistry().resolve(SERVICE_KEYS.settingsFacade)

export const getAppInfoService = (): AppInfoService =>
  getRegistry().resolve(SERVICE_KEYS.appInfoService)

export const getHealthService = (): HealthService =>
  getRegistry().resolve(SERVICE_KEYS.healthService)

export const getTaskTraceService = (): TaskTraceService =>
  getRegistry().resolve(SERVICE_KEYS.taskTraceService)

export const getTaskTraceFileService = (): TaskTraceFileService =>
  getRegistry().resolve(SERVICE_KEYS.taskTraceFileService)

export const getChatService = (): ChatService => getRegistry().resolve(SERVICE_KEYS.chatService)

export const getShareService = (): ShareService => getRegistry().resolve(SERVICE_KEYS.shareService)

// ============================================================================
// Phase 3: Utils-layer Service Accessors
// ============================================================================

export const getSystemSettingsService = (): SystemSettingsService =>
  getRegistry().resolve(SERVICE_KEYS.systemSettingsService)

export const getAnonymousCleanupService = (): AnonymousCleanupService =>
  getRegistry().resolve(SERVICE_KEYS.anonymousCleanupService)

export const getChatImageService = (): ChatImageService =>
  getRegistry().resolve(SERVICE_KEYS.chatImageService)

export const getTaskTraceConfigService = (): TaskTraceConfigService =>
  getRegistry().resolve(SERVICE_KEYS.taskTraceConfigService)

// ============================================================================
// Chat Module Service Accessors
// ============================================================================

export const getStreamSseService = (): StreamSseService =>
  getRegistry().resolve(SERVICE_KEYS.streamSseService)

export const getStreamUsageService = (): StreamUsageService =>
  getRegistry().resolve(SERVICE_KEYS.streamUsageService)

export const getStreamTraceService = (): StreamTraceService =>
  getRegistry().resolve(SERVICE_KEYS.streamTraceService)

export const getAssistantProgressService = (): AssistantProgressService =>
  getRegistry().resolve(SERVICE_KEYS.assistantProgressService)

export const getNonStreamFallbackService = (): NonStreamFallbackService =>
  getRegistry().resolve(SERVICE_KEYS.nonStreamFallbackService)

export const getNonStreamChatService = (): NonStreamChatService =>
  getRegistry().resolve(SERVICE_KEYS.nonStreamChatService)

export const getChatMessageQueryService = (): ChatMessageQueryService =>
  getRegistry().resolve(SERVICE_KEYS.chatMessageQueryService)

export const getProviderRequester = (): ProviderRequester =>
  getRegistry().resolve(SERVICE_KEYS.providerRequester)

export const getStreamMetaStore = (): StreamMetaStore =>
  getRegistry().resolve(SERVICE_KEYS.streamMetaStore)

// ============================================================================
// Optional Service Accessors (may not be initialized)
// ============================================================================

export const tryGetDocumentServices = (): DocumentServices | undefined =>
  getRegistry().tryResolve(SERVICE_KEYS.documentServices)
