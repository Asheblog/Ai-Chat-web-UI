import type { SkillCatalogItem } from '@/types'

export type ScopeType = 'system' | 'user' | 'session' | 'battle_model'

export const SKILL_STATUS_BADGE_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  active: 'default',
  pending_validation: 'secondary',
  pending_approval: 'outline',
  rejected: 'destructive',
  deprecated: 'outline',
}

export const formatDateTime = (value: string | Date | null | undefined) => {
  if (!value) return '-'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '-'
  return date.toLocaleString()
}

export const parseDraftJson = (value: string, fieldName: string) => {
  const trimmed = value.trim()
  if (!trimmed) return {}
  const parsed = JSON.parse(trimmed)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${fieldName} 必须是 JSON 对象`)
  }
  return parsed as Record<string, unknown>
}

export const resolveVersionLabel = (
  skill: SkillCatalogItem | undefined,
  versionId: number | null | undefined,
) => {
  if (!skill) return versionId ? String(versionId) : 'default'
  if (!versionId) return skill.defaultVersion?.version || 'default'
  const version = skill.versions?.find((item) => item.id === versionId)
  return version?.version || String(versionId)
}
