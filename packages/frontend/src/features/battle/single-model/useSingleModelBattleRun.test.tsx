import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSingleModelBattleRun } from './useSingleModelBattleRun'

const mockToast = vi.fn()
const mockStreamBattle = vi.fn()
const mockCancelBattleRun = vi.fn()
const mockRefreshHistory = vi.fn()

vi.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}))

vi.mock('@/features/battle/api', () => ({
  streamBattle: (...args: any[]) => mockStreamBattle(...args),
  cancelBattleRun: (...args: any[]) => mockCancelBattleRun(...args),
}))

describe('useSingleModelBattleRun', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('streams a run and accumulates results', async () => {
    mockStreamBattle.mockImplementation(async function* mockStream() {
      yield { type: 'run_start', payload: { id: 88 } }
      yield {
        type: 'step_complete',
        stepId: 'battle:single:q1:a1',
        payload: {
          result: {
            id: 900,
            battleRunId: 88,
            questionIndex: 1,
            attemptIndex: 1,
            modelId: 'model-a',
            output: 'done',
            usage: {},
            judgeStatus: 'success',
            judgePass: true,
            judgeScore: 0.91,
          },
        },
      }
      yield {
        type: 'run_complete',
        payload: {
          summary: {
            totalModels: 1,
            runsPerModel: 1,
            passK: 1,
            judgeThreshold: 0.8,
            passModelCount: 1,
            accuracy: 1,
            totalQuestions: 1,
            passedQuestions: 1,
            stabilityScore: 1,
            modelStats: [],
          },
        },
      }
      yield { type: 'complete' }
    })

    const { result } = renderHook(() => useSingleModelBattleRun({ refreshHistory: mockRefreshHistory }))

    await act(async () => {
      await result.current.handleStart({
        selectedModel: { id: 'model-a', connectionId: null, rawId: 'model-a' } as any,
        selectedJudge: { id: 'judge-a', connectionId: null, rawId: 'judge-a' } as any,
        judgeThreshold: '0.8',
        maxConcurrency: '3',
        questions: [
          {
            localId: 'q-1',
            questionId: '',
            title: '题目 1',
            prompt: 'prompt-1',
            expectedAnswer: 'answer-1',
            runsPerQuestion: 1,
            passK: 1,
          },
        ],
        onBeforeStart: () => {},
      })
    })

    expect(result.current.runId).toBe(88)
    expect(result.current.runStatus).toBe('completed')
    expect(result.current.results).toHaveLength(1)
    expect(result.current.summary?.stabilityScore).toBe(1)
  })

  it('cancels active run', async () => {
    const { result } = renderHook(() => useSingleModelBattleRun({ refreshHistory: mockRefreshHistory }))

    act(() => {
      result.current.setRunId(99)
      result.current.setRunStatus('running')
      result.current.setIsRunning(true)
    })

    await act(async () => {
      await result.current.handleCancel()
    })

    expect(mockCancelBattleRun).toHaveBeenCalledWith(99)
    expect(result.current.runStatus).toBe('cancelled')
  })
})
