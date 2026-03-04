import type {
  BattleMode,
  BattleContent,
  BattleContentInput,
  BattleToolCallEvent,
  BattleRunStatus,
} from '@aichat/shared/battle-contract'

export type BattleModelSkills = {
  enabled: string[]
  overrides?: Record<string, Record<string, unknown>>
}

export type BattleModelInput = {
  modelId: string
  connectionId?: number
  rawId?: string
  skills?: BattleModelSkills
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

export interface BattleQuestionInput {
  questionId?: string
  title?: string
  prompt: BattleContentInput
  expectedAnswer: BattleContentInput
  runsPerQuestion: number
  passK: number
}

interface BattleRunCreateInputBase {
  title?: string
  mode: BattleMode
  judge: BattleJudgeInput
  maxConcurrency?: number
  judgeThreshold?: number
}

export interface BattleRunCreateMultiModelInput extends BattleRunCreateInputBase {
  mode: 'multi_model'
  prompt: BattleContentInput
  expectedAnswer: BattleContentInput
  runsPerModel: number
  passK: number
  models: BattleModelInput[]
}

export interface BattleRunCreateSingleModelInput extends BattleRunCreateInputBase {
  mode: 'single_model_multi_question'
  model: BattleModelInput
  questions: BattleQuestionInput[]
}

export type BattleRunCreateInput =
  | BattleRunCreateMultiModelInput
  | BattleRunCreateSingleModelInput

export interface BattleRunSummary {
  totalModels: number
  runsPerModel: number
  passK: number
  judgeThreshold: number
  passModelCount: number
  accuracy: number
  mode?: BattleMode
  totalQuestions?: number
  passedQuestions?: number
  stabilityScore?: number
  questionStats?: Array<{
    questionIndex: number
    questionId?: string | null
    questionTitle?: string | null
    runsPerQuestion: number
    passK: number
    passAtK: boolean
    passCount: number
    accuracy: number
    judgedCount?: number
    totalAttempts?: number
    judgeErrorCount?: number
  }>
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
  skills?: BattleModelSkills
  extraPrompt?: string | null
  customHeaders?: Array<{ name: string; value: string }>
  customBody?: Record<string, any> | null
  reasoningEnabled?: boolean | null
  reasoningEffort?: 'low' | 'medium' | 'high' | null
  ollamaThink?: boolean | null
}

export interface BattleRunQuestionConfig {
  questionIndex: number
  questionId?: string | null
  title?: string | null
  prompt: BattleContent
  expectedAnswer: BattleContent
  runsPerQuestion: number
  passK: number
}

export interface BattleRunConfig {
  mode?: BattleMode
  models?: BattleRunConfigModel[]
  model?: BattleRunConfigModel
  questions?: BattleRunQuestionConfig[]
}

export interface BattleResultRecord {
  id: number
  battleRunId: number
  questionIndex: number
  questionId: string | null
  questionTitle: string | null
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
  mode: string
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
  mode: BattleMode
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
  questions?: Array<{
    questionIndex: number
    questionId?: string | null
    title?: string | null
    prompt: BattleContent
    expectedAnswer: BattleContent
    runsPerQuestion: number
    passK: number
  }>
  summary: BattleRunSummary
  results: Array<{
    questionIndex: number
    questionId?: string | null
    questionTitle?: string | null
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
      questionIndex?: number
      questionId?: string | null
      questionTitle?: string | null
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
