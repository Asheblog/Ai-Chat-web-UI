import type { ModelItem } from '@/store/models-store'
import type {
  BattleResult,
  BattleRunSummary,
  BattleToolCallEvent,
  SkillRuntimeReference,
  ToolEvent,
} from '@/types'

export type BattleStep = 'config' | 'prompt' | 'execution' | 'result'
export type NodeStatus = 'pending' | 'running' | 'success' | 'error' | 'judging'

export interface ModelConfigState {
  key: string
  model: ModelItem
  webSearchEnabled: boolean
  pythonEnabled: boolean
  reasoningEnabled: boolean
  reasoningEffort: 'low' | 'medium' | 'high' | 'max' | 'xhigh'
  ollamaThink: boolean
  extraPrompt: string
  customBody: string
  customHeaders: Array<{ name: string; value: string }>
  customBodyError?: string | null
  advancedOpen: boolean
}

export interface NodeState {
  modelKey: string
  modelLabel: string
  status: NodeStatus
  attemptIndex: number
  durationMs?: number | null
  output?: string
  reasoning?: string
  error?: string | null
  toolEvents?: ToolEvent[]
  judgeStatus?: BattleResult['judgeStatus']
  judgeError?: string | null
  judgePass?: boolean | null
  judgeScore?: number | null
  judgeReason?: string | null
}

export type LiveAttempt = {
  modelId: string
  modelLabel?: string | null
  connectionId?: number | null
  rawId?: string | null
  attemptIndex: number
  status: NodeStatus
  output?: string | null
  reasoning?: string | null
  durationMs?: number | null
  error?: string | null
  toolEvents?: BattleToolCallEvent[] | ToolEvent[] | null
}

export interface JudgeConfig {
  model: ModelItem | null
  threshold: number
  runsPerModel: number
  passK: number
  maxConcurrency: number
}

export type BattleDraftImage = {
  dataUrl: string
  mime: string
  size: number
}

export interface BattleFlowState {
  step: BattleStep
  selectedModels: ModelConfigState[]
  judgeConfig: JudgeConfig
  prompt: string
  expectedAnswer: string
  promptImages: BattleDraftImage[]
  expectedAnswerImages: BattleDraftImage[]
  promptImageUrls: string[]
  expectedAnswerImageUrls: string[]
  nodeStates: Map<string, NodeState[]>
  results: BattleResult[]
  summary: BattleRunSummary['summary'] | null
  currentRunId: number | null
  isRunning: boolean
  isStreaming: boolean
  runStatus: BattleRunSummary['status'] | null
  error: string | null
}

export type BattleNodeModel = {
  modelId: string
  connectionId?: number | null
  rawId?: string | null
  label?: string | null
}

export type ReasoningDefaults = {
  reasoningEnabled: boolean
  reasoningEffort: 'low' | 'medium' | 'high' | 'max' | 'xhigh'
  ollamaThink: boolean
}

export type BattleRunConfigModel = {
  modelId: string
  connectionId?: number | null
  rawId?: string | null
  skills?: {
    builtin?: string[]
    enabled?: SkillRuntimeReference[]
    overrides?: Record<string, Record<string, unknown>>
  }
  extraPrompt?: string | null
  customHeaders?: Array<{ name: string; value: string }>
  customBody?: Record<string, any> | null
  reasoningEnabled?: boolean | null
  reasoningEffort?: 'low' | 'medium' | 'high' | 'max' | 'xhigh' | null
  ollamaThink?: boolean | null
}

export interface BattleRunDetailInput {
  prompt: import('@/types').BattleContent
  expectedAnswer: import('@/types').BattleContent
  judgeModelId: string
  judgeConnectionId?: number | null
  judgeRawId?: string | null
  judgeThreshold: number
  runsPerModel: number
  passK: number
  summary: BattleRunSummary['summary'] | null
  results: BattleResult[]
  id: number
  status: BattleRunSummary['status']
  config?: {
    models?: Array<{
      modelId: string
      connectionId: number | null
      rawId: string | null
      skills?: {
        builtin?: string[]
        enabled?: SkillRuntimeReference[]
        overrides?: Record<string, Record<string, unknown>>
      }
      customHeaders?: Array<{ name: string; value: string }>
      customBody?: Record<string, any> | null
      extraPrompt?: string | null
      reasoningEnabled?: boolean | null
      reasoningEffort?: 'low' | 'medium' | 'high' | 'max' | 'xhigh' | null
      ollamaThink?: boolean | null
    }>
  }
  live?: {
    attempts: LiveAttempt[]
  }
}
