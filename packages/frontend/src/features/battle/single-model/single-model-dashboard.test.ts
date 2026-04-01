import { describe, expect, it } from 'vitest'
import { buildMonitorStats, getVisibleHistoryItems } from './single-model-dashboard'

describe('single-model dashboard helpers', () => {
  it('returns only the latest three history items when collapsed', () => {
    const history = [
      { id: 4 },
      { id: 3 },
      { id: 2 },
      { id: 1 },
    ] as any

    expect(getVisibleHistoryItems(history, false).map((item) => item.id)).toEqual([4, 3, 2])
    expect(getVisibleHistoryItems(history, true).map((item) => item.id)).toEqual([4, 3, 2, 1])
  })

  it('builds monitor counts from question attempt statuses', () => {
    const questions = [
      {
        questionIndex: 1,
        title: 'Q1',
        passCount: 1,
        passK: 1,
        runsPerQuestion: 2,
        passed: true,
        attempts: [
          { attemptIndex: 1, status: 'done', passed: true },
          { attemptIndex: 2, status: 'running', passed: false },
        ],
      },
      {
        questionIndex: 2,
        title: 'Q2',
        passCount: 0,
        passK: 1,
        runsPerQuestion: 1,
        passed: false,
        attempts: [
          { attemptIndex: 1, status: 'pending', passed: false },
        ],
      },
    ] as any

    expect(buildMonitorStats(questions, 'running')).toMatchObject({
      totalAttempts: 3,
      completedAttempts: 1,
      activeAttempts: 1,
      pendingAttempts: 1,
      passedQuestions: 1,
      failedQuestions: 1,
    })
  })
})
