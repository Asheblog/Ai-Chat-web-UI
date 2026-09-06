import type { Dispatch, SetStateAction } from 'react'
import type { ModelItem } from '@/store/models-store'
import type {
  BattleResult,
  BattleRunSummary,
  ToolEvent,
} from '@/types'
import {
  cancelBattleRun,
  streamBattle,
  type MultiModelBattleStreamPayload,
} from '../api'
import { buildModelKey } from '../utils/model-key'
import { normalizeBattleContent } from './model-config'
import { parseExecutionStepIdentity } from './node-states'
import { normalizeBattleToolEvent } from './tool-events'
import type { BattleStep, NodeState } from './types'

export interface BattleStreamRunnerDeps {
  models: ModelItem[]
  cancelRequestedRef: { current: boolean }
  setPrompt: (value: string) => void
  setExpectedAnswer: (value: string) => void
  setPromptImageUrls: (value: string[]) => void
  setExpectedAnswerImageUrls: (value: string[]) => void
  setCurrentRunId: (value: number) => void
  setResults: (updater: (prev: BattleResult[]) => BattleResult[]) => void
  setSummary: (value: BattleRunSummary['summary']) => void
  setRunStatus: Dispatch<SetStateAction<BattleRunSummary['status'] | null>>
  setError: (value: string | null) => void
  setIsRunning: (value: boolean) => void
  setStep: (value: BattleStep) => void
  updateNodeState: (modelKey: string, attemptIndex: number, updates: Partial<NodeState>) => void
  appendNodeOutput: (modelKey: string, attemptIndex: number, delta?: string, reasoning?: string) => void
  appendNodeToolEvent: (modelKey: string, attemptIndex: number, event: ToolEvent) => void
}

