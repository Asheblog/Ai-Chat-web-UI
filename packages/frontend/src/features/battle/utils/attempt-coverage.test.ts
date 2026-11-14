import { describe, expect, it } from 'vitest'
import { buildToolLogCoverage } from '@aichat/shared/tool-operations'
import { selectUniqueAttemptCoverage } from './attempt-coverage'
import { buildModelKey } from './model-key'
type Attempt = NonNullable<Parameters<typeof selectUniqueAttemptCoverage>[0]>[number]
const coverage = buildToolLogCoverage({ persisted: { status: 'complete' } })
const attempt = (questionIndex: number): Attempt => ({ modelId: 'model', modelLabel: null, connectionId: null, rawId: null, attemptIndex: 1, questionIndex, status: 'success', output: '', reasoning: '', toolEventsCoverage: coverage })
const key = buildModelKey({modelId: 'model', connectionId: null, rawId: null})
describe('Battle attempt coverage authority', () => {
 it('returns coverage for exactly one matching attempt', () => { expect(selectUniqueAttemptCoverage([attempt(1)], key, 1)).toBe(coverage) })
 it('keeps coverage unknown when different questions share model and attempt index', () => { expect(selectUniqueAttemptCoverage([attempt(1),attempt(2)], key, 1)).toBeUndefined() })
 it('keeps absent attempts unknown', () => { expect(selectUniqueAttemptCoverage(undefined, key, 1)).toBeUndefined() })
})
