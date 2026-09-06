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
import { SecretVaultService } from '../services/secret-vault'
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
import { BattleService } from '../services/battle/battle-service'
import { BattleExecutor } from '../services/battle/battle-executor'
import { BattleImageService } from '../services/battle/battle-image-service'
import { ChatRequestBuilder } from '../agent-runtime/chat-request-builder'
import { PromptTemplateService } from '../services/prompt-templates/prompt-template-service'
import { ArtifactService } from '../services/workspace/artifact-service'
import { WorkspaceService } from '../services/workspace/workspace-service'
import { WorkspaceCleanupService } from '../services/workspace/workspace-cleanup-service'
import { PythonRuntimeService } from '../services/python-runtime/python-runtime-service'
import { SystemLogService } from '../services/system-logs/system-log-service'

// Phase 3: New Utils-layer Services
import { SystemSettingsService } from '../services/settings/system-settings-service'
import { AnonymousCleanupService } from '../services/cleanup/anonymous-cleanup-service'
import { ChatImageService } from '../services/attachment/chat-image-service'
import { TaskTraceConfigService } from '../services/task-trace/task-trace-config-service'
import { StreamSettingsService } from '../services/stream'
import { ImageGenerationService } from '../services/image-generation'
import { McpService } from '../services/mcp'
import { SkillInstaller } from '../modules/skills/skill-installer'
import { SkillApprovalService } from '../modules/skills/skill-approval-service'
import { ProviderRequester } from '../agent-runtime/provider-requester'
import { NonStreamFallbackService } from '../modules/chat/services/non-stream-fallback-service'
import { AssistantProgressService } from '../modules/chat/services/assistant-progress-service'
import { StreamUsageService } from '../modules/chat/services/stream-usage-service'
import { StreamTraceService } from '../modules/chat/services/stream-trace-service'
import { StreamSseService } from '../modules/chat/services/stream-sse-service'
import { ReasoningCompatibilityService } from '../modules/chat/services/reasoning-compatibility-service'
import { ConversationCompressionService } from '../modules/chat/services/conversation-compression-service'
import { ChatMessageQueryService } from '../modules/chat/services/message-query-service'
import { NonStreamChatService } from '../modules/chat/services/non-stream-chat-service'
import { TitleSummaryService } from '../modules/chat/services/title-summary-service'
import { VisionProxyService } from '../services/vision/vision-proxy-service'

import { AuthUtils } from '../utils/auth'
import {
  refreshAllModelCatalog,
  refreshModelCatalogForConnectionGroup,
  refreshModelCatalogForConnectionGroups,
  refreshModelCatalogForConnectionGroupId,
} from '../utils/model-catalog'
import { verifyConnection, computeCapabilities, deriveChannelName } from '../utils/providers'
import { parseCapabilityEnvelope, normalizeCapabilityFlags, serializeCapabilityEnvelope } from '../utils/capabilities'
import {
  getQuotaPolicy,
  getBattlePolicy,
  invalidateQuotaPolicyCache,
  invalidateBattlePolicyCache,
  invalidateReasoningMaxOutputTokensDefaultCache,
  configureSystemSettingsUtils,
} from '../utils/system-settings'
import {
  invalidateCompletionLimitCache,
  invalidateContextWindowCache,
  configureContextWindowUtils,
} from '../utils/context-window'
import { invalidateTaskTraceConfig, configureTaskTraceUtils } from '../utils/task-trace'
import { syncSharedAnonymousQuota, configureQuotaUtils } from '../utils/quota'
import { replaceProfileImage } from '../utils/profile-images'
import { deleteAttachmentsForSessions, configureChatImagesUtils } from '../utils/chat-images'
import { configureAnonymousCleanupUtils } from '../utils/anonymous-cleanup'
import { configureTokenizerUtils } from '../utils/tokenizer'
import { BackendLogger as log } from '../utils/logger'
import { ServiceRegistry } from './service-registry'
import { SERVICE_KEYS } from './service-keys'

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
  battleService?: BattleService
  promptTemplateService?: PromptTemplateService
  artifactService?: ArtifactService
  workspaceService?: WorkspaceService
  workspaceCleanupService?: WorkspaceCleanupService
  pythonRuntimeService?: PythonRuntimeService
  systemLogService?: SystemLogService

  // Phase 3: New Utils-layer Services
  systemSettingsService?: SystemSettingsService
  anonymousCleanupService?: AnonymousCleanupService
  chatImageService?: ChatImageService
  taskTraceConfigService?: TaskTraceConfigService
  streamSettingsService?: StreamSettingsService
  imageGenerationService?: ImageGenerationService
  mcpService?: McpService
  skillInstaller?: SkillInstaller
  skillApprovalService?: SkillApprovalService
  providerRequester?: ProviderRequester
  nonStreamFallbackService?: NonStreamFallbackService
  assistantProgressService?: AssistantProgressService
  streamUsageService?: StreamUsageService
  streamTraceService?: StreamTraceService
  streamSseService?: StreamSseService
  reasoningCompatibilityService?: ReasoningCompatibilityService
  conversationCompressionService?: ConversationCompressionService
  chatMessageQueryService?: ChatMessageQueryService
  nonStreamChatService?: NonStreamChatService
  titleSummaryService?: TitleSummaryService
  visionProxyService?: VisionProxyService
}

