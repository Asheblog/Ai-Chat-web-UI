// 用户相关类型
import type { BrandThemeColors } from '@aichat/shared'
import type {
  ResearchPlanApprovalState,
  ResearchPlanPayload,
} from '@aichat/shared/chat-stream-contract'
import type {
  ApiResponse,
  AuthResponse,
  ModelPreferenceDTO,
  RegisterResponse,
} from '@aichat/shared/api-contract'
import type {
  ActorQuota,
  GeneratedImage,
  ToolCallPhase,
  ToolCallSource,
  ToolInterventionState,
  UsageStats,
  WebSearchHit,
  WorkspaceArtifact,
} from '@aichat/shared/api-contract'
import type {
  RichMessageEvidenceConfidence,
  RichMessagePayload,
} from '@aichat/shared/rich-payload'
import type {
  SystemSettings,
  WebSearchBilingualMode,
  WebSearchEngine,
  WebSearchMergeStrategy,
} from '@aichat/shared/settings-codec'

export type {
  ApiResponse,
  AuthResponse,
  ModelPreferenceDTO,
  RegisterResponse,
} from '@aichat/shared/api-contract'

export type {
  SystemSettings,
  WebSearchBilingualMode,
  WebSearchEngine,
  WebSearchMergeStrategy,
} from '@aichat/shared/settings-codec'

export interface User {
  id: number;
  username: string;
  role: 'ADMIN' | 'USER';
  createdAt: string;
  status: 'PENDING' | 'ACTIVE' | 'DISABLED';
  avatarUrl?: string | null;
  personalPrompt?: string | null;
}

export type {
  ActorQuota,
  ActorQuotaScope,
} from '@aichat/shared/api-contract'

export type AnonymousActorProfile = {
  type: 'anonymous';
  key: string;
  identifier: string;
  expiresAt: string | null;
};

export type UserActorProfile = {
  type: 'user';
  id: number;
  username: string;
  role: 'ADMIN' | 'USER';
  status: 'PENDING' | 'ACTIVE' | 'DISABLED';
  identifier: string;
  preferredModel?: ModelPreferenceDTO | null;
  avatarUrl?: string | null;
  personalPrompt?: string | null;
};

export type ActorProfile = AnonymousActorProfile | UserActorProfile;

