import { describe, expect, it } from 'vitest'
import {
  buildQuestionViews,
  buildSelectedDetail,
  buildSelectedNodeKey,
  computeStability,
} from './single-model-derived'

describe('single-model derived helpers', () => {
  it('builds question views from results and live attempts', () => {
    const questionViews = buildQuestionViews({
      questions: [
        {
          localId: 'q-1',
          questionId: '',
          title: '题目 1',
          prompt: 'prompt',
          expectedAnswer: 'answer',
          runsPerQuestion: 2,
          passK: 1,
        },
      ],
      results: [
        {
          id: 1,
          battleRunId: 10,
          questionIndex: 1,
          attemptIndex: 1,
          modelId: 'model-a',
          output: 'ok',
          usage: {},
          judgeStatus: 'success',
          judgePass: true,
          judgeScore: 0.93,
        },
      ] as any,
      liveAttempts: new Map([
        ['1#2', { status: 'running', output: '', reasoning: '' }],
      ]),
    })

    expect(questionViews).toHaveLength(1)
    expect(questionViews[0]).toMatchObject({
      title: '题目 1',
      passCount: 1,
      passed: true,
    })
    expect(questionViews[0].attempts.map((item) => item.status)).toEqual(['done', 'running'])
  })

  it('builds selected detail from a persisted result and computes stability', () => {
    const questions = [
      {
        localId: 'q-1',
        questionId: '',
        title: '题目 1',
        prompt: 'prompt',
        expectedAnswer: 'answer',
        runsPerQuestion: 1,
        passK: 1,
      },
    ]
    const results = [
      {
        id: 2,
        battleRunId: 99,
        questionIndex: 1,
        attemptIndex: 1,
        modelId: 'model-a',
        output: 'done',
        usage: {},
        judgeStatus: 'success',
        judgePass: true,
        judgeScore: 0.88,
      },
    ] as any
    const questionViews = buildQuestionViews({
      questions,
      results,
      liveAttempts: new Map(),
    })

    expect(buildSelectedNodeKey({ questionIndex: 1, attemptIndex: 1 })).toBe('1#1')
    expect(computeStability(questionViews)).toBe(1)

    const detail = buildSelectedDetail({
      selectedAttempt: { questionIndex: 1, attemptIndex: 1 },
      questions,
      selectedModel: { id: 'model-a', name: 'Model A', rawId: 'model-a' } as any,
      results,
      liveAttempts: new Map(),
    })

    expect(detail).toMatchObject({
      id: 2,
      modelKey: 'question-1',
      modelLabel: '题目 1 · Model A',
    })
  })
})
