'use client'

import { useRef, useState } from 'react'
import type { BattleResult, BattleRunSummary } from '@/types'
import type {
  BattleDraftImage,
  BattleStep,
  JudgeConfig,
  ModelConfigState,
  NodeState,
} from './types'

export const useBattleFlowState = () => {
  const [step, setStep] = useState<BattleStep>('config')
  const [selectedModels, setSelectedModels] = useState<ModelConfigState[]>([])
  const [judgeConfig, setJudgeConfig] = useState<JudgeConfig>({
    model: null,
    threshold: 0.8,
    runsPerModel: 1,
    passK: 1,
    maxConcurrency: 3,
  })
  const [prompt, setPrompt] = useState('')
  const [expectedAnswer, setExpectedAnswer] = useState('')
  const [promptImages, setPromptImages] = useState<BattleDraftImage[]>([])
  const [expectedAnswerImages, setExpectedAnswerImages] = useState<BattleDraftImage[]>([])
  const [promptImageUrls, setPromptImageUrls] = useState<string[]>([])
  const [expectedAnswerImageUrls, setExpectedAnswerImageUrls] = useState<string[]>([])
  const [nodeStates, setNodeStates] = useState<Map<string, NodeState[]>>(new Map())
  const [results, setResults] = useState<BattleResult[]>([])
  const [summary, setSummary] = useState<BattleRunSummary['summary'] | null>(null)
  const [currentRunId, setCurrentRunId] = useState<number | null>(null)
  const [isRunning, setIsRunning] = useState(false)
  const [isStreaming, setIsStreaming] = useState(false)
  const [runStatus, setRunStatus] = useState<BattleRunSummary['status'] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const abortControllerRef = useRef<AbortController | null>(null)
  const cancelRequestedRef = useRef(false)

  return {
    step,
    setStep,
    selectedModels,
    setSelectedModels,
    judgeConfig,
    setJudgeConfig,
    prompt,
    setPrompt,
    expectedAnswer,
    setExpectedAnswer,
    promptImages,
    setPromptImages,
    expectedAnswerImages,
    setExpectedAnswerImages,
    promptImageUrls,
    setPromptImageUrls,
    expectedAnswerImageUrls,
    setExpectedAnswerImageUrls,
    nodeStates,
    setNodeStates,
    results,
    setResults,
    summary,
    setSummary,
    currentRunId,
    setCurrentRunId,
    isRunning,
    setIsRunning,
    isStreaming,
    setIsStreaming,
    runStatus,
    setRunStatus,
    error,
    setError,
    abortControllerRef,
    cancelRequestedRef,
  }
}

export type BattleFlowStateApi = ReturnType<typeof useBattleFlowState>
