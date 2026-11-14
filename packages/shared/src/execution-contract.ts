export type ExecutionSourceType = 'chat' | 'battle'

export type ExecutionStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'error'
  | 'cancelled'
  | 'retrying'

export type ExecutionEventType =
  | 'run_start'
  | 'plan_ready'
  | 'step_start'
  | 'step_delta'
  | 'step_artifact'
  | 'step_complete'
  | 'run_metrics'
  | 'run_complete'
  | 'run_error'
  | 'complete'

export interface ExecutionPlanStep {
  stepId: string
  title: string
  agentRole?: string | null
  dependencies?: string[]
  maxRetries?: number
}

export interface ExecutionRunStartPayload {
  sourceType: ExecutionSourceType
  sourceId?: string | null
  mode?: string | null
  title?: string | null
  input?: Record<string, unknown> | null
}

export interface ExecutionPlanReadyPayload {
  steps: ExecutionPlanStep[]
}

export interface ExecutionStepStartPayload {
  title?: string
  metadata?: Record<string, unknown>
}

export interface ExecutionStepDeltaPayload {
  channel: 'content' | 'reasoning' | 'json'
  delta?: string
  patch?: Record<string, unknown>
}

export interface ExecutionStepArtifactPayload {
  kind:
    | 'tool_call'
    | 'url'
    | 'text'
    | 'code'
    | 'image'
    | 'workspace_artifact'
    | 'result'
  name?: string
  data?: Record<string, unknown>
}

/** 运行被提前收尾的原因：停止后续工具 / 工具轮次预算耗尽 */
export type ExecutionRunStopReason = 'stop_tools' | 'budget_exhausted'

/** step_complete.result 的已知字段；保留索引签名以兼容既有自由字段用法。 */
export interface ExecutionStepCompleteResult {
  stopReason?: ExecutionRunStopReason
  finalAnswerGenerated?: boolean
  [key: string]: unknown
}

export interface ExecutionStepCompletePayload {
  result?: ExecutionStepCompleteResult
  error?: string | null
  durationMs?: number | null
}

export interface ExecutionRunMetricsPayload {
  usage?: Record<string, unknown>
  latencyMs?: number | null
  responseTimeMs?: number | null
  tokensPerSecond?: number | null
  retries?: number
  failedSteps?: number
  completedSteps?: number
}

/** run_complete.summary 的已知字段；保留索引签名以兼容既有自由字段用法。 */
export interface ExecutionRunCompleteSummary {
  streamStatus?: 'done' | 'cancelled' | 'error'
  stopReason?: ExecutionRunStopReason
  finalAnswerGenerated?: boolean
  [key: string]: unknown
}

export interface ExecutionRunCompletePayload {
  summary?: ExecutionRunCompleteSummary
  output?: Record<string, unknown>
}

export interface ExecutionRunErrorPayload {
  message: string
  code?: string
  details?: Record<string, unknown>
}

export type ExecutionEventPayload =
  | ExecutionRunStartPayload
  | ExecutionPlanReadyPayload
  | ExecutionStepStartPayload
  | ExecutionStepDeltaPayload
  | ExecutionStepArtifactPayload
  | ExecutionStepCompletePayload
  | ExecutionRunMetricsPayload
  | ExecutionRunCompletePayload
  | ExecutionRunErrorPayload
  | Record<string, unknown>

export interface ExecutionSseEvent<TPayload extends ExecutionEventPayload = ExecutionEventPayload> {
  type: ExecutionEventType
  runId: string
  eventId: string
  ts: number
  status: ExecutionStatus
  stepId?: string
  agentRole?: string
  payload: TPayload
}

export interface ExecutionRetryPolicy {
  runMaxRetries: number
  stepMaxRetries: number
  backoffMs: number
  backoffMultiplier: number
}
