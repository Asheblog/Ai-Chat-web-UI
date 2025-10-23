// 用户相关类型
export interface User {
  id: number;
  username: string;
  role: 'ADMIN' | 'USER';
  createdAt: string;
}

export interface AuthResponse {
  user: User;
  token: string;
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
  id: number;
  sessionId: number;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  // 可选的图片（data URL，用于展示，不入库）
  images?: string[];
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
}

// UI 状态类型
export interface ChatState {
  currentSession: ChatSession | null;
  sessions: ChatSession[];
  messages: Message[];
  isLoading: boolean;
  isStreaming: boolean;
  error: string | null;
  // usage 展示状态
  usageCurrent?: UsageStats | null;
  usageLastRound?: UsageStats | null;
  usageTotals?: UsageTotals | null;
}

export interface AuthState {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  error: string | null;
}

export interface SettingsState {
  theme: 'light' | 'dark' | 'system';
  maxTokens: number;
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
  type?: 'content' | 'usage' | 'start' | 'end' | 'complete' | 'error' | 'reasoning';
  content?: string;
  usage?: UsageStats;
  done?: boolean;
  duration?: number;
  error?: string;
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
  onRegenerate?: (messageId: number) => void;
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
