import { describe, expect, it } from 'vitest'
import { buildQuestionsFromRunDetail, parseExecutionStepIdentity } from './single-model-runtime'

describe('single-model runtime helpers', () => {
  it('parses execution step identity from step id', () => {
    expect(parseExecutionStepIdentity('battle:single:q2:a3')).toEqual({ questionIndex: 2, attemptIndex: 3 })
    expect(parseExecutionStepIdentity('invalid')).toBeNull()
  })

  it('builds clamped question drafts from run detail config', () => {
    const detail = {
      id: 42,
      config: {
        questions: [
          {
            questionId: 'q-1',
            title: '题目 1',
            prompt: { text: 'prompt-1' },
            expectedAnswer: { text: 'answer-1' },
            runsPerQuestion: 5,
            passK: 4,
          },
        ],
      },
    } as any

    const drafts = buildQuestionsFromRunDetail(detail, () => 'local-1')

    expect(drafts).toEqual([
      {
        localId: 'local-1',
        questionId: 'q-1',
        title: '题目 1',
        prompt: 'prompt-1',
        expectedAnswer: 'answer-1',
        runsPerQuestion: 3,
        passK: 3,
      },
    ])
  })
})
