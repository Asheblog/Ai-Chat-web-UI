import type { BattleResult, BattleRunSummary } from '@/types'
import { buildModelKey } from '../utils/model-key'

export const groupBattleResults = (results: BattleResult[]) => {
  const map = new Map<string, { key: string; label: string; attempts: BattleResult[] }>()
  for (const result of results) {
    const key = buildModelKey({
      modelId: result.modelId,
      connectionId: result.connectionId,
      rawId: result.rawId,
    })
    const label = result.modelLabel || result.modelId
    const existing = map.get(key) || { key, label, attempts: [] }
    existing.attempts.push(result)
    map.set(key, existing)
  }
  const groups = Array.from(map.values())
  for (const group of groups) {
    group.attempts.sort((a, b) => a.attemptIndex - b.attemptIndex)
  }
  return groups
}

export const buildBattleStatsMap = (summary: BattleRunSummary['summary'] | null) => {
  const map = new Map<string, BattleRunSummary['summary']['modelStats'][number]>()
  if (!summary) return map
  const items = Array.isArray(summary.modelStats) ? summary.modelStats : []
  for (const item of items) {
    const key = buildModelKey({
      modelId: item.modelId,
      connectionId: item.connectionId,
      rawId: item.rawId,
    })
    map.set(key, item)
  }
  return map
}
