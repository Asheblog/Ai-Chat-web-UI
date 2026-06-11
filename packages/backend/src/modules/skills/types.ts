export type SkillRiskLevel = 'low' | 'medium' | 'high' | 'critical'

export type SkillVersionStatus =
  | 'pending_validation'
  | 'pending_approval'
  | 'active'
  | 'rejected'
  | 'deprecated'

export type SkillScopeType = 'system' | 'user' | 'session' | 'battle_model'

export type SkillApprovalStatus = 'pending' | 'approved' | 'denied' | 'expired'

export type SkillRuntimeType = 'node' | 'python' | 'shell' | 'powershell' | 'cmd'

export interface SkillRuntimeManifest {
  type: SkillRuntimeType
  command?: string
  args?: string[]
  env?: Record<string, string>
  timeout_ms?: number
  max_output_chars?: number
}

export interface SkillToolManifest {
  name: string
  description: string
  input_schema: Record<string, unknown>
  aliases?: string[]
}

export interface SkillManifest {
  id: string
  name: string
  version: string
  entry: string
  tools: SkillToolManifest[]
  python_packages?: string[]
  capabilities: string[]
  runtime: SkillRuntimeManifest
  permissions: string[]
  platforms: string[]
  risk_level: SkillRiskLevel
}

export interface RequestedSkillReference {
  skillId: number
  versionId: number
  overrides?: Record<string, unknown>
}

export interface RequestedSkillsPayload {
  builtin: string[]
  enabled: RequestedSkillReference[]
  overrides?: Record<string, Record<string, unknown>>
}

export const BUILTIN_SKILL_SLUGS = {
  WEB_SEARCH: 'web-search',
  PYTHON_RUNNER: 'python-runner',
  URL_READER: 'url-reader',
  DOCUMENT_SEARCH: 'document-search',
  KNOWLEDGE_BASE_SEARCH: 'knowledge-base-search',
} as const

export function normalizeSkillSlug(value: string): string {
  return value.trim().toLowerCase()
}

export function normalizeRequestedSkills(input: unknown): RequestedSkillsPayload {
  if (!input || typeof input !== 'object') {
    return { builtin: [], enabled: [] }
  }
  const raw = input as Record<string, unknown>
  const builtinRaw = Array.isArray(raw.builtin) ? raw.builtin : []
  const builtin = builtinRaw
    .map((item) => (typeof item === 'string' ? normalizeSkillSlug(item) : ''))
    .filter((item) => item.length > 0)
    .filter((item) => Object.values(BUILTIN_SKILL_SLUGS).includes(item as any))

  const enabled = Array.isArray(raw.enabled)
    ? raw.enabled
        .map((item): RequestedSkillReference | null => {
          if (!item || typeof item !== 'object' || Array.isArray(item)) return null
          const record = item as Record<string, unknown>
          const skillId = Number(record.skillId)
          const versionId = Number(record.versionId)
          if (!Number.isInteger(skillId) || skillId <= 0) return null
          if (!Number.isInteger(versionId) || versionId <= 0) return null
          const overrides =
            record.overrides && typeof record.overrides === 'object' && !Array.isArray(record.overrides)
              ? (record.overrides as Record<string, unknown>)
              : undefined
          return { skillId, versionId, ...(overrides ? { overrides } : {}) }
        })
        .filter((item): item is RequestedSkillReference => Boolean(item))
    : []

  const uniqueBuiltin = Array.from(new Set(builtin))
  const uniqueEnabledMap = new Map<string, RequestedSkillReference>()
  for (const item of enabled) {
    uniqueEnabledMap.set(`${item.skillId}:${item.versionId}`, item)
  }
  const overridesRaw = raw.overrides
  const overrides: Record<string, Record<string, unknown>> = {}
  if (overridesRaw && typeof overridesRaw === 'object' && !Array.isArray(overridesRaw)) {
    for (const [key, value] of Object.entries(overridesRaw)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue
      overrides[normalizeSkillSlug(key)] = value as Record<string, unknown>
    }
  }

  return {
    builtin: uniqueBuiltin,
    enabled: Array.from(uniqueEnabledMap.values()),
    overrides: Object.keys(overrides).length > 0 ? overrides : undefined,
  }
}
