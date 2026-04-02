import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSingleModelBattleController } from './useSingleModelBattleController'

function createMockZustandStore<T extends Record<string, any>>(state: T) {
  let storeState = state
  const store = ((selector?: (slice: T) => any) => (selector ? selector(storeState) : storeState)) as any
  store.getState = () => storeState
  store.setState = (partial: Partial<T> | ((current: T) => Partial<T>)) => {
    const next = typeof partial === 'function' ? partial(storeState) : partial
    storeState = { ...storeState, ...next }
  }
  store.subscribe = () => () => {}
  store.destroy = () => {}
  return store
}

const { mockModelsState, mockToast } = vi.hoisted(() => ({
  mockModelsState: {
    models: [
      { id: 'model-a', name: 'Model A', connectionId: null, rawId: 'model-a' },
      { id: 'judge-a', name: 'Judge A', connectionId: null, rawId: 'judge-a' },
    ],
  },
  mockToast: vi.fn(),
}))

vi.mock('@/store/models-store', () => ({
  useModelsStore: createMockZustandStore(mockModelsState),
}))

vi.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}))

const api = vi.hoisted(() => ({
  listBattleRuns: vi.fn(),
  getBattleRun: vi.fn(),
  streamBattle: vi.fn(),
  cancelBattleRun: vi.fn(),
  createBattleShare: vi.fn(),
}))

vi.mock('@/features/battle/api', () => api)

describe('useSingleModelBattleController', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sessionStorage.clear()
    api.listBattleRuns.mockResolvedValue({
      success: true,
      data: {
        runs: [
          { id: 1, mode: 'single_model_multi_question', title: 'single run', createdAt: '2026-04-01T00:00:00.000Z', updatedAt: '2026-04-01T00:00:00.000Z', status: 'completed', prompt: { text: '', images: [] }, expectedAnswer: { text: '', images: [] }, judgeModelId: 'judge-a', judgeThreshold: 0.8, runsPerModel: 1, passK: 1, summary: { totalModels: 1, runsPerModel: 1, passK: 1, judgeThreshold: 0.8, passModelCount: 1, accuracy: 1, modelStats: [] } },
          { id: 2, mode: 'multi_model', title: 'other mode', createdAt: '2026-04-01T00:00:00.000Z', updatedAt: '2026-04-01T00:00:00.000Z', status: 'completed', prompt: { text: '', images: [] }, expectedAnswer: { text: '', images: [] }, judgeModelId: 'judge-a', judgeThreshold: 0.8, runsPerModel: 1, passK: 1, summary: { totalModels: 1, runsPerModel: 1, passK: 1, judgeThreshold: 0.8, passModelCount: 1, accuracy: 1, modelStats: [] } },
        ],
      },
    })
    api.getBattleRun.mockResolvedValue({
      success: true,
      data: {
        id: 1,
        mode: 'single_model_multi_question',
        status: 'completed',
        title: 'single run',
        prompt: { text: '', images: [] },
        expectedAnswer: { text: '', images: [] },
        judgeModelId: 'judge-a',
        judgeConnectionId: null,
        judgeRawId: 'judge-a',
        judgeThreshold: 0.8,
        runsPerModel: 1,
        passK: 1,
        createdAt: '2026-04-01T00:00:00.000Z',
        updatedAt: '2026-04-01T00:00:00.000Z',
        summary: { totalModels: 1, runsPerModel: 1, passK: 1, judgeThreshold: 0.8, passModelCount: 1, accuracy: 1, totalQuestions: 1, passedQuestions: 1, stabilityScore: 1, modelStats: [] },
        config: {
          model: { modelId: 'model-a', connectionId: null, rawId: 'model-a' },
          questions: [
            {
              questionId: 'q-1',
              title: '题目 1',
              prompt: { text: 'prompt-1' },
              expectedAnswer: { text: 'answer-1' },
              runsPerQuestion: 1,
              passK: 1,
            },
          ],
        },
        results: [],
      },
    })
  })

  it('loads only single-model history and can reuse a run as new task', async () => {
    const { result } = renderHook(() => useSingleModelBattleController())

    await waitFor(() => {
      expect(result.current.history).toHaveLength(1)
    })

    expect(result.current.history[0].mode).toBe('single_model_multi_question')

    await act(async () => {
      await result.current.handleLoadHistory(1, true)
    })

    expect(result.current.questions).toHaveLength(1)
    expect(result.current.questions[0].title).toBe('题目 1')
    expect(result.current.runId).toBeNull()
    expect(result.current.runStatus).toBe('idle')
    expect(result.current.sourceRunId).toBe(1)
  })

  it('restores model and judge selections from loaded history detail', async () => {
    const { result } = renderHook(() => useSingleModelBattleController())

    await act(async () => {
      await result.current.handleLoadHistory(1, true)
    })

    expect(result.current.selectedModel?.id).toBe('model-a')
    expect(result.current.selectedJudge?.id).toBe('judge-a')
    expect(result.current.selectedModelLabel).toBe('Model A')
    expect(result.current.selectedJudgeLabel).toBe('Judge A')
  })

  it('clears execution state when creating a new task', async () => {
    const { result } = renderHook(() => useSingleModelBattleController())

    await act(async () => {
      await result.current.handleLoadHistory(1, false)
    })

    expect(result.current.runStatus).toBe('completed')

    act(() => {
      result.current.handleNewTask()
    })

    expect(result.current.runId).toBeNull()
    expect(result.current.runStatus).toBe('idle')
    expect(result.current.selectedAttempt).toBeNull()
  })

  it('consumes stream events and updates run state', async () => {
    api.streamBattle.mockImplementation(async function* mockStream() {
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

    const { result } = renderHook(() => useSingleModelBattleController())

    act(() => {
      result.current.setModelKey('global:model-a')
      result.current.setJudgeKey('global:judge-a')
      result.current.setQuestions([
        {
          localId: 'q-1',
          questionId: '',
          title: '题目 1',
          prompt: 'prompt-1',
          expectedAnswer: 'answer-1',
          runsPerQuestion: 1,
          passK: 1,
        },
      ])
    })

    await act(async () => {
      await result.current.handleStart()
    })

    expect(result.current.runId).toBe(88)
    expect(result.current.runStatus).toBe('completed')
    expect(result.current.results).toHaveLength(1)
    expect(result.current.summary?.stabilityScore).toBe(1)
  })

  it('adds a fresh question draft', async () => {
    const { result } = renderHook(() => useSingleModelBattleController())

    await waitFor(() => {
      expect(api.listBattleRuns).toHaveBeenCalledTimes(1)
    })

    act(() => {
      result.current.addQuestion()
    })

    expect(result.current.questions).toHaveLength(2)
    expect(result.current.questions[1]).toMatchObject({
      prompt: '',
      expectedAnswer: '',
      runsPerQuestion: 1,
      passK: 1,
    })
  })
})
