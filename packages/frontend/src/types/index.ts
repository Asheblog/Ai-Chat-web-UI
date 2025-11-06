// 用户相关类型
export interface User {
  id: number;
  username: string;
  role: 'ADMIN' | 'USER';
  createdAt: string;
  status: 'PENDING' | 'ACTIVE' | 'DISABLED';
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
};

export type ActorProfile = AnonymousActorProfile | UserActorProfile;

export interface ActorContextDTO {
  actor: ActorProfile;
  quota: ActorQuota | null;
  user?: User | null;
  preferredModel?: ModelPreferenceDTO | null;
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
  reasoningEnabled?: boolean | null;
  reasoningEffort?: 'low' | 'medium' | 'high' | null;
  ollamaThink?: boolean | null;
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
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  clientMessageId?: string | null;
  reasoning?: string | null;
  reasoningDurationSeconds?: number | null;
  reasoningStatus?: 'idle' | 'streaming' | 'done';
  reasoningIdleMs?: number | null;
  // 可选图片：可能为 data URL（本地预览）或服务端返回的可访问 URL
  images?: string[];
}

export interface MessageMeta {
  id: number | string;
  sessionId: number;
  role: 'user' | 'assistant';
  createdAt: string;
  clientMessageId?: string | null;
  reasoningStatus?: 'idle' | 'streaming' | 'done';
  reasoningDurationSeconds?: number | null;
  reasoningIdleMs?: number | null;
  images?: string[];
  isPlaceholder?: boolean;
}

export interface MessageBody {
  id: number | string;
  content: string;
  reasoning?: string | null;
  version: number;
  reasoningVersion: number;
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

// 系统设置类型
export interface SystemSetting {
  key: string;
  value: string;
}

export interface SystemSettings {
  allowRegistration: boolean;
  brandText?: string;
  systemModels: any[]; // 已废弃：保留字段占位，改用聚合模型
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
  // 供应商参数（可选）
  openaiReasoningEffort?: 'low' | 'medium' | 'high' | '' | 'unset';
  ollamaThink?: boolean;
  chatImageRetentionDays?: number;
  siteBaseUrl?: string;
  anonymousRetentionDays?: number;
  anonymousDailyQuota?: number;
  defaultUserDailyQuota?: number;
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
  error: string | null;
  messageImageCache: Record<string, string[]>;
  messagesHydrated: Record<number, boolean>;
  // usage 展示状态
  usageCurrent?: UsageStats | null;
  usageLastRound?: UsageStats | null;
  usageTotals?: UsageTotals | null;
  sessionUsageTotalsMap: Record<number, UsageTotals>;
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
  type?: 'content' | 'usage' | 'start' | 'end' | 'complete' | 'error' | 'reasoning' | 'quota';
  content?: string;
  usage?: UsageStats;
  done?: boolean;
  duration?: number;
  error?: string;
  keepalive?: boolean;
  idleMs?: number;
  quota?: ActorQuota;
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

// 扩展聊天状态的 usage 字段
// （保留空）

// 组件 Props 类型
export interface MessageProps {
  message: Message;
  isStreaming?: boolean;
  onCopy?: (content: string) => void;
  onRegenerate?: (messageId: number | string) => void;
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
