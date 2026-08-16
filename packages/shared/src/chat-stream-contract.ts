/**
 * 聊天流式协议归一化产物 —— web / mobile / 后端事件源 三端共用。
 *
 * 服务端发射 execution SSE（见 execution-contract.ts）与 legacy 事件，
 * 各客户端统一归一化为本模块的 ChatStreamChunk，避免三端各自维护一套
 * phase/status 推断与 payload 解析（见历史实现 stream-reader.ts / chat-stream-parser.ts）。
 * 本模块必须保持 React Native 安全：不依赖 DOM / Node / Buffer API。
 */

// 复用既有共享类型，避免跨模块重名冲突
import type { GeneratedImage } from './image-generation.js'
export type { GeneratedImage } from './image-generation.js'

export type ToolCallPhase =
  | 'arguments_streaming'
  | 'pending_approval'
  | 'executing'
  | 'result'
  | 'error'
  | 'rejected'
  | 'aborted'

export type ToolCallSource = 'builtin' | 'plugin' | 'mcp' | 'workspace' | 'system'

export type ToolCallStatus = 'running' | 'success' | 'error' | 'pending' | 'rejected' | 'aborted'

export type ToolEventStage = 'start' | 'result' | 'error'

export interface ToolInterventionState {
  status?: 'pending' | 'approved' | 'rejected' | 'aborted' | 'none'
  rejectedReason?: string
  approvalMode?: 'auto-run' | 'allow-list' | 'manual'
}

/** Usage 统计类型（OpenAI 兼容字段为主） */
export interface UsageStats {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
  context_limit?: number | null
  context_remaining?: number | null
}

/** API 错误类型 */
export type ApiErrorType =
  | 'content_moderation' // 内容审查/安全过滤
  | 'context_length' // 上下文长度超限
  | 'rate_limit' // 请求频率限制
  | 'quota_exceeded' // 配额耗尽
  | 'authentication' // 认证失败
  | 'invalid_request' // 无效请求
  | 'server_error' // 服务器错误
  | 'network' // 网络错误
  | 'unknown' // 未知错误

export type ActorQuotaScope = 'USER' | 'ANON'

export interface ActorQuota {
  scope: ActorQuotaScope
  identifier: string
  dailyLimit: number
  usedCount: number
  remaining: number | null
  lastResetAt: string
  unlimited: boolean
  customDailyLimit: number | null
  usingDefaultLimit: boolean
}

export interface WebSearchHit {
  title: string
  url: string
  snippet?: string
  imageUrl?: string
  thumbnailUrl?: string
}

export interface WorkspaceArtifact {
  id: number
  fileName: string
  mimeType: string
  sizeBytes: number
  expiresAt: string | Date
  downloadUrl: string
  messageId?: number | null
  expired?: boolean
}

export interface ResearchPlanSubQuestion {
  question: string
  keywords: string[]
}

export interface ResearchPlanPayload {
  title: string
  objective: string
  sub_questions: ResearchPlanSubQuestion[]
  estimated_tool_rounds: {
    min: number
    max: number
  }
  deliverable?: string
  notes?: string
}

export interface ResearchPlanApprovalState {
  kind: 'plan' | 'search_unavailable'
  decision?: 'approve' | 'adjust' | 'cancel' | 'continue' | 'expired'
  feedback?: string
  revision?: number
  expiresAt?: string | number
}