export class AppContainer {
  readonly context: AppContext
  readonly secretVault: SecretVaultService
  readonly chatRequestBuilder: ChatRequestBuilder
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
  readonly battleService: BattleService
  readonly promptTemplateService: PromptTemplateService
  readonly artifactService: ArtifactService
  readonly workspaceService: WorkspaceService
  readonly workspaceCleanupService: WorkspaceCleanupService
  readonly pythonRuntimeService: PythonRuntimeService
  readonly systemLogService: SystemLogService
  readonly streamSettingsService: StreamSettingsService
  readonly imageGenerationService: ImageGenerationService
  readonly mcpService: McpService
  readonly skillInstaller: SkillInstaller
  readonly skillApprovalService: SkillApprovalService
  readonly providerRequester: ProviderRequester
  readonly nonStreamFallbackService: NonStreamFallbackService
  readonly assistantProgressService: AssistantProgressService
  readonly streamUsageService: StreamUsageService
  readonly streamTraceService: StreamTraceService
  readonly streamSseService: StreamSseService
  readonly reasoningCompatibilityService: ReasoningCompatibilityService
  readonly conversationCompressionService: ConversationCompressionService
  readonly chatMessageQueryService: ChatMessageQueryService
  readonly nonStreamChatService: NonStreamChatService
  readonly titleSummaryService: TitleSummaryService
  readonly visionProxyService: VisionProxyService

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

    // SecretVault 全进程唯一实例：chat/battle/image-generation/model-catalog 等共用，
    // 避免各处重复构造导致 master-key 校验与加密上下文分叉。
    try {
      this.secretVault = new SecretVaultService()
    } catch (error) {
      log.error('Secret Vault 初始化失败，请设置 SECRET_VAULT_MASTER_KEY。', error)
      throw error
    }
    // ChatRequestBuilder 全进程唯一实例（带 vault 解密能力），battle 与 chat 共用。
    this.chatRequestBuilder = new ChatRequestBuilder({
      prisma: this.context.prisma,
      secretVault: this.secretVault,
    })

    // Chat / stream collaborators are wired here instead of being constructed ad-hoc
    // in index.ts. This keeps every singleton behind one composition root.
    this.streamSettingsService =
      deps.streamSettingsService ??
      new StreamSettingsService({ prisma: this.context.prisma })
    registry.register(SERVICE_KEYS.streamSettingsService, this.streamSettingsService)

    this.providerRequester = deps.providerRequester ?? new ProviderRequester()
    registry.register(SERVICE_KEYS.providerRequester, this.providerRequester)

    this.imageGenerationService =
      deps.imageGenerationService ??
      new ImageGenerationService({ secretVault: this.secretVault })
    registry.register(SERVICE_KEYS.imageGenerationService, this.imageGenerationService)