export const runBattleStream = async (
  payload: MultiModelBattleStreamPayload,
  signal: AbortSignal,
  deps: BattleStreamRunnerDeps,
): Promise<{ success: boolean; error?: string }> => {
  const {
    models,
    cancelRequestedRef,
    setPrompt,
    setExpectedAnswer,
    setPromptImageUrls,
    setExpectedAnswerImageUrls,
    setCurrentRunId,
    setResults,
    setSummary,
    setRunStatus,
    setError,
    setIsRunning,
    setStep,
    updateNodeState,
    appendNodeOutput,
    appendNodeToolEvent,
  } = deps

  try {
    for await (const event of streamBattle(payload, { signal })) {
      if (event.type === 'run_start') {
        const eventPayload = (event.payload || {}) as Record<string, unknown>
        const sourceId = Number.parseInt(String(eventPayload.sourceId || ''), 10)
        const input = (eventPayload.input || {}) as Record<string, unknown>
        const nextPrompt = normalizeBattleContent(input.prompt)
        const nextExpectedAnswer = normalizeBattleContent(input.expectedAnswer)
        if (nextPrompt.text || nextPrompt.images.length > 0) {
          setPrompt(nextPrompt.text)
          setPromptImageUrls(nextPrompt.images)
        }
        if (nextExpectedAnswer.text || nextExpectedAnswer.images.length > 0) {
          setExpectedAnswer(nextExpectedAnswer.text)
          setExpectedAnswerImageUrls(nextExpectedAnswer.images)
        }
        if (Number.isFinite(sourceId)) {
          setCurrentRunId(sourceId)
          if (cancelRequestedRef.current) {
            void cancelBattleRun(sourceId)
          }
        }
      }

      if (event.type === 'step_start') {
        const identity = parseExecutionStepIdentity(event.stepId)
        if (identity) {
          updateNodeState(identity.modelKey, identity.attemptIndex, { status: 'running' })
        }
      }

      if (event.type === 'step_delta') {
        const identity = parseExecutionStepIdentity(event.stepId)
        const eventPayload = (event.payload || {}) as Record<string, unknown>
        const channel = typeof eventPayload.channel === 'string' ? eventPayload.channel : ''
        const delta = typeof eventPayload.delta === 'string' ? eventPayload.delta : ''
        if (!identity || !delta) continue
        if (channel === 'reasoning') {
          appendNodeOutput(identity.modelKey, identity.attemptIndex, '', delta)
        } else {
          appendNodeOutput(identity.modelKey, identity.attemptIndex, delta, '')
        }
      }

      if (event.type === 'step_artifact') {
        const identity = parseExecutionStepIdentity(event.stepId)
        const eventPayload = (event.payload || {}) as Record<string, unknown>
        if (
          (eventPayload.name === 'skill_approval_request' || eventPayload.name === 'skill_approval_result') &&
          typeof window !== 'undefined'
        ) {
          try {
            window.dispatchEvent(
              new CustomEvent('aichat:skill-approval', {
                detail: {
                  type: eventPayload.name,
                  ...((eventPayload.data && typeof eventPayload.data === 'object'
                    ? eventPayload.data
                    : {}) as Record<string, unknown>),
                },
              }),
            )
          } catch {
            // ignore UI dispatch errors
          }
        }
        if (eventPayload.kind === 'tool_call' && identity) {
          const data =
            eventPayload.data && typeof eventPayload.data === 'object'
              ? (eventPayload.data as Record<string, unknown>)
              : {}
          const toolEvent = normalizeBattleToolEvent(data.event)
          if (toolEvent) {
            appendNodeToolEvent(identity.modelKey, identity.attemptIndex, toolEvent)
          }
        }
      }

      if (event.type === 'step_complete') {
        const eventPayload = (event.payload || {}) as Record<string, unknown>
        const result = eventPayload.result as BattleResult | undefined
        if (result) {
          const modelKey = buildModelKey({
            modelId: result.modelId,
            connectionId: result.connectionId,
            rawId: result.rawId,
          })
          const matched = models.find((m) => {
            if (result.connectionId != null && result.rawId) {
              return m.connectionId === result.connectionId && m.rawId === result.rawId
            }
            return m.id === result.modelId
          })
          const enriched = { ...result, modelLabel: result.modelLabel || matched?.name || result.modelId }
          setResults((prev) => {
            const next = prev.filter((item) => {
              const key = buildModelKey({
                modelId: item.modelId,
                connectionId: item.connectionId,
                rawId: item.rawId,
              })
              return !(key === modelKey && item.attemptIndex === result.attemptIndex)
            })
            next.push(enriched)
            return next
          })

          updateNodeState(modelKey, result.attemptIndex, {
            status: result.error
              ? 'error'
              : (result.judgeStatus === 'running'
                ? 'judging'
                : (result.judgeStatus === 'success' && result.judgePass === true)
                  ? 'success'
                  : 'error'),
            durationMs: result.durationMs,
            output: result.output,
            error: result.error,
            judgeStatus: result.judgeStatus,
            judgeError: result.judgeError,
            judgePass: result.judgePass,
            judgeScore: result.judgeScore,
            judgeReason: result.judgeReason,
          })
        } else {
          const identity = parseExecutionStepIdentity(event.stepId)
          const error = typeof eventPayload.error === 'string' ? eventPayload.error : null
          if (identity && error) {
            updateNodeState(identity.modelKey, identity.attemptIndex, {
              status: 'error',
              error,
            })
          }
        }
      }

      if (event.type === 'run_complete') {
        const eventPayload = (event.payload || {}) as Record<string, unknown>
        const nextSummary = eventPayload.summary as BattleRunSummary['summary'] | undefined
        if (nextSummary) {
          setSummary(nextSummary)
        }
        setRunStatus('completed')
      }

      if (event.type === 'run_error') {
        const eventPayload = (event.payload || {}) as Record<string, unknown>
        const message = typeof eventPayload.message === 'string' ? eventPayload.message : '乱斗执行失败'
        setError(message)
        setIsRunning(false)
        setRunStatus(event.status === 'cancelled' ? 'cancelled' : 'error')
        return { success: false, error: message }
      }

      if (event.type === 'complete') {
        setIsRunning(false)
        setStep('result')
        setRunStatus((prev) => (prev === 'error' || prev === 'cancelled' ? prev : 'completed'))
      }
    }

    return { success: true }
  } catch (err: any) {
    if (signal.aborted) {
      setIsRunning(false)
      setStep('result')
      setRunStatus('cancelled')
      return { success: false }
    }
    const message = err?.message || '乱斗执行失败'
    setError(message)
    setIsRunning(false)
    setRunStatus('error')
    return { success: false, error: message }
  }
}
