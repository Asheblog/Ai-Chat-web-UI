import type { AppContext } from '../context/app-context'
import { createAppContext } from '../context/app-context'
import {
  PrismaConnectionRepository,
  type ConnectionRepository,
} from '../repositories/connection-repository'
import {
  PrismaModelResolverRepository,
  type ModelResolverRepository,
} from '../repositories/model-resolver-repository'
import { ConnectionService } from '../services/connections'
import { ModelResolverService } from '../services/catalog/model-resolver-service'
import { ModelCatalogService } from '../services/catalog/model-catalog-service'
import { SessionService } from '../services/sessions/session-service'
import { UserService } from '../services/users/user-service'
import { AuthService } from '../services/auth/auth-service'
import { AuthContextService } from '../services/auth/auth-context-service'
import { QuotaService } from '../services/quota/quota-service'
import { TokenizerService } from '../services/tokenizer/tokenizer-service'
import { ContextWindowService } from '../services/context/context-window-service'
import { OpenAICompatMessageService } from '../services/openai-compat/message-service'
import { SettingsService } from '../services/settings'
import { PersonalSettingsService } from '../services/settings/personal-settings-service'
import { SettingsFacade } from '../services/settings/settings-facade'
import { AppInfoService } from '../services/settings/app-info-service'
import { HealthService } from '../services/settings/health-service'
import { TaskTraceService } from '../services/task-trace/task-trace-service'
import { TaskTraceFileService } from '../services/task-trace/task-trace-file-service'
import { ChatService } from '../services/chat/chat-service'
import { ShareService } from '../services/shares'

// Phase 3: New Utils-layer Services
import { SystemSettingsService } from '../services/settings/system-settings-service'
import { AnonymousCleanupService } from '../services/cleanup/anonymous-cleanup-service'
import { ChatImageService } from '../services/attachment/chat-image-service'
import { TaskTraceConfigService } from '../services/task-trace/task-trace-config-service'

import { AuthUtils } from '../utils/auth'
import {
  refreshAllModelCatalog,
  refreshModelCatalogForConnection,
  refreshModelCatalogForConnections,
  refreshModelCatalogForConnectionId,
} from '../utils/model-catalog'
import { verifyConnection, computeCapabilities, deriveChannelName } from '../utils/providers'
import { parseCapabilityEnvelope, normalizeCapabilityFlags, serializeCapabilityEnvelope } from '../utils/capabilities'
import {
  getQuotaPolicy,
  getBattlePolicy,
  invalidateQuotaPolicyCache,
  invalidateBattlePolicyCache,
  invalidateReasoningMaxOutputTokensDefaultCache,
} from '../utils/system-settings'
import { invalidateCompletionLimitCache, invalidateContextWindowCache } from '../utils/context-window'
import { invalidateTaskTraceConfig } from '../utils/task-trace'
import { syncSharedAnonymousQuota } from '../utils/quota'
import { replaceProfileImage } from '../utils/profile-images'
import { deleteAttachmentsForSessions } from '../utils/chat-images'
import { BackendLogger as log } from '../utils/logger'
import { ServiceRegistry } from './service-registry'
import { SERVICE_KEYS } from './service-accessor'

export interface AppContainerDeps {
  context?: AppContext
  connectionRepository?: ConnectionRepository
  connectionService?: ConnectionService
  modelResolverRepository?: ModelResolverRepository
  modelResolverService?: ModelResolverService
  sessionService?: SessionService
  userService?: UserService
  authService?: AuthService
  authContextService?: AuthContextService
  quotaService?: QuotaService
  tokenizerService?: TokenizerService
  contextWindowService?: ContextWindowService
  modelCatalogService?: ModelCatalogService
  openaiCompatMessageService?: OpenAICompatMessageService
  settingsService?: SettingsService
  personalSettingsService?: PersonalSettingsService
  settingsFacade?: SettingsFacade
  appInfoService?: AppInfoService
  healthService?: HealthService
  taskTraceService?: TaskTraceService
  taskTraceFileService?: TaskTraceFileService
  chatService?: ChatService
  shareService?: ShareService

  // Phase 3: New Utils-layer Services
  systemSettingsService?: SystemSettingsService
  anonymousCleanupService?: AnonymousCleanupService
  chatImageService?: ChatImageService
  taskTraceConfigService?: TaskTraceConfigService
}