    this.nonStreamFallbackService =
      deps.nonStreamFallbackService ?? new NonStreamFallbackService()
    registry.register(SERVICE_KEYS.nonStreamFallbackService, this.nonStreamFallbackService)

    this.assistantProgressService =
      deps.assistantProgressService ??
      new AssistantProgressService({ prisma: this.context.prisma })
    registry.register(SERVICE_KEYS.assistantProgressService, this.assistantProgressService)

    this.streamUsageService = deps.streamUsageService ?? new StreamUsageService()
    registry.register(SERVICE_KEYS.streamUsageService, this.streamUsageService)

    this.streamTraceService = deps.streamTraceService ?? new StreamTraceService()
    registry.register(SERVICE_KEYS.streamTraceService, this.streamTraceService)

    this.streamSseService = deps.streamSseService ?? new StreamSseService()
    registry.register(SERVICE_KEYS.streamSseService, this.streamSseService)

    this.reasoningCompatibilityService =
      deps.reasoningCompatibilityService ??
      new ReasoningCompatibilityService({ prisma: this.context.prisma })
    registry.register(SERVICE_KEYS.reasoningCompatibilityService, this.reasoningCompatibilityService)

    this.conversationCompressionService =
      deps.conversationCompressionService ??
      new ConversationCompressionService({
        prisma: this.context.prisma,
        secretVault: this.secretVault,
      })
    registry.register(SERVICE_KEYS.conversationCompressionService, this.conversationCompressionService)

    this.chatMessageQueryService =
      deps.chatMessageQueryService ??
      new ChatMessageQueryService({ prisma: this.context.prisma })
    registry.register(SERVICE_KEYS.chatMessageQueryService, this.chatMessageQueryService)

    this.nonStreamChatService =
      deps.nonStreamChatService ??
      new NonStreamChatService({
        prisma: this.context.prisma,
        requestBuilder: this.chatRequestBuilder,
        requester: this.providerRequester,
      })
    registry.register(SERVICE_KEYS.nonStreamChatService, this.nonStreamChatService)

    this.titleSummaryService =
      deps.titleSummaryService ??
      new TitleSummaryService({ prisma: this.context.prisma, secretVault: this.secretVault })
    registry.register(SERVICE_KEYS.titleSummaryService, this.titleSummaryService)

    this.visionProxyService =
      deps.visionProxyService ??
      new VisionProxyService({ secretVault: this.secretVault })
    registry.register(SERVICE_KEYS.visionProxyService, this.visionProxyService)

    this.skillInstaller =
      deps.skillInstaller ?? new SkillInstaller({ prisma: this.context.prisma })
    registry.register(SERVICE_KEYS.skillInstaller, this.skillInstaller)

    this.skillApprovalService =
      deps.skillApprovalService ??
      new SkillApprovalService({ prisma: this.context.prisma })
    registry.register(SERVICE_KEYS.skillApprovalService, this.skillApprovalService)

    this.mcpService =
      deps.mcpService ??
      new McpService({
        prisma: this.context.prisma,
        getSystemSetting: async (key: string) => {
          try {
            const setting = await this.context.prisma.systemSetting.findUnique({ where: { key } })
            return setting?.value ?? null
          } catch {
            return null
          }
        },
      })
    registry.register(SERVICE_KEYS.mcpService, this.mcpService)

