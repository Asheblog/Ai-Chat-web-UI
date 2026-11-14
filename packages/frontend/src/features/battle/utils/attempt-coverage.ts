import type { BattleShare } from '@/types'
import { buildModelKey } from './model-key'
type LiveAttempt = NonNullable<BattleShare['payload']['live']>['attempts'][number]
export function selectUniqueAttemptCoverage(attempts: LiveAttempt[] | undefined, modelKey: string, attemptIndex: number) {
  const matches = attempts?.filter(attempt => attempt.attemptIndex === attemptIndex && buildModelKey({ modelId: attempt.modelId, connectionId: attempt.connectionId ?? null, rawId: attempt.rawId ?? null }) === modelKey)
  return matches?.length === 1 ? matches[0].toolEventsCoverage : undefined
}
