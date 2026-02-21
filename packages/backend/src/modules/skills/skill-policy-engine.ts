import type { SkillRiskLevel } from './types'

export type SkillPolicyDecision = 'allow' | 'deny' | 'require_approval'

export interface SkillPolicyInput {
  riskLevel: SkillRiskLevel
  policy?: Record<string, unknown> | null
  hasSessionApprovedBefore?: boolean
}

export interface SkillPolicyResult {
  decision: SkillPolicyDecision
  reason: string
}

function parseDecision(value: unknown): SkillPolicyDecision | null {
  if (value === 'allow' || value === 'deny' || value === 'require_approval') {
    return value
  }
  return null
}

export function resolveSkillPolicy(input: SkillPolicyInput): SkillPolicyResult {
  const forced = parseDecision(input.policy?.decision)
  if (forced) {
    return { decision: forced, reason: 'binding policy override' }
  }

  switch (input.riskLevel) {
    case 'low':
      return { decision: 'allow', reason: 'low risk default allow' }
    case 'medium':
      if (input.hasSessionApprovedBefore) {
        return { decision: 'allow', reason: 'medium risk session approval reused' }
      }
      return { decision: 'require_approval', reason: 'medium risk default approval once per session' }
    case 'high':
      return { decision: 'require_approval', reason: 'high risk default approval for each call' }
    case 'critical':
      return { decision: 'deny', reason: 'critical risk default deny' }
    default:
      return { decision: 'deny', reason: 'unknown risk level' }
  }
}