    this.connectionService =
      deps.connectionService ??
      new ConnectionService({
        repository: this.connectionRepository,
        secretVault: this.secretVault,
        // 刷新模型目录必须带上 vault，否则 bearer 连接会以空 Key 请求上游并 401
        refreshModelCatalog: (group, credential) =>
          refreshModelCatalogForConnectionGroup(group, credential, this.secretVault),
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
    configureQuotaUtils({ quotaService: this.quotaService })

    this.tokenizerService = deps.tokenizerService ?? new TokenizerService()
    registry.register(SERVICE_KEYS.tokenizerService, this.tokenizerService)
    configureTokenizerUtils({ tokenizerService: this.tokenizerService })

    this.contextWindowService = deps.contextWindowService ?? new ContextWindowService()
    registry.register(SERVICE_KEYS.contextWindowService, this.contextWindowService)
    configureContextWindowUtils({ contextWindowService: this.contextWindowService })

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

    this.battleService =
      deps.battleService ??
      new BattleService({
        prisma: this.context.prisma,
        modelResolver: this.modelResolverService,
        imageService: new BattleImageService(),
        // 对战执行必须复用带 vault 的 ChatRequestBuilder（全进程唯一实例），
        // 否则 bearer 连接无法解密 API Key
        executor: new BattleExecutor({
          requestBuilder: this.chatRequestBuilder,
        }),
      })
    registry.register(SERVICE_KEYS.battleService, this.battleService)

    this.workspaceService =
      deps.workspaceService ??
      new WorkspaceService({
        prisma: this.context.prisma,
      })
    registry.register(SERVICE_KEYS.workspaceService, this.workspaceService)

    this.artifactService =
      deps.artifactService ??
      new ArtifactService({
        prisma: this.context.prisma,
      })
    registry.register(SERVICE_KEYS.artifactService, this.artifactService)

    this.sessionService =
      deps.sessionService ??
      new SessionService({
        prisma: this.context.prisma,
        modelResolverService: this.modelResolverService,
        artifactService: this.artifactService,
        workspaceService: this.workspaceService,
        logger: this.context.logger,
      })
    registry.register(SERVICE_KEYS.sessionService, this.sessionService)

    this.workspaceCleanupService =
      deps.workspaceCleanupService ??
      new WorkspaceCleanupService({
        workspaceService: this.workspaceService,
        artifactService: this.artifactService,
      })
    registry.register(SERVICE_KEYS.workspaceCleanupService, this.workspaceCleanupService)

    this.promptTemplateService =
      deps.promptTemplateService ??
      new PromptTemplateService({
        prisma: this.context.prisma,
        logger: this.context.logger,
      })
    registry.register(SERVICE_KEYS.promptTemplateService, this.promptTemplateService)

    this.pythonRuntimeService =
      deps.pythonRuntimeService ??
      new PythonRuntimeService({
        prisma: this.context.prisma,
        env: process.env,
        platform: process.platform,
      })
    registry.register(SERVICE_KEYS.pythonRuntimeService, this.pythonRuntimeService)

    this.systemLogService =
      deps.systemLogService ??
      new SystemLogService()
    registry.register(SERVICE_KEYS.systemLogService, this.systemLogService)

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
        refreshAllModelCatalog: () => refreshAllModelCatalog(this.secretVault),
        refreshModelCatalogForConnectionGroups: (groups) =>
          refreshModelCatalogForConnectionGroups(groups, this.secretVault),
        refreshModelCatalogForConnectionGroupId: (connectionGroupId) =>
          refreshModelCatalogForConnectionGroupId(connectionGroupId, this.secretVault),
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
    configureSystemSettingsUtils({ systemSettingsService: this.systemSettingsService })

    this.anonymousCleanupService =
      deps.anonymousCleanupService ??
      new AnonymousCleanupService({
        prisma: this.context.prisma,
        getQuotaPolicy,
        deleteAttachmentsForSessions,
      })
    registry.register(SERVICE_KEYS.anonymousCleanupService, this.anonymousCleanupService)
    configureAnonymousCleanupUtils({ anonymousCleanupService: this.anonymousCleanupService })

    this.chatImageService =
      deps.chatImageService ??
      new ChatImageService({
        prisma: this.context.prisma,
      })
    registry.register(SERVICE_KEYS.chatImageService, this.chatImageService)
    configureChatImagesUtils({ chatImageService: this.chatImageService })

    this.taskTraceConfigService =
      deps.taskTraceConfigService ??
      new TaskTraceConfigService({
        prisma: this.context.prisma,
      })
    registry.register(SERVICE_KEYS.taskTraceConfigService, this.taskTraceConfigService)
    configureTaskTraceUtils({ taskTraceConfigService: this.taskTraceConfigService })

    registry.markInitialized()
  }
}

export const createAppContainer = (deps?: AppContainerDeps) => new AppContainer(deps)