export interface ToolEventDetails {
  // 通用工具调用字段（ToolCall V2）
  argumentsText?: string
  argumentsPatch?: string
  resultText?: string
  resultJson?: unknown
  url?: string
  title?: string
  excerpt?: string
  wordCount?: number
  siteName?: string
  byline?: string
  leadImageUrl?: string
  images?: Array<{
    url: string
    alt?: string
    source?: string
    width?: number
    height?: number
  }>
  requestedLimit?: number | null
  appliedLimit?: number | null
  warning?: string
  groupId?: string
  taskType?: 'search' | 'read_url' | string
  engine?: string
  queryLanguage?: 'zh' | 'en' | 'unknown' | string
  originalQuery?: string
  expandedQuery?: string
  queryIndex?: number
  engineCount?: number
  queryCount?: number
  hitsCount?: number
  searchTaskTotal?: number
  searchTaskSucceeded?: number
  searchTaskFailed?: number
  autoReadEnabled?: boolean
  autoReadRequested?: number
  autoReadSucceeded?: number
  autoReadFailed?: number
  errorCode?: string
  httpStatus?: number
  fallbackUsed?: string
  autoTriggered?: boolean
  parentTool?: string
  parentCallId?: string
  rank?: number
  code?: string
  input?: string
  stdout?: string
  stderr?: string
  exitCode?: number
  durationMs?: number
  truncated?: boolean
  reasoningOffset?: number
  reasoningOffsetStart?: number
  reasoningOffsetEnd?: number
  plan?: ResearchPlanPayload
  approval?: ResearchPlanApprovalState
  [key: string]: unknown
}

export type ChatStreamChunkType =
  | 'content'
  | 'usage'
  | 'start'
  | 'end'
  | 'complete'
  | 'error'
  | 'reasoning'
  | 'reasoning_unavailable'
  | 'quota'
  | 'tool_call'
  | 'image'
  | 'artifact'
  | 'compression_applied'
  | 'skill_approval_request'
  | 'skill_approval_result'

/** 服务端流事件归一化后的统一产物（web 全量字段，mobile 子集兼容） */
export interface ChatStreamChunk {
  type?: ChatStreamChunkType
  content?: string
  /** complete 事件的最终消息状态；plan cancel/expiry 时下发 cancelled */
  streamStatus?: 'done' | 'cancelled' | 'error'
  /** research_plan 审批负载（tool_call 事件 details 内使用） */
  plan?: ResearchPlanPayload
  approval?: ResearchPlanApprovalState
  messageId?: number | null
  assistantMessageId?: number | null
  assistantClientMessageId?: string | null
  usage?: UsageStats
  done?: boolean
  duration?: number
  error?: string
  /** 错误类型（用于区分不同类型的错误） */
  errorType?: ApiErrorType
  /** 错误处理建议 */
  suggestion?: string
  keepalive?: boolean
  idleMs?: number
  quota?: ActorQuota
  callId?: string
  source?: ToolCallSource
  identifier?: string
  apiName?: string
  tool?: string
  phase?: ToolCallPhase
  id?: string
  stage?: ToolEventStage
  status?: ToolCallStatus
  query?: string
  hits?: WebSearchHit[]
  argumentsText?: string
  argumentsPatch?: string
  resultText?: string
  resultJson?: unknown
  /** 工具执行摘要 */
  summary?: string
  meta?: Record<string, unknown>
  details?: ToolEventDetails
  intervention?: ToolInterventionState
  thoughtSignature?: string | null
  /** 后端计算的性能指标（仅在 complete 事件中） */
  metrics?: {
    firstTokenLatencyMs?: number | null
    responseTimeMs?: number | null
    tokensPerSecond?: number | null
  }
  /** 生成的图片（type='image' 时） */
  generatedImages?: GeneratedImage[]
  artifacts?: WorkspaceArtifact[]
  requestId?: number
  skillId?: number
  skillSlug?: string
  skillVersionId?: number
  toolCallId?: string
  reason?: string
  decision?: 'approved' | 'denied' | 'expired'
  expiresAt?: string | Date
  unavailableCode?: string
  unavailableReason?: string
  unavailableSuggestion?: string
  reasoningProtocol?: 'chat_completions' | 'responses'
  reasoningDecision?: string
  compression?: {
    groupId: number
    compressedCount: number
    thresholdTokens: number
    beforeTokens: number
    afterTokens: number
    tailMessages: number
  }
}
