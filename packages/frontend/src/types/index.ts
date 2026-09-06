// 用户相关类型
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

export type {
  ActorQuota,
  ActorQuotaScope,
} from '@aichat/shared/api-contract'

export type { GeneratedImage } from '@aichat/shared/api-contract'

export type { WorkspaceArtifact } from '@aichat/shared/api-contract'

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

export type { WebSearchHit } from '@aichat/shared/api-contract'

export type {
  ToolCallPhase,
  ToolCallSource,
  ToolInterventionState,
} from '@aichat/shared/api-contract'

// API 响应类型（已收敛至 @aichat/shared/api-contract）
export type { ChatStreamChunk } from '@aichat/shared/api-contract'

/** API 错误类型（已收敛至 @aichat/shared/chat-stream-contract） */
export type { ApiErrorType } from '@aichat/shared/api-contract'

// Usage 统计类型（OpenAI 兼容字段为主，已收敛至 shared）
export type { UsageStats } from '@aichat/shared/api-contract'

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

// 本地领域类型
export * from './auth'
export * from './chat'
export * from './mcp'
export * from './secrets'
export * from './settings'
export * from './skills'
export * from './task-trace'
export * from './tool-events'
export * from './usage'
