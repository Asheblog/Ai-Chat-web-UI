import type { SkillUninstallDependencySource } from "@/types"

/**
 * 卸载预览的数据归一化：后端字段可能是任意 JSON（历史版本缺字段、脏数据），
 * 这里把字符串列表去空去重、把「激活 Skill 占用」的来源按包名聚合并排序。
 * 逻辑与原 `SkillsGovernancePage` 完全一致，仅迁出到独立模块以便页头/段组件共用。
 */

export type SkillUninstallPreviewState = {
  skillId: number
  skillDisplayName: string
  removedRequirements: string[]
  removablePackages: string[]
  keptByActiveSkills: string[]
  keptByActiveSkillSources: SkillUninstallDependencySource[]
  keptByManual: string[]
}

export const ensureStringList = (value: unknown): string[] => {
  if (!Array.isArray(value)) return []
  return Array.from(
    new Set(value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean)),
  )
}

export const ensureActiveDependencySources = (value: unknown): SkillUninstallDependencySource[] => {
  if (!Array.isArray(value)) return []

  const normalizeConsumers = (consumers: SkillUninstallDependencySource["consumers"]) =>
    [...consumers].sort((a, b) => {
      const skillCompare = a.skillSlug.localeCompare(b.skillSlug)
      if (skillCompare !== 0) return skillCompare
      const versionCompare = a.version.localeCompare(b.version)
      if (versionCompare !== 0) return versionCompare
      return a.requirement.localeCompare(b.requirement)
    })

  const packageMap = new Map<string, SkillUninstallDependencySource["consumers"][number][]>()

  for (const rawSource of value) {
    const source = rawSource as { packageName?: unknown; consumers?: unknown }
    const packageName = typeof source.packageName === "string" ? source.packageName.trim() : ""
    if (!packageName) continue
    const consumersRaw = Array.isArray(source.consumers) ? source.consumers : []
    const consumers = packageMap.get(packageName) ?? []

    for (const rawConsumer of consumersRaw) {
      const consumer = rawConsumer as {
        skillId?: unknown
        skillSlug?: unknown
        skillDisplayName?: unknown
        versionId?: unknown
        version?: unknown
        requirement?: unknown
      }
      const skillId = Number(consumer.skillId)
      const versionId = Number(consumer.versionId)
      const skillSlug = typeof consumer.skillSlug === "string" ? consumer.skillSlug.trim() : ""
      const skillDisplayName =
        typeof consumer.skillDisplayName === "string" ? consumer.skillDisplayName.trim() : ""
      const version = typeof consumer.version === "string" ? consumer.version.trim() : ""
      const requirement = typeof consumer.requirement === "string" ? consumer.requirement.trim() : ""
      if (
        !Number.isFinite(skillId) ||
        !Number.isFinite(versionId) ||
        !skillSlug ||
        !version ||
        !requirement
      ) {
        continue
      }

      consumers.push({
        skillId,
        skillSlug,
        skillDisplayName: skillDisplayName || skillSlug,
        versionId,
        version,
        requirement,
      })
    }

    packageMap.set(packageName, consumers)
  }

  const normalized: SkillUninstallDependencySource[] = []
  for (const [packageName, consumers] of packageMap.entries()) {
    const dedupMap = new Map<string, SkillUninstallDependencySource["consumers"][number]>()
    for (const consumer of consumers) {
      dedupMap.set(
        `${consumer.skillId}:${consumer.versionId}:${consumer.requirement.toLowerCase()}`,
        consumer,
      )
    }
    normalized.push({
      packageName,
      consumers: normalizeConsumers(Array.from(dedupMap.values())),
    })
  }

  return normalized.sort((a, b) => a.packageName.localeCompare(b.packageName))
}