export interface ActorContextDTO {
  actor: ActorProfile;
  quota: ActorQuota | null;
  user?: User | null;
  preferredModel?: ModelPreferenceDTO | null;
  assistantAvatarUrl?: string | null;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface RegisterRequest extends LoginRequest {
  confirmPassword?: string;
}

// 旧版模型配置已移除，统一由聚合模型目录（/catalog/models）提供能力元数据

// 聊天会话类型
export interface ChatSession {
  id: number;
  userId: number;
  connectionId?: number | null;
  modelRawId?: string | null;
  modelLabel?: string | null;
  title: string;
  createdAt: string;
  pinnedAt?: string | null;
  reasoningEnabled?: boolean | null;
  reasoningEffort?: 'low' | 'medium' | 'high' | 'max' | 'xhigh' | null;
  ollamaThink?: boolean | null;
  systemPrompt?: string | null;
  knowledgeBaseIds?: number[];
  lastMessagePreview?: string | null;
  lastMessageAt?: string | null;
  messages?: Message[];
  _count?: {
    messages: number;
  };
}

export interface CreateSessionRequest {
  modelId: string;
  title?: string;
}

// 消息类型
// AI 生成的图片类型（与 shared 保持一致）
export type { GeneratedImage } from '@aichat/shared/api-contract'

export type { WorkspaceArtifact } from '@aichat/shared/api-contract'

export interface CompressedGroupMessage {
  id: number;
  role: string;
  content: string;
  createdAt: string;
}

export type {
  RichMessageEvidenceConfidence,
  RichMessageEvidenceKind,
  RichMessageImagePart,
  RichMessageImageSource,
  RichMessageLayout,
  RichMessagePart,
  RichMessagePayload,
  RichMessageTextPart,
} from '@aichat/shared/rich-payload'

export interface Message {
  id: number | string;
  sessionId: number;
  stableKey?: string | null;
  parentMessageId?: number | string | null;
  variantIndex?: number | null;
  role: 'user' | 'assistant' | 'compressedGroup';
  content: string;
  createdAt: string;
  clientMessageId?: string | null;
  reasoning?: string | null;
  reasoningDurationSeconds?: number | null;
  reasoningStatus?: 'idle' | 'streaming' | 'done';
  reasoningIdleMs?: number | null;
  reasoningUnavailableCode?: string | null;
  reasoningUnavailableReason?: string | null;
  reasoningUnavailableSuggestion?: string | null;
  streamStatus?: 'pending' | 'streaming' | 'done' | 'error' | 'cancelled';
  streamCursor?: number;
  streamReasoning?: string | null;
  streamError?: string | null;
  // 可选图片：可能为 data URL（本地预览）或服务端返回的可访问 URL（用户上传）
  images?: string[];
  // 图片转写代理生成的图片描述（转写模型 + 描述文本）
  imageDescriptions?: Array<{ description: string; modelRawId: string }> | null;
  // AI 生成的图片（生图模型输出）
  generatedImages?: GeneratedImage[];
  richPayload?: RichMessagePayload | null;
  artifacts?: WorkspaceArtifact[];
  toolEvents?: ToolEvent[];
  metrics?: MessageStreamMetrics | null;
  messageGroupId?: number | null;
  compressedMessages?: CompressedGroupMessage[];
  lastMessageId?: number | null;
  expanded?: boolean;
  metadata?: Record<string, unknown> | null;
}

export interface MessageMeta {
  id: number | string;
  sessionId: number;
  stableKey: string;
  parentMessageId?: number | string | null;
  variantIndex?: number | null;
  role: 'user' | 'assistant' | 'compressedGroup';
  createdAt: string;
  clientMessageId?: string | null;
  reasoningStatus?: 'idle' | 'streaming' | 'done';
  reasoningDurationSeconds?: number | null;
  reasoningIdleMs?: number | null;
  reasoningUnavailableCode?: string | null;
  reasoningUnavailableReason?: string | null;
  reasoningUnavailableSuggestion?: string | null;
  images?: string[];
  imageDescriptions?: Array<{ description: string; modelRawId: string }> | null;
  generatedImages?: GeneratedImage[];
  richPayload?: RichMessagePayload | null;
  artifacts?: WorkspaceArtifact[];
  isPlaceholder?: boolean;
  streamStatus?: 'pending' | 'streaming' | 'done' | 'error' | 'cancelled';
  streamError?: string | null;
  pendingSync?: boolean;
  messageGroupId?: number | null;
  compressedMessages?: CompressedGroupMessage[];
  lastMessageId?: number | null;
  expanded?: boolean;
  metadata?: Record<string, unknown> | null;
}

export interface MessageBody {
  id: number | string;
  stableKey: string;
  content: string;
  reasoning?: string | null;
  reasoningPlayedLength?: number;
  version: number;
  reasoningVersion: number;
  toolEvents?: ToolEvent[];
  generatedImages?: GeneratedImage[];
  richPayload?: RichMessagePayload | null;
  artifacts?: WorkspaceArtifact[];
  compressedMessages?: CompressedGroupMessage[];
  expanded?: boolean;
  metadata?: Record<string, unknown> | null;
}

export interface MessageRenderCacheEntry {
  contentHtml: string | null;
  reasoningHtml: string | null;
  contentVersion: number;
  reasoningVersion: number;
  updatedAt: number;
  /** 缓存创建时是否处于流式传输状态，用于在流式结束后强制刷新 */
  isStreaming?: boolean;
}

export interface CreateMessageRequest {
  sessionId: number;
  content: string;
}

export interface ShareMessage {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string | null;
  createdAt: string;
  images?: string[];
  richPayload?: RichMessagePayload | null;
  toolEvents?: ToolEvent[];
}

export interface ChatShare {
  id: number;
  sessionId: number;
  token: string;
  title: string;
  sessionTitle: string;
  messageCount: number;
  messages: ShareMessage[];
  isLive?: boolean;
  streamingMessageIds?: number[];
  createdAt: string;
  expiresAt?: string | null;
  revokedAt?: string | null;
}

export interface ShareMessagesPage {
  token: string;
  sessionId: number;
  messages: ShareMessage[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface PromptTemplate {
  id: number;
  userId: number;
  title: string;
  content: string;
  variables: string[];
  pinnedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChatShareSummary {
  id: number;
  sessionId: number;
  token: string;
  title: string;
  sessionTitle: string;
  messageCount: number;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
}

export interface ShareListResponse {
  shares: ChatShareSummary[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// 系统设置类型
export interface SystemSetting {
  key: string;
  value: string;
}

// SystemSettings / WebSearchEngine / WebSearchBilingualMode / WebSearchMergeStrategy
// 已收敛至 @aichat/shared/settings-codec，见文件顶部 re-export。

export interface PythonRuntimeIndexes {
  indexUrl?: string;
  extraIndexUrls: string[];
  trustedHosts: string[];
  autoInstallOnActivate: boolean;
  autoInstallOnMissing: boolean;
}

export interface PythonRuntimeInstalledPackage {
  name: string;
  version: string;
}

export type PythonRuntimePackageSourceTag = 'manual' | 'skill_manifest' | 'skill_auto' | 'python_auto';

export interface PythonRuntimePackageSourceItem {
  name: string;
  sources: PythonRuntimePackageSourceTag[];
}

export interface PythonRuntimeDependencyItem {
  skillId: number;
  skillSlug: string;
  skillDisplayName: string;
  versionId: number;
  version: string;
  requirement: string;
  packageName: string;
}

export interface PythonRuntimeConflictItem {
  packageName: string;
  requirements: string[];
  skills: Array<{
    skillId: number;
    skillSlug: string;
    versionId: number;
    version: string;
    requirement: string;
  }>;
}

export interface PythonRuntimeStatus {
  dataRoot: string;
  runtimeRoot: string;
  venvPath: string;
  pythonPath: string;
  ready: boolean;
  runtimeIssue?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
  indexes: PythonRuntimeIndexes;
  manualPackages: string[];
  installedPackages: PythonRuntimeInstalledPackage[];
  packageSources: PythonRuntimePackageSourceItem[];
  activeDependencies: PythonRuntimeDependencyItem[];
  conflicts: PythonRuntimeConflictItem[];
}

// UI 状态类型
export interface ChatState {
  currentSession: ChatSession | null;
  sessions: ChatSession[];
  messageMetas: MessageMeta[];
  messageBodies: Record<string, MessageBody>;
  messageRenderCache: Record<string, MessageRenderCacheEntry>;
  isSessionsLoading: boolean;
  isMessagesLoading: boolean;
  isStreaming: boolean;
  activeStreamSessionId: number | null;
  error: string | null;
  messageImageCache: Record<string, string[]>;
  messagesHydrated: Record<number, boolean>;
  messagePaginationBySession: Record<number, {
    oldestLoadedPage: number;
    newestLoadedPage: number;
    totalPages: number;
    limit: number;
    hasOlder: boolean;
    isLoadingOlder: boolean;
  }>;
  // usage 展示状态
  usageCurrent?: UsageStats | null;
  usageLastRound?: UsageStats | null;
  usageTotals?: UsageTotals | null;
  sessionUsageTotalsMap: Record<number, UsageTotals>;
  toolEvents: ToolEvent[];
  assistantVariantSelections: Record<string, number | string>;
  messageMetrics: Record<string, MessageStreamMetrics>;
  shareSelection: {
    enabled: boolean;
    sessionId: number | null;
    selectedMessageIds: number[];
  };
  streamingSessions?: Record<number, number>;
  activeStreamCount?: number;
}

export type { WebSearchHit } from '@aichat/shared/api-contract'

export interface ToolEventDetails {
  // 通用工具调用字段（ToolCall V2）
  argumentsText?: string;
  argumentsPatch?: string;
  resultText?: string;
  resultJson?: unknown;
  url?: string;
  title?: string;
  excerpt?: string;
  wordCount?: number;
  siteName?: string;
  byline?: string;
  leadImageUrl?: string;
  images?: Array<{
    url: string;
    alt?: string;
    source?: string;
    width?: number;
    height?: number;
    confidence?: RichMessageEvidenceConfidence;
    description?: string;
    title?: string;
  }>;
  assessedImages?: Array<{
    url: string;
    title?: string;
    alt?: string;
    sourceUrl?: string;
    confidence?: RichMessageEvidenceConfidence;
    description?: string;
    relevance?: string;
  }>;
  requestedLimit?: number | null;
  appliedLimit?: number | null;
  warning?: string;
  groupId?: string;
  taskType?: 'search' | 'read_url' | string;
  engine?: string;
  queryLanguage?: 'zh' | 'en' | 'unknown' | string;
  originalQuery?: string;
  expandedQuery?: string;
  queryIndex?: number;
  engineCount?: number;
  queryCount?: number;
  hitsCount?: number;
  searchTaskTotal?: number;
  searchTaskSucceeded?: number;
  searchTaskFailed?: number;
  autoReadEnabled?: boolean;
  autoReadRequested?: number;
  autoReadSucceeded?: number;
  autoReadFailed?: number;
  errorCode?: string;
  httpStatus?: number;
  fallbackUsed?: string;
  autoTriggered?: boolean;
  parentTool?: string;
  parentCallId?: string;
  rank?: number;
  code?: string;
  input?: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  durationMs?: number;
  truncated?: boolean;
  reasoningOffset?: number;
  reasoningOffsetStart?: number;
  reasoningOffsetEnd?: number;
  plan?: ResearchPlanPayload;
  approval?: ResearchPlanApprovalState;
  [key: string]: unknown;
}

export type {
  ToolCallPhase,
  ToolCallSource,
  ToolInterventionState,
} from '@aichat/shared/api-contract'

export interface ToolEvent {
  // 兼容字段（旧链路）
  id: string;
  sessionId: number;
  messageId: number | string;
  tool: string;
  stage: 'start' | 'result' | 'error';
  status: 'running' | 'success' | 'error' | 'pending' | 'rejected' | 'aborted';
  query?: string;
  hits?: WebSearchHit[];
  error?: string;
  summary?: string;
  createdAt: number;
  details?: ToolEventDetails;
  // ToolCall V2
  callId?: string;
  identifier?: string;
  apiName?: string;
  source?: ToolCallSource;
  phase?: ToolCallPhase;
  argumentsText?: string;
  argumentsPatch?: string;
  resultText?: string;
  resultJson?: unknown;
  intervention?: ToolInterventionState;
  thoughtSignature?: string | null;
  updatedAt?: number;
}

export interface SkillCatalogItem {
  id: number;
  namespaceKey?: string;
  slug: string;
  displayName: string;
  description?: string | null;
  sourceType?: string | null;
  sourceUrl?: string | null;
  sourceKey?: string | null;
  storeItemKey?: string | null;
  visibility?: 'system' | 'user_private' | string | null;
  ownerUserId?: number | null;
  licenseName?: string | null;
  licenseUrl?: string | null;
  licenseStatus?: string | null;
  status?: string | null;
  defaultVersion?: SkillVersionItem | null;
  versions?: SkillVersionItem[];
  sessionBinding?: {
    id: number;
    enabled: boolean;
    versionId?: number | null;
  } | null;
}

export interface SkillVersionItem {
  id: number;
  version: string;
  status: string;
  riskLevel?: string | null;
  sourceRef?: string | null;
  sourceSubdir?: string | null;
  createdAt?: string | Date | null;
  approvedAt?: string | Date | null;
  activatedAt?: string | Date | null;
  manifest?: Record<string, unknown>;
}

export interface SkillUninstallDependencyConsumer {
  skillId: number;
  skillSlug: string;
  skillDisplayName: string;
  versionId: number;
  version: string;
  requirement: string;
}

export interface SkillUninstallDependencySource {
  packageName: string;
  consumers: SkillUninstallDependencyConsumer[];
}

export interface SkillUninstallCleanupPlan {
  removedSkillPackages: string[];
  keptByActiveSkills: string[];
  keptByActiveSkillSources: SkillUninstallDependencySource[];
  keptByManual: string[];
  removablePackages: string[];
}

export interface SkillUninstallPreviewData {
  skillId: number;
  slug: string;
  displayName: string;
  removedRequirements: string[];
  packagePaths: string[];
  cleanupPlan: SkillUninstallCleanupPlan;
}

export interface SkillBindingItem {
  id: number;
  skillId: number;
  versionId?: number | null;
  scopeType: 'system' | 'user' | 'session' | 'battle_model';
  scopeId: string;
  enabled: boolean;
  policyJson?: string | null;
  overridesJson?: string | null;
  createdAt?: string | Date;
  updatedAt?: string | Date;
  skill?: {
    id: number;
    slug: string;
    displayName: string;
  };
  version?: {
    id: number;
    version: string;
    status: string;
  } | null;
}

export interface SkillApprovalRequestItem {
  id: number;
  skillId: number;
  versionId?: number | null;
  bindingId?: number | null;
  sessionId?: number | null;
  battleRunId?: number | null;
  messageId?: number | null;
  toolName: string;
  toolCallId?: string | null;
  status: 'pending' | 'approved' | 'denied' | 'expired';
  reason?: string | null;
  requestPayloadJson?: string | null;
  decisionNote?: string | null;
  requestedByActor: string;
  requestedAt?: string | Date | null;
  decidedAt?: string | Date | null;
  expiresAt?: string | Date | null;
  skill?: {
    id: number;
    slug: string;
    displayName: string;
  };
  version?: {
    id: number;
    version: string;
    status: string;
    riskLevel?: string | null;
  } | null;
  binding?: {
    id: number;
    scopeType: 'system' | 'user' | 'session' | 'battle_model';
    scopeId: string;
  } | null;
  decidedBy?: {
    id: number;
    username: string;
  } | null;
}

export interface SkillExecutionAuditItem {
  id: number;
  skillId: number;
  versionId?: number | null;
  approvalRequestId?: number | null;
  sessionId?: number | null;
  battleRunId?: number | null;
  messageId?: number | null;
  toolName: string;
  toolCallId?: string | null;
  requestPayloadJson?: string | null;
  responsePayloadJson?: string | null;
  approvalStatus?: string | null;
  platform?: string | null;
  durationMs?: number | null;
  error?: string | null;
  createdAt?: string | Date | null;
  skill?: {
    id: number;
    slug: string;
    displayName: string;
  };
  version?: {
    id: number;
    version: string;
    status: string;
    riskLevel?: string | null;
  } | null;
  approvalRequest?: {
    id: number;
    status: string;
    requestedAt?: string | Date | null;
    decidedAt?: string | Date | null;
    requestedByActor?: string;
    decidedByUserId?: number | null;
  } | null;
}

export interface SkillRuntimeReference {
  skillId: number;
  versionId: number;
  overrides?: Record<string, unknown>;
}

export interface SkillStoreSourceItem {
  key: string;
  name: string;
  repository: string;
  ref: string;
  description: string;
  homepageUrl: string;
  tags: string[];
  status: 'live' | 'fallback';
}

export interface SkillStoreItem {
  key: string;
  sourceKey: string;
  sourceName: string;
  sourceUrl: string;
  repository: string;
  ref: string;
  subdir: string;
  slug: string;
  displayName: string;
  description: string;
  skillUrl: string;
  licenseName?: string | null;
  licenseUrl?: string | null;
  licenseStatus: string;
  installable: boolean;
  tags: string[];
  installed?: {
    skillId: number;
    versionId?: number | null;
    version?: string | null;
    status: string;
  } | null;
}

export interface SkillStoreResponseData {
  items: SkillStoreItem[];
  sources: SkillStoreSourceItem[];
  refreshedAt: string;
  anonymous: boolean;
}

export interface SessionSkillOptionsData {
  items: SkillCatalogItem[];
}

export interface SkillApprovalEvent {
  type: 'skill_approval_request' | 'skill_approval_result';
  requestId: number;
  skillId: number;
  skillSlug: string;
  skillVersionId?: number;
  tool?: string;
  toolCallId?: string;
  reason?: string;
  decision?: 'approved' | 'denied' | 'expired';
  expiresAt?: string | Date;
}

export interface AuthState {
  actor: ActorProfile | null;
  user: User | null;
  quota: ActorQuota | null;
  actorState: 'loading' | 'anonymous' | 'authenticated';
  isLoading: boolean;
  error: string | null;
}

export interface SettingsState {
  contextEnabled: boolean;
  newConversationContextEnabled: boolean;
  systemSettings: SystemSettings | null;
  isLoading: boolean;
  error: string | null;
  publicBrandText: string | null;
  publicBrandTheme: BrandThemeColors | null;
  assistantAvatarReady: boolean;
  assistantAvatarReadyFor: string | null;
}

// API 响应类型（已收敛至 @aichat/shared/api-contract，见文件顶部 re-export）

// 流式响应类型（已收敛至 @aichat/shared/chat-stream-contract）
export type { ChatStreamChunk } from '@aichat/shared/api-contract'

/** API 错误类型（已收敛至 @aichat/shared/chat-stream-contract） */
export type { ApiErrorType } from '@aichat/shared/api-contract'

// Usage 统计类型（OpenAI 兼容字段为主，已收敛至 shared）
export type { UsageStats } from '@aichat/shared/api-contract'

export interface UsageTotals {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface SessionUsageTotalsItem {
  sessionId: number;
  totals: UsageTotals;
}

export interface MessageStreamMetrics {
  firstTokenLatencyMs?: number | null;
  responseTimeMs?: number | null;
  tokensPerSecond?: number | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  totalTokens?: number | null;
}

// 扩展聊天状态的 usage 字段
// （保留空）

// 组件 Props 类型
export interface MessageProps {
  message: Message;
  isStreaming?: boolean;
  onCopy?: (content: string) => void;
  onRegenerate?: (messageId: number | string) => void;
}

export interface TaskTraceSummary {
  id: number;
  sessionId: number | null;
  messageId: number | null;
  clientMessageId: string | null;
  actor: string;
  status: string;
  traceLevel: string;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  metadata?: Record<string, unknown> | null;
  eventCount: number;
  latexTrace?: LatexTraceSummary | null;
}

export interface TaskTraceEventRecord {
  id: number;
  seq: number;
  eventType: string;
  payload: any;
  timestamp: string;
}

export interface LatexTraceSummary {
  id: number;
  taskTraceId?: number;
  matchedBlocks: number;
  unmatchedBlocks: number;
  status: string;
  metadata?: Record<string, unknown> | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface LatexTraceEventRecord {
  seq: number;
  matched: boolean;
  reason: string;
  raw: string;
  normalized: string;
  trimmed: string;
}

export interface SessionItemProps {
  session: ChatSession;
  isActive: boolean;
  onSelect: (sessionId: number) => void;
  onDelete: (sessionId: number) => void;
  onRename: (sessionId: number, newTitle: string) => void;
}

export interface ModelSelectorProps {
  selectedModelId: string | null;
  onModelChange: (modelId: string) => void;
  disabled?: boolean;
}

export type {
  BattleMode,
  BattleContent,
  BattleContentInput,
  BattleUploadImage,
  RejudgeExpectedAnswerInput,
  BattleRunStatus,
  BattleSummaryStats,
  BattleRunSummary,
  BattleResult,
  BattleToolCallEvent,
  BattleRunDetail,
  BattleRunListResponse,
  BattleSharePayload,
  BattleShare,
  BattleStreamEvent,
  RejudgeStreamEvent,
} from '@aichat/shared/battle-contract';

// ─── MCP 相关 DTO ─────────────────────────────────────────────────────────

export interface McpInstallation {
  id: number
  namespaceKey: string
  name: string
  description?: string | null
  sourceType: 'remote' | 'local_package'
  sourceUrl?: string | null
  sourceKey?: string | null
  registrySource?: string | null
  transport: 'streamable_http' | 'sse' | 'stdio'
  endpoint?: string | null
  command?: string | null
  argsJson?: string | null
  envJson?: string | null
  status?: string | null
  version?: string | null
  createdAt: string
  updatedAt: string
}

export interface McpConnection {
  id: number
  installationId: number
  name: string
  enabled: boolean
  configJson?: string | null
  secretVaultId?: number | null
  ownerUserId?: number | null
  status?: string | null
  toolSetRevision?: number | null
  lastError?: string | null
  installation?: McpInstallation | null
  createdAt: string
  updatedAt: string
}

export interface McpBinding {
  id: number
  connectionId: number
  scopeType: 'system' | 'user' | 'session' | 'battle_model'
  scopeId: string
  enabled: boolean
  createdBy?: number | null
  createdAt: string
  updatedAt: string
  connection?: McpConnection | null
}

export interface McpToolView {
  id: number
  connectionId: number
  originalName: string
  description?: string | null
  inputSchemaJson?: string | null
  pinned?: boolean
  pinnedByUserId?: number | null
  toolSetRevision?: number | null
}

export interface McpToolDetail extends McpToolView {
  inputSchema: Record<string, unknown> | null
}

// ─── Secret Vault 相关 DTO ────────────────────────────────────────────────

export interface SecretView {
  id: number
  scope: string
  scopeId: string
  kind: string
  label: string
  hasValue: boolean
  refId: string | null
  refType: string | null
  createdAt: string
  updatedAt: string
}

export interface SecretCreateRequest {
  scope: 'system' | 'user'
  kind: 'api_key' | 'mcp_credential' | 'skill_secret'
  label: string
  value: string
  refType?: string
  refId?: string
}

export interface SecretUpdateRequest {
  label?: string
  kind?: 'api_key' | 'mcp_credential' | 'skill_secret'
  value?: string
  refType?: string | null
  refId?: string | null
}
