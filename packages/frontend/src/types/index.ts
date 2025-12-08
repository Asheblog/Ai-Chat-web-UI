// 用户相关类型
export interface User {
  id: number;
  username: string;
  role: 'ADMIN' | 'USER';
  createdAt: string;
  status: 'PENDING' | 'ACTIVE' | 'DISABLED';
  avatarUrl?: string | null;
  personalPrompt?: string | null;
}

export interface ModelPreferenceDTO {
  modelId: string | null;
  connectionId: number | null;
  rawId: string | null;
}

export interface AuthResponse {
  user: User;
  token: string;
}

export interface RegisterResponse {
  user: User;
  token?: string;
}

export type ActorQuotaScope = 'USER' | 'ANON';

export interface ActorQuota {
  scope: ActorQuotaScope;
  identifier: string;
  dailyLimit: number;
  usedCount: number;
  remaining: number | null;
  lastResetAt: string;
  unlimited: boolean;
  customDailyLimit: number | null;
  usingDefaultLimit: boolean;
}

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
  reasoningEffort?: 'low' | 'medium' | 'high' | null;
  ollamaThink?: boolean | null;
  systemPrompt?: string | null;
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
export interface Message {
  id: number | string;
  sessionId: number;
  stableKey?: string | null;
  parentMessageId?: number | string | null;
  variantIndex?: number | null;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  clientMessageId?: string | null;
  reasoning?: string | null;
  reasoningDurationSeconds?: number | null;
  reasoningStatus?: 'idle' | 'streaming' | 'done';
  reasoningIdleMs?: number | null;
  streamStatus?: 'pending' | 'streaming' | 'done' | 'error' | 'cancelled';
  streamCursor?: number;
  streamReasoning?: string | null;
  streamError?: string | null;
  // 可选图片：可能为 data URL（本地预览）或服务端返回的可访问 URL
  images?: string[];
  toolEvents?: ToolEvent[];
  metrics?: MessageStreamMetrics | null;
}

export interface MessageMeta {
  id: number | string;
  sessionId: number;
  stableKey: string;
  parentMessageId?: number | string | null;
  variantIndex?: number | null;
  role: 'user' | 'assistant';
  createdAt: string;
  clientMessageId?: string | null;
  reasoningStatus?: 'idle' | 'streaming' | 'done';
  reasoningDurationSeconds?: number | null;
  reasoningIdleMs?: number | null;
  images?: string[];
  isPlaceholder?: boolean;
  streamStatus?: 'pending' | 'streaming' | 'done' | 'error' | 'cancelled';
  streamError?: string | null;
  pendingSync?: boolean;
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
}

export interface MessageRenderCacheEntry {
  contentHtml: string | null;
  reasoningHtml: string | null;
  contentVersion: number;
  reasoningVersion: number;
  updatedAt: number;
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
}

