import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSingleModelBattleHistory } from './useSingleModelBattleHistory'

const mockToast = vi.fn()
const mockListBattleRuns = vi.fn()
const mockGetBattleRun = vi.fn()

vi.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}))

vi.mock('@/features/battle/api', () => ({
  listBattleRuns: (...args: any[]) => mockListBattleRuns(...args),
  getBattleRun: (...args: any[]) => mockGetBattleRun(...args),
}))

describe('useSingleModelBattleHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sessionStorage.clear()
    mockListBattleRuns.mockResolvedValue({
      success: true,
      data: {
        runs: [
          { id: 1, mode: 'single_model_multi_question', title: 'single run', createdAt: '2026-04-01T00:00:00.000Z', updatedAt: '2026-04-01T00:00:00.000Z', status: 'completed', prompt: { text: '', images: [] }, expectedAnswer: { text: '', images: [] }, judgeModelId: 'judge-a', judgeThreshold: 0.8, runsPerModel: 1, passK: 1, summary: { totalModels: 1, runsPerModel: 1, passK: 1, judgeThreshold: 0.8, passModelCount: 1, accuracy: 1, modelStats: [] } },
          { id: 2, mode: 'multi_model', title: 'other mode', createdAt: '2026-04-01T00:00:00.000Z', updatedAt: '2026-04-01T00:00:00.000Z', status: 'completed', prompt: { text: '', images: [] }, expectedAnswer: { text: '', images: [] }, judgeModelId: 'judge-a', judgeThreshold: 0.8, runsPerModel: 1, passK: 1, summary: { totalModels: 1, runsPerModel: 1, passK: 1, judgeThreshold: 0.8, passModelCount: 1, accuracy: 1, modelStats: [] } },
        ],
      },
    })
    mockGetBattleRun.mockResolvedValue({
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

  it('filters history and loads single-model run detail', async () => {
    const { result } = renderHook(() => useSingleModelBattleHistory())

    await waitFor(() => {
      expect(result.current.history).toHaveLength(1)
    })

    let detail: any = null
    await act(async () => {
      detail = await result.current.fetchRunDetail(1)
    })

    expect(result.current.history[0].mode).toBe('single_model_multi_question')
    expect(detail?.id).toBe(1)
  })
})
