export class PythonRuntimeSourceRegistry {
  constructor(
    private readonly deps: {
      readSettings: (keys: string[]) => Promise<Map<string, string>>
      upsertSetting: (key: string, value: string) => Promise<void>
      parseJsonArray: (value: string | undefined) => string[]
      normalizePackageList: (items: string[]) => string[]
    },
  ) {}

  async get(settingKey: string): Promise<string[]> {
    const map = await this.deps.readSettings([settingKey])
    const rawList = this.deps.parseJsonArray(map.get(settingKey))
    return this.deps.normalizePackageList(rawList)
  }

  async save(settingKey: string, packages: string[]): Promise<void> {
    const normalized = this.deps.normalizePackageList(packages)
    await this.deps.upsertSetting(settingKey, JSON.stringify(normalized))
  }

  async add(settingKey: string, packages: string[]): Promise<void> {
    const existing = await this.get(settingKey)
    const merged = this.deps.normalizePackageList([...existing, ...packages])
    await this.save(settingKey, merged)
  }

  async remove(settingKey: string, packages: string[]): Promise<void> {
    const existing = await this.get(settingKey)
    if (existing.length === 0) return
    const removeSet = new Set(this.deps.normalizePackageList(packages))
    if (removeSet.size === 0) return
    const next = existing.filter((item) => !removeSet.has(item))
    await this.save(settingKey, next)
  }
}
