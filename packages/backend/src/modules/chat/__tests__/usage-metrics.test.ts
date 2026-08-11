import { aggregateUsageMetricTotals } from '../usage-metrics'

describe('aggregateUsageMetricTotals', () => {
  test('maps prisma _sum aggregate into totals without loading rows', () => {
    expect(
      aggregateUsageMetricTotals({
        promptTokens: 10,
        completionTokens: 20,
        totalTokens: 30,
      }),
    ).toEqual({
      prompt_tokens: 10,
      completion_tokens: 20,
      total_tokens: 30,
    })
  })

  test('treats null sums as zero', () => {
    expect(
      aggregateUsageMetricTotals({
        promptTokens: null,
        completionTokens: null,
        totalTokens: null,
      }),
    ).toEqual({
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    })
  })
})