export interface ChatShare {
  id: number;
  sessionId: number;
  token: string;
  title: string;
  sessionTitle: string;
  messageCount: number;
  messages: ShareMessage[];
  createdAt: string;
  expiresAt?: string | null;
  revokedAt?: string | null;
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

export interface SystemSettings {
  allowRegistration: boolean;
  brandText?: string;
  systemModels: any[]; // 已废弃：保留字段占位，改用聚合模型
  assistantAvatarUpload?: { data: string; mime: string } | null;
  assistantAvatarRemove?: boolean;
  // 流式/稳定性相关（系统级）
  sseHeartbeatIntervalMs?: number;
  providerMaxIdleMs?: number;
  providerTimeoutMs?: number;
  providerInitialGraceMs?: number;
  providerReasoningIdleMs?: number;
  reasoningKeepaliveIntervalMs?: number;
  usageEmit?: boolean;
  usageProviderOnly?: boolean;
  // 推理链相关（可选）
  reasoningEnabled?: boolean;
  reasoningDefaultExpand?: boolean;
  reasoningSaveToDb?: boolean;
  reasoningTagsMode?: 'default' | 'custom' | 'off';
  reasoningCustomTags?: string;
  streamDeltaChunkSize?: number;
  streamDeltaFlushIntervalMs?: number;
  streamReasoningFlushIntervalMs?: number;
  streamKeepaliveIntervalMs?: number;
  // 供应商参数（可选）
  openaiReasoningEffort?: 'low' | 'medium' | 'high' | '' | 'unset';
  reasoningMaxOutputTokensDefault?: number | null;
  ollamaThink?: boolean;
  chatImageRetentionDays?: number;
  assistantReplyHistoryLimit?: number | null;
  siteBaseUrl?: string;
  anonymousRetentionDays?: number;
  anonymousDailyQuota?: number;
  defaultUserDailyQuota?: number;
  modelAccessDefaultAnonymous?: 'allow' | 'deny';
  modelAccessDefaultUser?: 'allow' | 'deny';
  webSearchAgentEnable?: boolean;
  webSearchDefaultEngine?: string;
  webSearchResultLimit?: number;
  webSearchDomainFilter?: string[];
  webSearchHasApiKey?: boolean;
  webSearchHasApiKeyTavily?: boolean;
  webSearchHasApiKeyBrave?: boolean;
  webSearchHasApiKeyMetaso?: boolean;
  webSearchScope?: string;
  webSearchIncludeSummary?: boolean;
  webSearchIncludeRaw?: boolean;
  pythonToolEnable?: boolean;
  pythonToolCommand?: string;
  pythonToolArgs?: string[];
  pythonToolTimeoutMs?: number;
  pythonToolMaxOutputChars?: number;
  pythonToolMaxSourceChars?: number;
  agentMaxToolIterations?: number;
  assistantAvatarUrl?: string | null;
  chatSystemPrompt?: string;
  webSearchApiKey?: string;
  webSearchApiKeyTavily?: string;
  webSearchApiKeyBrave?: string;
  webSearchApiKeyMetaso?: string;
  taskTraceEnabled?: boolean;
  taskTraceDefaultOn?: boolean;
  taskTraceAdminOnly?: boolean;
  taskTraceEnv?: 'dev' | 'prod' | 'both';
  taskTraceRetentionDays?: number;
  taskTraceMaxEvents?: number;
  taskTraceIdleTimeoutMs?: number;
  chatMaxConcurrentStreams?: number;
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

export interface WebSearchHit {
  title: string;
  url: string;
  snippet?: string;
}

export interface ToolEventDetails {
  code?: string;
  input?: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  durationMs?: number;
  truncated?: boolean;
  [key: string]: unknown;
}

export interface ToolEvent {
  id: string;
  sessionId: number;
  messageId: number | string;
  tool: string;
  stage: 'start' | 'result' | 'error';
  status: 'running' | 'success' | 'error';
  query?: string;
  hits?: WebSearchHit[];
  error?: string;
  summary?: string;
  createdAt: number;
  details?: ToolEventDetails;
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
  theme: 'light' | 'dark' | 'system';
  maxTokens: number;
  contextEnabled: boolean;
  systemSettings: SystemSettings | null;
  isLoading: boolean;
  error: string | null;
  publicBrandText: string | null;
  assistantAvatarReady: boolean;
  assistantAvatarReadyFor: string | null;
}

// API 响应类型
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

// 流式响应类型
export interface ChatStreamChunk {
  type?: 'content' | 'usage' | 'start' | 'end' | 'complete' | 'error' | 'reasoning' | 'quota' | 'tool';
  content?: string;
  messageId?: number | null;
  assistantMessageId?: number | null;
  assistantClientMessageId?: string | null;
  usage?: UsageStats;
  done?: boolean;
  duration?: number;
  error?: string;
  keepalive?: boolean;
  idleMs?: number;
  quota?: ActorQuota;
  tool?: string;
  id?: string;
  stage?: 'start' | 'result' | 'error';
  query?: string;
  hits?: WebSearchHit[];
  meta?: Record<string, unknown>;
  details?: ToolEventDetails;
}

// Usage 统计类型（OpenAI 兼容字段为主）
export interface UsageStats {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  context_limit?: number | null;
  context_remaining?: number | null;
}

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
