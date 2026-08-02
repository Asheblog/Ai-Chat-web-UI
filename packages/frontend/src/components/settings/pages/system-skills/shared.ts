import type { SkillCatalogItem } from '@/types'
import { formatDateTime } from '@/features/settings/shared'

export type ScopeType = 'system' | 'user' | 'session' | 'battle_model'

export const SKILL_STATUS_BADGE_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  active: 'default',
  pending_validation: 'secondary',
  pending_approval: 'outline',
  rejected: 'destructive',
  deprecated: 'outline',
}

// formatDateTime 已收敛至 features/settings/shared（可空容忍版），此处为兼容再导出
export { formatDateTime }

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
