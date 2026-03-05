export interface RequirementEntry {
  raw: string
  packageName: string
}

export class PythonDependencyPolicy {
  constructor(
    private readonly deps: {
      validatePackageName: (value: string) => string | null
      parseRequirement: (value: string) => RequirementEntry
      parseRequirementSafe: (value: string) => RequirementEntry | null
      extractMissingModuleNames: (output: string) => string[]
      moduleNameToRequirement: (moduleName: string) => string | null
    },
  ) {}

  validatePackageName(value: string): string | null {
    return this.deps.validatePackageName(value)
  }

  parseRequirement(value: string): RequirementEntry {
    return this.deps.parseRequirement(value)
  }

  parseRequirementSafe(value: string): RequirementEntry | null {
    return this.deps.parseRequirementSafe(value)
  }

  parseMissingRequirementsFromOutput(output: string): string[] {
    const modules = this.deps.extractMissingModuleNames(output)
    if (modules.length === 0) return []
    const dedup = new Set<string>()
    for (const moduleName of modules) {
      const requirement = this.deps.moduleNameToRequirement(moduleName)
      if (!requirement) continue
      const parsed = this.deps.parseRequirementSafe(requirement)
      if (!parsed) continue
      dedup.add(parsed.raw)
    }
    return Array.from(dedup).sort((a, b) => a.localeCompare(b))
  }
}
