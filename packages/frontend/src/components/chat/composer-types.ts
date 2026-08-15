export interface ComposerSkillOption {
  skillId: number
  versionId: number | null
  slug: string
  label: string
  description?: string
  enabled: boolean
  updating?: boolean
  sourceLabel?: string
  licenseName?: string | null
}
