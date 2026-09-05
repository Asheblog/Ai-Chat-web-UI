/**
 * 跨端 API 契约 —— backend / frontend / mobile 共用。
 *
 * 只放「线上传输」的 DTO 与通用信封；UI 状态、组件 Props 留在各端。
 * 同时 re-export 流式协议中已被三端共用的基础类型，作为统一入口。
 */

export interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
  message?: string
}

export interface Pagination {
  page: number
  limit: number
  total: number
  totalPages: number
}

export interface ModelPreference {
  modelId: string | null
  connectionId: number | null
  rawId: string | null
}

export type ModelPreferenceDTO = ModelPreference

export interface AuthUser {
  id: number
  username: string
  role: 'ADMIN' | 'USER'
  status: 'PENDING' | 'ACTIVE' | 'DISABLED'
  createdAt?: string | Date
  avatarUrl?: string | null
  personalPrompt?: string | null
  preferredModel?: ModelPreference | null
}

export interface AuthResponse {
  user: AuthUser
  token: string
}

export interface RegisterResponse {
  user: AuthUser
  token?: string
}

// 流式协议基础类型统一入口（实现仍以 chat-stream-contract / tool-events 为准）
export type {
  ActorQuota,
  ActorQuotaScope,
  ApiErrorType,
  ChatStreamChunk,
  ChatStreamChunkType,
  GeneratedImage,
  ResearchPlanApprovalState,
  ResearchPlanPayload,
  ResearchPlanSubQuestion,
  ToolCallPhase,
  ToolCallSource,
  ToolCallStatus,
  ToolEventDetails,
  ToolEventStage,
  ToolInterventionState,
  UsageStats,
  WebSearchHit,
  WorkspaceArtifact,
} from './chat-stream-contract.js'

export type { ToolEvent } from './tool-events.js'