export class AppContainer {
  readonly context: AppContext
  readonly connectionRepository: ConnectionRepository
  readonly connectionService: ConnectionService
  readonly modelResolverRepository: ModelResolverRepository
  readonly modelResolverService: ModelResolverService
  readonly sessionService: SessionService
  readonly userService: UserService
  readonly authService: AuthService
  readonly authContextService: AuthContextService
  readonly quotaService: QuotaService
  readonly tokenizerService: TokenizerService
  readonly contextWindowService: ContextWindowService
  readonly modelCatalogService: ModelCatalogService
  readonly openaiCompatMessageService: OpenAICompatMessageService
  readonly settingsService: SettingsService
  readonly personalSettingsService: PersonalSettingsService
  readonly settingsFacade: SettingsFacade
  readonly appInfoService: AppInfoService
  readonly healthService: HealthService
  readonly taskTraceService: TaskTraceService
  readonly taskTraceFileService: TaskTraceFileService
  readonly chatService: ChatService
  readonly shareService: ShareService

  // Phase 3: New Utils-layer Services
  readonly systemSettingsService: SystemSettingsService
  readonly anonymousCleanupService: AnonymousCleanupService
  readonly chatImageService: ChatImageService
  readonly taskTraceConfigService: TaskTraceConfigService

  constructor(deps: AppContainerDeps = {}) {
    const registry = ServiceRegistry.getInstance()

    this.context = deps.context ?? createAppContext()
    registry.register(SERVICE_KEYS.context, this.context)

    this.connectionRepository =
      deps.connectionRepository ?? new PrismaConnectionRepository(this.context.prisma)
    registry.register(SERVICE_KEYS.connectionRepository, this.connectionRepository)

    this.modelResolverRepository =
      deps.modelResolverRepository ?? new PrismaModelResolverRepository(this.context.prisma)
    registry.register(SERVICE_KEYS.modelResolverRepository, this.modelResolverRepository)

    this.modelResolverService =
      deps.modelResolverService ??
      new ModelResolverService({
        repository: this.modelResolverRepository,
      })
    registry.register(SERVICE_KEYS.modelResolverService, this.modelResolverService)

    this.connectionService =
      deps.connectionService ??
      new ConnectionService({
        repository: this.connectionRepository,
        encryptApiKey: AuthUtils.encryptApiKey,
        refreshModelCatalog: refreshModelCatalogForConnection,
        verifyConnection,
        logger: log,
      })
    registry.register(SERVICE_KEYS.connectionService, this.connectionService)

    this.quotaService =
      deps.quotaService ??
      new QuotaService({
        prisma: this.context.prisma,
        getQuotaPolicy,
      })
    registry.register(SERVICE_KEYS.quotaService, this.quotaService)

    this.tokenizerService = deps.tokenizerService ?? new TokenizerService()
    registry.register(SERVICE_KEYS.tokenizerService, this.tokenizerService)

    this.contextWindowService = deps.contextWindowService ?? new ContextWindowService()
    registry.register(SERVICE_KEYS.contextWindowService, this.contextWindowService)

    this.sessionService =
      deps.sessionService ??
      new SessionService({
        prisma: this.context.prisma,
        modelResolverService: this.modelResolverService,
        logger: this.context.logger,
      })
    registry.register(SERVICE_KEYS.sessionService, this.sessionService)

    this.chatService =
      deps.chatService ??
      new ChatService({
        prisma: this.context.prisma,
        logger: this.context.logger,
      })
    registry.register(SERVICE_KEYS.chatService, this.chatService)

    this.shareService =
      deps.shareService ??
      new ShareService({
        prisma: this.context.prisma,
        logger: this.context.logger,
      })
    registry.register(SERVICE_KEYS.shareService, this.shareService)

    this.userService =
      deps.userService ??
      new UserService({
        prisma: this.context.prisma,
        authUtils: AuthUtils,
        inspectActorQuota: (actor, options) => this.quotaService.inspectActorQuota(actor, options as any),
        logger: this.context.logger,
      })
    registry.register(SERVICE_KEYS.userService, this.userService)

    this.authContextService =
      deps.authContextService ??
      new AuthContextService({
        prisma: this.context.prisma,
        authUtils: AuthUtils,
        getQuotaPolicy,
      })
    registry.register(SERVICE_KEYS.authContextService, this.authContextService)

    this.authService =
      deps.authService ??
      new AuthService({
        prisma: this.context.prisma,
        authUtils: AuthUtils,
        inspectActorQuota: (actor, options) => this.quotaService.inspectActorQuota(actor, options as any),
      })
    registry.register(SERVICE_KEYS.authService, this.authService)

    this.modelCatalogService =
      deps.modelCatalogService ??
      new ModelCatalogService({
        prisma: this.context.prisma,
        refreshAllModelCatalog,
        refreshModelCatalogForConnections,
        refreshModelCatalogForConnectionId,
        computeCapabilities,
        deriveChannelName,
        parseCapabilityEnvelope,
        normalizeCapabilityFlags,
        serializeCapabilityEnvelope,
        invalidateCompletionLimitCache,
        invalidateContextWindowCache,
        logger: log,
      })
    registry.register(SERVICE_KEYS.modelCatalogService, this.modelCatalogService)

    this.openaiCompatMessageService =
      deps.openaiCompatMessageService ??
      new OpenAICompatMessageService({
        prisma: this.context.prisma,
        logger: this.context.logger,
      })
    registry.register(SERVICE_KEYS.openaiCompatMessageService, this.openaiCompatMessageService)

    this.settingsService =
      deps.settingsService ??
      new SettingsService({
        prisma: this.context.prisma,
        getQuotaPolicy,
        getBattlePolicy,
        invalidateQuotaPolicyCache,
        invalidateBattlePolicyCache,
        invalidateReasoningMaxOutputTokensDefaultCache,
        invalidateTaskTraceConfig,
        syncSharedAnonymousQuota,
        replaceProfileImage,
      })
    registry.register(SERVICE_KEYS.settingsService, this.settingsService)

    this.personalSettingsService =
      deps.personalSettingsService ??
      new PersonalSettingsService({
        prisma: this.context.prisma,
      })
    registry.register(SERVICE_KEYS.personalSettingsService, this.personalSettingsService)

    this.appInfoService = deps.appInfoService ?? new AppInfoService({ prisma: this.context.prisma })
    registry.register(SERVICE_KEYS.appInfoService, this.appInfoService)

    this.healthService = deps.healthService ?? new HealthService({ prisma: this.context.prisma })
    registry.register(SERVICE_KEYS.healthService, this.healthService)

    this.taskTraceFileService = deps.taskTraceFileService ?? new TaskTraceFileService()
    registry.register(SERVICE_KEYS.taskTraceFileService, this.taskTraceFileService)

    this.taskTraceService =
      deps.taskTraceService ??
      new TaskTraceService({
        prisma: this.context.prisma,
      })
    registry.register(SERVICE_KEYS.taskTraceService, this.taskTraceService)

    this.settingsFacade =
      deps.settingsFacade ??
      new SettingsFacade({
        settingsService: this.settingsService,
        personalSettingsService: this.personalSettingsService,
        healthService: this.healthService,
        appInfoService: this.appInfoService,
        syncSharedAnonymousQuota,
        invalidateQuotaPolicyCache,
      })
    registry.register(SERVICE_KEYS.settingsFacade, this.settingsFacade)

    // Phase 3: New Utils-layer Services
    this.systemSettingsService =
      deps.systemSettingsService ??
      new SystemSettingsService({
        prisma: this.context.prisma,
      })
    registry.register(SERVICE_KEYS.systemSettingsService, this.systemSettingsService)

    this.anonymousCleanupService =
      deps.anonymousCleanupService ??
      new AnonymousCleanupService({
        prisma: this.context.prisma,
        getQuotaPolicy,
        deleteAttachmentsForSessions,
      })
    registry.register(SERVICE_KEYS.anonymousCleanupService, this.anonymousCleanupService)

    this.chatImageService =
      deps.chatImageService ??
      new ChatImageService({
        prisma: this.context.prisma,
      })
    registry.register(SERVICE_KEYS.chatImageService, this.chatImageService)

    this.taskTraceConfigService =
      deps.taskTraceConfigService ??
      new TaskTraceConfigService({
        prisma: this.context.prisma,
      })
    registry.register(SERVICE_KEYS.taskTraceConfigService, this.taskTraceConfigService)

    registry.markInitialized()
  }
}

export const createAppContainer = (deps?: AppContainerDeps) => new AppContainer(deps)
