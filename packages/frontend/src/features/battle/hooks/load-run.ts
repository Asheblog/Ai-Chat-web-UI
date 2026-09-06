import type { ModelItem } from '@/store/models-store'
import type { BattleResult, BattleRunSummary } from '@/types'
import { buildModelKey } from '../utils/model-key'
import {
  buildConfigStateFromConfig,
  buildPlaceholderModel,
  resolveModelFromCatalog,
} from './model-config'
import { buildNodeStatesFromRun } from './node-states'
import type {
  BattleNodeModel,
  BattleRunConfigModel,
  BattleRunDetailInput,
  BattleStep,
  JudgeConfig,
  ModelConfigState,
  NodeState,
  ReasoningDefaults,
} from './types'

export interface LoadedBattleState {
  prompt: string
  expectedAnswer: string
  promptImageUrls: string[]
  expectedAnswerImageUrls: string[]
  judgeConfig: Partial<JudgeConfig>
  selectedModels?: ModelConfigState[]
  summary: BattleRunSummary['summary'] | null
  results: BattleResult[]
  currentRunId: number
  runStatus: BattleRunSummary['status']
  isRunning: boolean
  nodeStates: Map<string, NodeState[]>
  step: BattleStep
}

export const resolveLoadedBattleState = (
  detail: BattleRunDetailInput,
  catalog: ModelItem[] | undefined,
  reasoningDefaults: ReasoningDefaults,
): LoadedBattleState => {
  const configModels: BattleRunConfigModel[] = Array.isArray(detail.config?.models)
    ? detail.config!.models.map((item) => ({
      modelId: item.modelId,
      connectionId: item.connectionId ?? null,
      rawId: item.rawId ?? null,
      skills: item.skills,
      extraPrompt: item.extraPrompt ?? null,
      customHeaders: item.customHeaders,
      customBody: item.customBody ?? null,
      reasoningEnabled: item.reasoningEnabled ?? null,
      reasoningEffort: item.reasoningEffort ?? null,
      ollamaThink: item.ollamaThink ?? null,
    }))
    : []
  const configMap = new Map<string, BattleRunConfigModel>()
  for (const item of configModels) {
    const key = buildModelKey({
      modelId: item.modelId,
      connectionId: item.connectionId ?? null,
      rawId: item.rawId ?? null,
    })
    configMap.set(key, item)
  }
  const fallbackMap = new Map<string, BattleNodeModel>()
  for (const item of detail.results) {
    const key = `${item.modelId}:${item.connectionId ?? 'null'}:${item.rawId ?? 'null'}`
    if (fallbackMap.has(key)) continue
    fallbackMap.set(key, {
      modelId: item.modelId,
      connectionId: item.connectionId ?? null,
      rawId: item.rawId ?? null,
      label: item.modelLabel || null,
    })
  }
  const fallbackModels = Array.from(fallbackMap.values())

  const judgeRef = {
    modelId: detail.judgeModelId,
    connectionId: detail.judgeConnectionId ?? null,
    rawId: detail.judgeRawId ?? null,
  }
  const resolvedJudge = resolveModelFromCatalog(catalog, judgeRef) || buildPlaceholderModel(judgeRef)

  const selectionSources = configModels.length > 0 ? configModels : fallbackModels
  let selectedModels: ModelConfigState[] | undefined
  if (selectionSources.length > 0) {
    const deduped = new Map<string, ModelConfigState>()
    for (const item of selectionSources) {
      const model = resolveModelFromCatalog(catalog, item) || buildPlaceholderModel(item)
      const key = buildModelKey({
        modelId: item.modelId,
        connectionId: item.connectionId ?? null,
        rawId: item.rawId ?? null,
      })
      const config = configMap.get(key)
      const state = buildConfigStateFromConfig(model, reasoningDefaults, config)
      if (!deduped.has(state.key)) {
        deduped.set(state.key, state)
      }
    }
    selectedModels = Array.from(deduped.values())
  }

  const nodeModels = configModels.length > 0
    ? configModels.map((item) => ({
      modelId: item.modelId,
      connectionId: item.connectionId ?? null,
      rawId: item.rawId ?? null,
    }))
    : fallbackModels

  return {
    prompt: detail.prompt.text || '',
    expectedAnswer: detail.expectedAnswer.text || '',
    promptImageUrls: Array.isArray(detail.prompt.images) ? detail.prompt.images : [],
    expectedAnswerImageUrls: Array.isArray(detail.expectedAnswer.images) ? detail.expectedAnswer.images : [],
    judgeConfig: {
      model: resolvedJudge,
      threshold: detail.judgeThreshold,
      runsPerModel: detail.runsPerModel,
      passK: detail.passK,
    },
    ...(selectedModels ? { selectedModels } : {}),
    summary: detail.summary,
    results: detail.results,
    currentRunId: detail.id,
    runStatus: detail.status,
    isRunning: detail.status === 'running' || detail.status === 'pending',
    nodeStates: buildNodeStatesFromRun(
      nodeModels,
      detail.runsPerModel,
      detail.results,
      catalog,
      detail.live?.attempts,
    ),
    step: detail.status === 'running' || detail.status === 'pending' ? 'execution' : 'result',
  }
}
