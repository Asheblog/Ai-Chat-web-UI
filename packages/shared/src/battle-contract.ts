export type BattleRunStatus = 'pending' | 'running' | 'completed' | 'error' | 'cancelled'

export interface BattleContent {
  text: string
  images: string[]
}

export interface BattleUploadImage {
  data: string
  mime: string
}

export interface BattleContentInput {
  text?: string
  images?: BattleUploadImage[]
}

export interface RejudgeExpectedAnswerInput {
  text?: string
  keepImages?: string[]
  newImages?: BattleUploadImage[]
}

export interface BattleSummaryStats {
  totalModels: number
  runsPerModel: number
  passK: number
  judgeThreshold: number
  passModelCount: number
  accuracy: number
  modelStats: Array<{
    modelId: string
    connectionId: number | null
    rawId: string | null
    passAtK: boolean
    passCount: number
    accuracy: number
    judgedCount?: number
    totalAttempts?: number
    judgeErrorCount?: number
  }>
}

export interface BattleRunSummary {
  id: number
  title: string
  prompt: BattleContent
  expectedAnswer: BattleContent
  judgeModelId: string
  judgeConnectionId?: number | null
  judgeRawId?: string | null
  judgeThreshold: number
  runsPerModel: number
  passK: number
  status: BattleRunStatus
  createdAt: string
  updatedAt: string
  summary: BattleSummaryStats
}

export interface BattleResult {
  id: number
  battleRunId: number
  modelId: string
  modelLabel?: string | null
  connectionId?: number | null
  rawId?: string | null
  attemptIndex: number
  output: string
  reasoning?: string | null
  usage: Record<string, any>
  durationMs?: number | null
  error?: string | null
  judgeStatus?: 'unknown' | 'running' | 'success' | 'error' | 'skipped'
  judgeError?: string | null
  judgePass?: boolean | null
  judgeScore?: number | null
  judgeReason?: string | null
  judgeFallbackUsed?: boolean
}

export interface BattleWebSearchHit {
  title: string
  url: string
  snippet?: string
}

export type BattleToolCallPhase =
  | 'arguments_streaming'
  | 'pending_approval'
  | 'executing'
  | 'result'
  | 'error'
  | 'rejected'
  | 'aborted'

export type BattleToolCallSource = 'builtin' | 'plugin' | 'mcp' | 'workspace' | 'system'

export type BattleToolCallStatus =
  | 'running'
  | 'success'
  | 'error'
  | 'pending'
  | 'rejected'
  | 'aborted'

export interface BattleToolInterventionState {
  status?: 'pending' | 'approved' | 'rejected' | 'aborted' | 'none'
  rejectedReason?: string
  approvalMode?: 'auto-run' | 'allow-list' | 'manual'
}

export interface BattleToolCallDetails {
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
  requestedLimit?: number | null
  appliedLimit?: number | null
  warning?: string
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
  [key: string]: unknown
}

export interface BattleToolCallEvent {
  id: string
  callId?: string
  source?: BattleToolCallSource
  identifier?: string
  apiName?: string
  tool?: string
  phase?: BattleToolCallPhase
  stage?: 'start' | 'result' | 'error'
  status: BattleToolCallStatus
  query?: string
  hits?: BattleWebSearchHit[]
  argumentsText?: string
  argumentsPatch?: string
  resultText?: string
  resultJson?: unknown
  error?: string
  summary?: string
  details?: BattleToolCallDetails
  intervention?: BattleToolInterventionState
  thoughtSignature?: string | null
  createdAt: number
  updatedAt?: number
}

export interface BattleModelSkills {
  enabled: string[]
  overrides?: Record<string, Record<string, unknown>>
}

export interface BattleRunDetail extends BattleRunSummary {
  judgeModelLabel?: string | null
  config?: {
    models: Array<{
      modelId: string
      connectionId: number | null
      rawId: string | null
      skills?: BattleModelSkills
      extraPrompt?: string | null
      customHeaders?: Array<{ name: string; value: string }>
      customBody?: Record<string, any> | null
      reasoningEnabled?: boolean | null
      reasoningEffort?: 'low' | 'medium' | 'high' | null
      ollamaThink?: boolean | null
    }>
  }
  live?: {
    attempts: Array<{
      modelId: string
      modelLabel?: string | null
      connectionId: number | null
      rawId: string | null
      attemptIndex: number
      status: 'pending' | 'running' | 'success' | 'error' | 'judging'
      output?: string | null
      reasoning?: string | null
      durationMs?: number | null
      error?: string | null
      toolEvents?: BattleToolCallEvent[]
    }>
  }
  results: BattleResult[]
}

export interface BattleRunListResponse {
  runs: BattleRunSummary[]
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
}

export interface BattleSharePayload {
  title: string
  prompt: BattleContent
  expectedAnswer: BattleContent
  judge: {
    modelId: string
    modelLabel: string | null
    threshold: number
  }
  status: BattleRunStatus
  progress: {
    totalAttempts: number
    completedAttempts: number
    runningAttempts: number
    pendingAttempts: number
    successAttempts: number
    failedAttempts: number
  }
  models: Array<{
    modelId: string
    modelLabel: string | null
    connectionId: number | null
    rawId: string | null
  }>
  summary: BattleRunSummary['summary']
  results: Array<{
    modelId: string
    modelLabel: string | null
    connectionId: number | null
    rawId: string | null
    attemptIndex: number
    output: string
    reasoning?: string
    durationMs: number | null
    error: string | null
    usage: Record<string, any>
    judgeStatus?: 'unknown' | 'running' | 'success' | 'error' | 'skipped'
    judgeError?: string | null
    judgePass: boolean | null
    judgeScore: number | null
    judgeReason: string | null
    judgeFallbackUsed: boolean
  }>
  live?: {
    attempts: Array<{
      modelId: string
      modelLabel: string | null
      connectionId: number | null
      rawId: string | null
      attemptIndex: number
      status: 'pending' | 'running' | 'success' | 'error' | 'judging'
      output?: string | null
      reasoning?: string | null
      durationMs?: number | null
      error?: string | null
      toolEvents?: BattleToolCallEvent[]
    }>
  }
  createdAt: string
}

export interface BattleShare {
  id: number
  battleRunId: number
  token: string
  title: string
  payload: BattleSharePayload
  createdAt: string
  expiresAt: string | null
  revokedAt: string | null
}

export interface BattleStreamEvent {
  type:
    | 'run_start'
    | 'attempt_start'
    | 'attempt_delta'
    | 'attempt_tool_call'
    | 'attempt_complete'
    | 'run_complete'
    | 'run_cancelled'
    | 'skill_approval_request'
    | 'skill_approval_result'
    | 'error'
    | 'complete'
  payload?: Record<string, any>
  error?: string
}

export interface RejudgeStreamEvent {
  type: 'rejudge_start' | 'rejudge_progress' | 'rejudge_complete' | 'error'
  payload?: {
    completed?: number
    total?: number
    resultId?: number
    expectedAnswer?: BattleContent
  }
  error?: string
}
