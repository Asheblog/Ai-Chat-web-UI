import type {
  BattleContent,
  BattleContentInput,
  BattleRunStatus,
} from '@aichat/shared/battle-contract'

export type BattleModelFeatures = {
  web_search?: boolean
  web_search_scope?: 'webpage' | 'document' | 'paper' | 'image' | 'video' | 'podcast'
  web_search_include_summary?: boolean
  web_search_include_raw?: boolean
  web_search_size?: number
  python_tool?: boolean
}

export type BattleModelInput = {
  modelId: string
  connectionId?: number
  rawId?: string
  features?: BattleModelFeatures
  extraPrompt?: string
  custom_body?: Record<string, any>
  custom_headers?: Array<{ name: string; value: string }>
  reasoningEnabled?: boolean
  reasoningEffort?: 'low' | 'medium' | 'high'
  ollamaThink?: boolean
}

export type BattleJudgeInput = {
  modelId: string
  connectionId?: number
  rawId?: string
}

export interface BattleRunCreateInput {
  title?: string
  prompt: BattleContentInput
  expectedAnswer: BattleContentInput
  judge: BattleJudgeInput
  judgeThreshold?: number
  runsPerModel: number
  passK: number
  models: BattleModelInput[]
  maxConcurrency?: number
}

export interface BattleRunSummary {
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

export interface BattleRunConfigModel {
  modelId: string
  connectionId: number | null
  rawId: string | null
  features?: BattleModelFeatures
  extraPrompt?: string | null
  customHeaders?: Array<{ name: string; value: string }>
  customBody?: Record<string, any> | null
  reasoningEnabled?: boolean | null
  reasoningEffort?: 'low' | 'medium' | 'high' | null
  ollamaThink?: boolean | null
}

export interface BattleRunConfig {
  models: BattleRunConfigModel[]
}

export interface BattleResultRecord {
  id: number
  battleRunId: number
  modelId: string
  connectionId: number | null
  rawId: string | null
  attemptIndex: number
  output: string
  reasoning: string
  usageJson: string
  durationMs: number | null
  error: string | null
  judgeStatus: string
  judgeError: string | null
  judgePass: boolean | null
  judgeScore: number | null
  judgeReason: string | null
  judgeFallbackUsed: boolean
}

export interface BattleRunRecord {
  id: number
  title: string
  prompt: string
  expectedAnswer: string
  promptImagesJson: string
  expectedAnswerImagesJson: string
  judgeModelId: string
  judgeConnectionId: number | null
  judgeRawId: string | null
  judgeThreshold: number
  runsPerModel: number
  passK: number
  status: string
  configJson: string
  summaryJson: string
  createdAt: Date
  updatedAt: Date
}

export interface BattleShareDetail {
  id: number
  battleRunId: number
  token: string
  title: string
  payload: BattleSharePayload
  createdAt: string
  expiresAt: string | null
  revokedAt: string | null
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
  summary: BattleRunSummary
  results: Array<{
    modelId: string
    modelLabel: string | null
    connectionId: number | null
    rawId: string | null
    attemptIndex: number
    output: string
    reasoning: string
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
    }>
  }
  createdAt: string
}
