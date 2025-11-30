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
import { ConnectionService, setConnectionService } from '../services/connections'
import { ModelResolverService, setModelResolverServiceInstance } from '../services/catalog/model-resolver-service'
import { setModelResolverService } from '../utils/model-resolver'
import { setModelCatalogService } from '../services/catalog'
import { ModelCatalogService } from '../services/catalog/model-catalog-service'
import { SessionService, setSessionService } from '../services/sessions/session-service'
import { UserService } from '../services/users/user-service'
import { setUserService } from '../services/users'
import { AuthService, setAuthService } from '../services/auth/auth-service'
import { AuthContextService, setAuthContextService } from '../services/auth/auth-context-service'
import { QuotaService, setQuotaService } from '../services/quota/quota-service'
import { TokenizerService, setTokenizerService } from '../services/tokenizer/tokenizer-service'
import { ContextWindowService, setContextWindowService } from '../services/context/context-window-service'
import { OpenAICompatMessageService, setOpenAICompatMessageService } from '../services/openai-compat/message-service'
import { SettingsService, setSettingsService } from '../services/settings'
import { PersonalSettingsService, setPersonalSettingsService } from '../services/settings/personal-settings-service'
import { SettingsFacade, setSettingsFacade } from '../services/settings/settings-facade'
import { AppInfoService, setAppInfoService } from '../services/settings/app-info-service'
import { HealthService, setHealthService } from '../services/settings/health-service'
import { TaskTraceService, setTaskTraceService } from '../services/task-trace/task-trace-service'
import { TaskTraceFileService, setTaskTraceFileService } from '../services/task-trace/task-trace-file-service'
import { ChatService, setChatService } from '../services/chat/chat-service'
import { ShareService, setShareService } from '../services/shares'
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
  invalidateQuotaPolicyCache,
  invalidateReasoningMaxOutputTokensDefaultCache,
} from '../utils/system-settings'
import { invalidateCompletionLimitCache, invalidateContextWindowCache } from '../utils/context-window'
import { invalidateTaskTraceConfig } from '../utils/task-trace'
import { syncSharedAnonymousQuota } from '../utils/quota'
import { replaceProfileImage } from '../utils/profile-images'
import { BackendLogger as log } from '../utils/logger'

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

  constructor(deps: AppContainerDeps = {}) {
    this.context = deps.context ?? createAppContext()
    this.connectionRepository =
      deps.connectionRepository ?? new PrismaConnectionRepository(this.context.prisma)
    this.modelResolverRepository =
      deps.modelResolverRepository ?? new PrismaModelResolverRepository(this.context.prisma)
    this.modelResolverService =
      deps.modelResolverService ??
      new ModelResolverService({
        repository: this.modelResolverRepository,
      })
    setModelResolverServiceInstance(this.modelResolverService)
    setModelResolverService(this.modelResolverService)
    this.connectionService =
      deps.connectionService ??
      new ConnectionService({
        repository: this.connectionRepository,
        encryptApiKey: AuthUtils.encryptApiKey,
        refreshModelCatalog: refreshModelCatalogForConnection,
        verifyConnection,
        logger: log,
      })
    setConnectionService(this.connectionService)
    this.quotaService =
      deps.quotaService ??
      new QuotaService({
        prisma: this.context.prisma,
        getQuotaPolicy,
      })
    setQuotaService(this.quotaService)
    this.tokenizerService = deps.tokenizerService ?? new TokenizerService()
    setTokenizerService(this.tokenizerService)
    this.contextWindowService = deps.contextWindowService ?? new ContextWindowService()
    setContextWindowService(this.contextWindowService)
    this.sessionService =
      deps.sessionService ??
      new SessionService({
        prisma: this.context.prisma,
        modelResolverService: this.modelResolverService,
        logger: this.context.logger,
      })
    setSessionService(this.sessionService)
    this.chatService =
      deps.chatService ??
      new ChatService({
        prisma: this.context.prisma,
        logger: this.context.logger,
      })
    setChatService(this.chatService)
    this.shareService =
      deps.shareService ??
      new ShareService({
        prisma: this.context.prisma,
        logger: this.context.logger,
      })
    setShareService(this.shareService)
    this.userService =
      deps.userService ??
      new UserService({
        prisma: this.context.prisma,
        authUtils: AuthUtils,
        inspectActorQuota: (actor, options) => this.quotaService.inspectActorQuota(actor, options as any),
        logger: this.context.logger,
      })
    setUserService(this.userService)
    this.authContextService =
      deps.authContextService ??
      new AuthContextService({
        prisma: this.context.prisma,
        authUtils: AuthUtils,
        getQuotaPolicy,
      })
    setAuthContextService(this.authContextService)
    this.authService =
      deps.authService ??
      new AuthService({
        prisma: this.context.prisma,
        authUtils: AuthUtils,
        inspectActorQuota: (actor, options) => this.quotaService.inspectActorQuota(actor, options as any),
      })
    setAuthService(this.authService)
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
    setModelCatalogService(this.modelCatalogService)
    this.openaiCompatMessageService =
      deps.openaiCompatMessageService ??
      new OpenAICompatMessageService({
        prisma: this.context.prisma,
        logger: this.context.logger,
      })
    setOpenAICompatMessageService(this.openaiCompatMessageService)
    this.settingsService =
      deps.settingsService ??
      new SettingsService({
        prisma: this.context.prisma,
        getQuotaPolicy,
        invalidateQuotaPolicyCache,
        invalidateReasoningMaxOutputTokensDefaultCache,
        invalidateTaskTraceConfig,
        syncSharedAnonymousQuota,
        replaceProfileImage,
      })
    setSettingsService(this.settingsService)
    this.personalSettingsService =
      deps.personalSettingsService ??
      new PersonalSettingsService({
        prisma: this.context.prisma,
      })
    setPersonalSettingsService(this.personalSettingsService)
    this.appInfoService = deps.appInfoService ?? new AppInfoService({ prisma: this.context.prisma })
    setAppInfoService(this.appInfoService)
    this.healthService = deps.healthService ?? new HealthService({ prisma: this.context.prisma })
    setHealthService(this.healthService)
    this.taskTraceFileService = deps.taskTraceFileService ?? new TaskTraceFileService()
    setTaskTraceFileService(this.taskTraceFileService)
    this.taskTraceService =
      deps.taskTraceService ??
      new TaskTraceService({
        prisma: this.context.prisma,
      })
    setTaskTraceService(this.taskTraceService)
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
    setSettingsFacade(this.settingsFacade)
  }
}

export const createAppContainer = (deps?: AppContainerDeps) => new AppContainer(deps)
