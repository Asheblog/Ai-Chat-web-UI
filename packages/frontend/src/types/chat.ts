import type { UsageStats } from '@aichat/shared/api-contract'
import type { ToolEvent } from './tool-events'
import type { MessageStreamMetrics, UsageTotals } from './usage'

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

export interface CompressedGroupMessage {
  id: number;
  role: string;
  content: string;
  createdAt: string;
}

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
  generatedImages?: import('@aichat/shared/api-contract').GeneratedImage[];
  richPayload?: import('@aichat/shared/rich-payload').RichMessagePayload | null;
  artifacts?: import('@aichat/shared/api-contract').WorkspaceArtifact[];
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
  generatedImages?: import('@aichat/shared/api-contract').GeneratedImage[];
  richPayload?: import('@aichat/shared/rich-payload').RichMessagePayload | null;
  artifacts?: import('@aichat/shared/api-contract').WorkspaceArtifact[];
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
  generatedImages?: import('@aichat/shared/api-contract').GeneratedImage[];
  richPayload?: import('@aichat/shared/rich-payload').RichMessagePayload | null;
  artifacts?: import('@aichat/shared/api-contract').WorkspaceArtifact[];
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
  richPayload?: import('@aichat/shared/rich-payload').RichMessagePayload | null;
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
