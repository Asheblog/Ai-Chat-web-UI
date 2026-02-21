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

export interface RequestedSkillsPayload {
  enabled: string[]
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
    return { enabled: [] }
  }
  const raw = input as Record<string, unknown>
  const enabled = Array.isArray(raw.enabled)
    ? raw.enabled
        .map((item) => (typeof item === 'string' ? normalizeSkillSlug(item) : ''))
        .filter((item) => item.length > 0)
    : []

  const uniqueEnabled = Array.from(new Set(enabled))
  const overridesRaw = raw.overrides
  const overrides: Record<string, Record<string, unknown>> = {}
  if (overridesRaw && typeof overridesRaw === 'object' && !Array.isArray(overridesRaw)) {
    for (const [key, value] of Object.entries(overridesRaw)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue
      overrides[normalizeSkillSlug(key)] = value as Record<string, unknown>
    }
  }

  return {
    enabled: uniqueEnabled,
    overrides: Object.keys(overrides).length > 0 ? overrides : undefined,
  }
}
