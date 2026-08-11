export type UsageMetricSum = {
  promptTokens?: number | null
  completionTokens?: number | null
  totalTokens?: number | null
}

export type UsageTotalsDto = {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
}

/** 将 Prisma usageMetric._sum 映射为 API totals，避免 findMany 全表加载。 */
export const aggregateUsageMetricTotals = (sum: UsageMetricSum | null | undefined): UsageTotalsDto => ({
  prompt_tokens: Number(sum?.promptTokens || 0),
  completion_tokens: Number(sum?.completionTokens || 0),
  total_tokens: Number(sum?.totalTokens || 0),
})
