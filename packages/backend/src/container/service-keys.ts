/**
 * Service Keys - 容器服务键定义
 *
 * 统一维护 key，避免通过 accessor 文件耦合常量。
 */
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
  battleService: 'battleService',
  promptTemplateService: 'promptTemplateService',
  artifactService: 'artifactService',
  workspaceService: 'workspaceService',
  workspaceCleanupService: 'workspaceCleanupService',
  pythonRuntimeService: 'pythonRuntimeService',
  systemLogService: 'systemLogService',

  // Utils-layer Services
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
