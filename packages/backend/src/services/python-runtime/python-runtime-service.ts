import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { PrismaClient } from '@prisma/client'
import { createLogger } from '../../utils/logger'

const logger = createLogger('PythonRuntime')

const INDEX_KEY = 'python_runtime_index_url'
const EXTRA_INDEXES_KEY = 'python_runtime_extra_index_urls'
const TRUSTED_HOSTS_KEY = 'python_runtime_trusted_hosts'
const AUTO_INSTALL_ON_ACTIVATE_KEY = 'python_runtime_auto_install_on_activate'
const MANUAL_PACKAGES_KEY = 'python_runtime_manual_packages'

const DEFAULT_OPERATION_TIMEOUT_MS = 120_000
const DEFAULT_PIP_TIMEOUT_MS = 240_000
const OUTPUT_LIMIT = 200_000

export type PythonRuntimeInstallSource = 'manual' | 'skill'

export interface PythonRuntimeIndexes {
  indexUrl?: string
  extraIndexUrls: string[]
  trustedHosts: string[]
  autoInstallOnActivate: boolean
}

export interface PythonRuntimeInstalledPackage {
  name: string
  version: string
}

export interface PythonRuntimeDependencyItem {
  skillId: number
  skillSlug: string
  skillDisplayName: string
  versionId: number
  version: string
  requirement: string
  packageName: string
}

export interface PythonRuntimeConflictItem {
  packageName: string
  requirements: string[]
  skills: Array<{
    skillId: number
    skillSlug: string
    versionId: number
    version: string
    requirement: string
  }>
}

export interface PythonRuntimeStatus {
  dataRoot: string
  runtimeRoot: string
  venvPath: string
  pythonPath: string
  ready: boolean
  runtimeIssue?: {
    code: string
    message: string
    details?: Record<string, unknown>
  }
  indexes: PythonRuntimeIndexes
  manualPackages: string[]
  installedPackages: PythonRuntimeInstalledPackage[]
  activeDependencies: PythonRuntimeDependencyItem[]
  conflicts: PythonRuntimeConflictItem[]
}

export interface PythonRuntimeInstallResult {
  source: PythonRuntimeInstallSource
  requirements: string[]
  pipCheckPassed: boolean
  pipCheckOutput: string
  installedPackages: PythonRuntimeInstalledPackage[]
}

export interface PythonRuntimeUninstallResult {
  packages: string[]
  pipCheckPassed: boolean
  pipCheckOutput: string
  installedPackages: PythonRuntimeInstalledPackage[]
}

export interface PythonRuntimeReconcileResult {
  requirements: string[]
  pipCheckPassed: boolean
  pipCheckOutput: string
  installedPackages: PythonRuntimeInstalledPackage[]
  conflicts: PythonRuntimeConflictItem[]
}

export interface PythonRuntimeSkillDependencyConsumer {
  skillId: number
  skillSlug: string
  skillDisplayName: string
  versionId: number
  version: string
  requirement: string
}

export interface PythonRuntimeSkillDependencySource {
  packageName: string
  consumers: PythonRuntimeSkillDependencyConsumer[]
}

export interface PythonRuntimeSkillCleanupResult {
  removedSkillPackages: string[]
  keptByActiveSkills: string[]
  keptByActiveSkillSources: PythonRuntimeSkillDependencySource[]
  keptByManual: string[]
  removablePackages: string[]
  removedPackages: string[]
}

export interface PythonRuntimeSkillCleanupPlan {
  removedSkillPackages: string[]
  keptByActiveSkills: string[]
  keptByActiveSkillSources: PythonRuntimeSkillDependencySource[]
  keptByManual: string[]
  removablePackages: string[]
}

export class PythonRuntimeServiceError extends Error {
  readonly statusCode: number
  readonly code: string
  readonly details?: Record<string, unknown>

  constructor(
    message: string,
    statusCode = 400,
    code = 'PYTHON_RUNTIME_ERROR',
    details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'PythonRuntimeServiceError'
    this.statusCode = statusCode
    this.code = code
    this.details = details
  }
}

interface RequirementEntry {
  raw: string
  packageName: string
}

interface RuntimePaths {
  dataRoot: string
  runtimeRoot: string
  venvPath: string
  pythonPath: string
}

interface CommandResult {
  stdout: string
  stderr: string
  exitCode: number | null
  durationMs: number
}

interface PythonRuntimeServiceDeps {
  prisma?: PrismaClient
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
}

const normalizePackageName = (value: string) => value.trim().toLowerCase().replace(/[-_.]+/g, '-')

const parseJsonArray = (value: string | undefined): string[] => {
  if (!value || !value.trim()) return []
  try {
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter(Boolean)
  } catch {
    return []
  }
}

const sanitizeList = (items: string[] | undefined, max = 32): string[] => {
  if (!Array.isArray(items)) return []
  const dedup = new Set<string>()
  for (const item of items) {
    const trimmed = (item || '').trim()
    if (!trimmed) continue
    dedup.add(trimmed)
    if (dedup.size >= max) break
  }
  return Array.from(dedup)
}

const ensureString = (value: string | undefined | null, maxLength = 512) => {
  const trimmed = (value || '').trim()
  if (!trimmed) return ''
  if (trimmed.length > maxLength) {
    throw new PythonRuntimeServiceError(
      `配置值过长（最大 ${maxLength} 字符）`,
      400,
      'PYTHON_RUNTIME_INVALID_INDEX',
    )
  }
  return trimmed
}

const validatePackageName = (value: string): string | null => {
  const normalized = value.trim()
  if (!normalized) return null
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(normalized)) return null
  return normalizePackageName(normalized)
}

const parseRequirement = (value: string): RequirementEntry => {
  const raw = value.trim()
  if (!raw) {
    throw new PythonRuntimeServiceError('依赖项不能为空', 400, 'PYTHON_RUNTIME_INVALID_REQUIREMENT')
  }

  const lower = raw.toLowerCase()
  if (raw.startsWith('-') || lower.includes('git+') || raw.includes('://') || raw.includes('\\') || raw.includes('/')) {
    throw new PythonRuntimeServiceError(
      `依赖格式不安全：${raw}`,
      400,
      'PYTHON_RUNTIME_INVALID_REQUIREMENT',
      { requirement: raw },
    )
  }
  if (raw.includes('@')) {
    throw new PythonRuntimeServiceError(
      `不支持直接引用依赖：${raw}`,
      400,
      'PYTHON_RUNTIME_INVALID_REQUIREMENT',
      { requirement: raw },
    )
  }

  const matched = raw.match(/^([A-Za-z0-9][A-Za-z0-9._-]*)(\[[A-Za-z0-9,._-]+\])?(.*)$/)
  if (!matched) {
    throw new PythonRuntimeServiceError(
      `依赖格式无效：${raw}`,
      400,
      'PYTHON_RUNTIME_INVALID_REQUIREMENT',
      { requirement: raw },
    )
  }

  const packageName = normalizePackageName(matched[1])
  const rest = (matched[3] || '').trim()
  if (
    rest &&
    !/^(?:[!<>=~]{1,2}\s*[^,;\s]+(?:\s*,\s*[!<>=~]{1,2}\s*[^,;\s]+)*)?(?:\s*;\s*.+)?$/.test(rest)
  ) {
    throw new PythonRuntimeServiceError(
      `依赖版本约束无效：${raw}`,
      400,
      'PYTHON_RUNTIME_INVALID_REQUIREMENT',
      { requirement: raw },
    )
  }

  return { raw, packageName }
}

const parseRequirementSafe = (value: string): RequirementEntry | null => {
  try {
    return parseRequirement(value)
  } catch {
    return null
  }
}

const normalizePackageList = (items: string[] | undefined, max = 512): string[] => {
  if (!Array.isArray(items)) return []
  const dedup = new Set<string>()
  for (const item of items) {
    const normalized = validatePackageName(item || '')
    if (!normalized) continue
    dedup.add(normalized)
    if (dedup.size >= max) break
  }
  return Array.from(dedup).sort((a, b) => a.localeCompare(b))
}

const DEGRADED_RUNTIME_STATUS_CODES = new Set([
  'PYTHON_RUNTIME_PIP_UNAVAILABLE',
  'PYTHON_RUNTIME_CREATE_VENV_FAILED',
  'PYTHON_RUNTIME_COMMAND_ERROR',
])

export class PythonRuntimeService {
  private readonly prisma: PrismaClient
  private readonly env: NodeJS.ProcessEnv
  private readonly platform: NodeJS.Platform
  private operationQueue: Promise<unknown> = Promise.resolve()

  constructor(deps: PythonRuntimeServiceDeps = {}) {
    if (!deps.prisma) {
      throw new PythonRuntimeServiceError(
        'PythonRuntimeService requires prisma instance',
        500,
        'PYTHON_RUNTIME_MISSING_PRISMA',
      )
    }
    this.prisma = deps.prisma
    this.env = deps.env ?? process.env
    this.platform = deps.platform ?? process.platform
  }

  resolvePaths(): RuntimePaths {
    const rawDataRoot = this.env.APP_DATA_DIR || this.env.DATA_DIR || path.resolve(process.cwd(), 'data')
    const dataRoot = path.resolve(rawDataRoot)
    const runtimeRoot = path.resolve(dataRoot, 'python-runtime')
    const venvPath = path.resolve(runtimeRoot, 'venv')
    const pythonPath =
      this.platform === 'win32'
        ? path.resolve(venvPath, 'Scripts', 'python.exe')
        : path.resolve(venvPath, 'bin', 'python')

    return {
      dataRoot,
      runtimeRoot,
      venvPath,
      pythonPath,
    }
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.operationQueue.then(fn, fn)
    this.operationQueue = run.then(() => undefined, () => undefined)
    return run
  }

  private async readSettings(keys: string[]): Promise<Map<string, string>> {
    const rows = await this.prisma.systemSetting.findMany({
      where: { key: { in: keys } },
      select: { key: true, value: true },
    })
    return new Map(rows.map((item) => [item.key, item.value]))
  }

  private async upsertSetting(key: string, value: string): Promise<void> {
    await this.prisma.systemSetting.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    })
  }

  async getIndexes(): Promise<PythonRuntimeIndexes> {
    const map = await this.readSettings([INDEX_KEY, EXTRA_INDEXES_KEY, TRUSTED_HOSTS_KEY, AUTO_INSTALL_ON_ACTIVATE_KEY])
    const indexUrl = ensureString(map.get(INDEX_KEY)) || undefined
    const extraIndexUrls = sanitizeList(parseJsonArray(map.get(EXTRA_INDEXES_KEY)))
    const trustedHosts = sanitizeList(parseJsonArray(map.get(TRUSTED_HOSTS_KEY)))
    const autoInstallRaw = (map.get(AUTO_INSTALL_ON_ACTIVATE_KEY) || '').trim().toLowerCase()
    const autoInstallOnActivate = autoInstallRaw ? autoInstallRaw === 'true' : true

    return {
      indexUrl,
      extraIndexUrls,
      trustedHosts,
      autoInstallOnActivate,
    }
  }

  async getAutoInstallOnActivate(): Promise<boolean> {
    const indexes = await this.getIndexes()
    return indexes.autoInstallOnActivate
  }

  async updateIndexes(input: {
    indexUrl?: string
    extraIndexUrls?: string[]
    trustedHosts?: string[]
    autoInstallOnActivate?: boolean
  }): Promise<PythonRuntimeIndexes> {
    const indexUrl = input.indexUrl !== undefined ? ensureString(input.indexUrl) : undefined
    const extraIndexUrls = input.extraIndexUrls !== undefined ? sanitizeList(input.extraIndexUrls) : undefined
    const trustedHosts = input.trustedHosts !== undefined ? sanitizeList(input.trustedHosts) : undefined

    if (indexUrl !== undefined) {
      await this.upsertSetting(INDEX_KEY, indexUrl)
    }
    if (extraIndexUrls !== undefined) {
      await this.upsertSetting(EXTRA_INDEXES_KEY, JSON.stringify(extraIndexUrls))
    }
    if (trustedHosts !== undefined) {
      await this.upsertSetting(TRUSTED_HOSTS_KEY, JSON.stringify(trustedHosts))
    }
    if (typeof input.autoInstallOnActivate === 'boolean') {
      await this.upsertSetting(AUTO_INSTALL_ON_ACTIVATE_KEY, String(input.autoInstallOnActivate))
    }

    return this.getIndexes()
  }

  async getManualPackages(): Promise<string[]> {
    const map = await this.readSettings([MANUAL_PACKAGES_KEY])
    const rawList = parseJsonArray(map.get(MANUAL_PACKAGES_KEY))
    return normalizePackageList(rawList)
  }

  private async saveManualPackages(packages: string[]): Promise<void> {
    const normalized = normalizePackageList(packages)
    await this.upsertSetting(MANUAL_PACKAGES_KEY, JSON.stringify(normalized))
  }

  private async addManualPackages(packages: string[]): Promise<void> {
    const existing = await this.getManualPackages()
    const merged = normalizePackageList([...existing, ...packages])
    await this.saveManualPackages(merged)
  }

  private async removeManualPackages(packages: string[]): Promise<void> {
    const existing = await this.getManualPackages()
    if (existing.length === 0) return
    const removeSet = new Set(normalizePackageList(packages))
    if (removeSet.size === 0) return
    const next = existing.filter((item) => !removeSet.has(item))
    await this.saveManualPackages(next)
  }

  private async buildSkillCleanupPlan(input: {
    removedRequirements: string[]
    excludeSkillIds?: number[]
  }): Promise<PythonRuntimeSkillCleanupPlan> {
    const removedSkillPackages = Array.from(
      new Set(
        (input.removedRequirements || [])
          .map((item) => parseRequirementSafe(item))
          .filter((item): item is RequirementEntry => Boolean(item))
          .map((item) => item.packageName),
      ),
    ).sort((a, b) => a.localeCompare(b))

    if (removedSkillPackages.length === 0) {
      return {
        removedSkillPackages: [],
        keptByActiveSkills: [],
        keptByActiveSkillSources: [],
        keptByManual: [],
        removablePackages: [],
      }
    }

    const [activeDependenciesRaw, manualPackages] = await Promise.all([
      this.collectActiveDependencies(),
      this.getManualPackages(),
    ])
    const excludeSkillSet = new Set((input.excludeSkillIds || []).filter((id) => Number.isFinite(id)))
    const activeDependencies = excludeSkillSet.size > 0
      ? activeDependenciesRaw.filter((item) => !excludeSkillSet.has(item.skillId))
      : activeDependenciesRaw
    const activePackageSet = new Set(activeDependencies.map((item) => item.packageName))
    const manualPackageSet = new Set(manualPackages)
    const activeDependencyMap = new Map<string, PythonRuntimeSkillDependencyConsumer[]>()
    for (const dependency of activeDependencies) {
      const list = activeDependencyMap.get(dependency.packageName) ?? []
      list.push({
        skillId: dependency.skillId,
        skillSlug: dependency.skillSlug,
        skillDisplayName: dependency.skillDisplayName,
        versionId: dependency.versionId,
        version: dependency.version,
        requirement: dependency.requirement,
      })
      activeDependencyMap.set(dependency.packageName, list)
    }

    const keptByActiveSkills: string[] = []
    const keptByActiveSkillSources: PythonRuntimeSkillDependencySource[] = []
    const keptByManual: string[] = []
    const removablePackages: string[] = []

    for (const pkg of removedSkillPackages) {
      if (activePackageSet.has(pkg)) {
        keptByActiveSkills.push(pkg)
        const consumers = activeDependencyMap.get(pkg) ?? []
        const dedupConsumers = Array.from(
          new Map(
            consumers.map((item) => [
              `${item.skillId}:${item.versionId}:${item.requirement.toLowerCase()}`,
              item,
            ]),
          ).values(),
        ).sort((a, b) => {
          const skillCompare = a.skillSlug.localeCompare(b.skillSlug)
          if (skillCompare !== 0) return skillCompare
          const versionCompare = a.version.localeCompare(b.version)
          if (versionCompare !== 0) return versionCompare
          return a.requirement.localeCompare(b.requirement)
        })
        keptByActiveSkillSources.push({
          packageName: pkg,
          consumers: dedupConsumers,
        })
        continue
      }
      if (manualPackageSet.has(pkg)) {
        keptByManual.push(pkg)
        continue
      }
      removablePackages.push(pkg)
    }

    return {
      removedSkillPackages,
      keptByActiveSkills,
      keptByActiveSkillSources,
      keptByManual,
      removablePackages,
    }
  }

  async previewCleanupAfterSkillRemoval(input: {
    removedRequirements: string[]
    excludeSkillIds?: number[]
  }): Promise<PythonRuntimeSkillCleanupPlan> {
    return this.buildSkillCleanupPlan(input)
  }

  async cleanupPackagesAfterSkillRemoval(input: {
    removedRequirements: string[]
  }): Promise<PythonRuntimeSkillCleanupResult> {
    const plan = await this.buildSkillCleanupPlan(input)
    if (plan.removablePackages.length === 0) {
      return {
        ...plan,
        removedPackages: [],
      }
    }

    const result = await this.uninstallPackages(plan.removablePackages)
    return {
      ...plan,
      removedPackages: result.packages,
    }
  }

  private async fileExists(targetPath: string): Promise<boolean> {
    try {
      await fs.access(targetPath)
      return true
    } catch {
      return false
    }
  }

  private async runCommand(
    command: string,
    args: string[],
    options?: { cwd?: string; timeoutMs?: number },
  ): Promise<CommandResult> {
    const timeoutMs = Math.max(1_000, options?.timeoutMs ?? DEFAULT_OPERATION_TIMEOUT_MS)
    const startedAt = Date.now()

    return new Promise<CommandResult>((resolve, reject) => {
      const child = spawn(command, args, {
        cwd: options?.cwd,
        stdio: 'pipe',
      })

      const stdoutChunks: Buffer[] = []
      const stderrChunks: Buffer[] = []
      let stdoutLength = 0
      let stderrLength = 0

      const collect = (chunks: Buffer[], chunk: Buffer, currentLength: number): number => {
        const nextLength = currentLength + chunk.length
        if (nextLength <= OUTPUT_LIMIT) {
          chunks.push(chunk)
          return nextLength
        }
        const remain = OUTPUT_LIMIT - currentLength
        if (remain > 0) {
          chunks.push(chunk.subarray(0, remain))
        }
        return OUTPUT_LIMIT
      }

      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        reject(
          new PythonRuntimeServiceError(
            `命令执行超时（${timeoutMs}ms）`,
            504,
            'PYTHON_RUNTIME_TIMEOUT',
            { command, args },
          ),
        )
      }, timeoutMs)

      child.on('error', (error) => {
        clearTimeout(timer)
        reject(
          new PythonRuntimeServiceError(
            `命令执行失败：${error.message}`,
            500,
            'PYTHON_RUNTIME_COMMAND_ERROR',
            { command, args },
          ),
        )
      })

      child.stdout.on('data', (chunk: Buffer) => {
        stdoutLength = collect(stdoutChunks, chunk, stdoutLength)
      })
      child.stderr.on('data', (chunk: Buffer) => {
        stderrLength = collect(stderrChunks, chunk, stderrLength)
      })

      child.on('close', (code) => {
        clearTimeout(timer)
        resolve({
          stdout: Buffer.concat(stdoutChunks).toString('utf8'),
          stderr: Buffer.concat(stderrChunks).toString('utf8'),
          exitCode: typeof code === 'number' ? code : null,
          durationMs: Math.max(0, Date.now() - startedAt),
        })
      })
    })
  }

  private async createVenv(paths: RuntimePaths, options?: { clear?: boolean }): Promise<void> {
    const bootstrapCandidates =
      this.platform === 'win32'
        ? [this.env.PYTHON_BOOTSTRAP_COMMAND || 'python', 'py']
        : [this.env.PYTHON_BOOTSTRAP_COMMAND || 'python3', 'python']
    const args = ['-m', 'venv', ...(options?.clear ? ['--clear'] : []), paths.venvPath]

    let lastError: unknown = null
    for (const candidate of bootstrapCandidates) {
      const command = (candidate || '').trim()
      if (!command) continue
      try {
        const result = await this.runCommand(command, args, {
          timeoutMs: DEFAULT_OPERATION_TIMEOUT_MS,
        })
        if ((result.exitCode ?? 1) !== 0) {
          lastError = new Error(result.stderr || `exit code ${result.exitCode}`)
          continue
        }
        logger.info('created managed venv', {
          command,
          clear: Boolean(options?.clear),
          venvPath: paths.venvPath,
          durationMs: result.durationMs,
        })
        return
      } catch (error) {
        lastError = error
      }
    }

    const message = lastError instanceof Error ? lastError.message : 'unknown error'
    throw new PythonRuntimeServiceError(
      `无法创建 Python 虚拟环境：${message}`,
      500,
      'PYTHON_RUNTIME_CREATE_VENV_FAILED',
      { venvPath: paths.venvPath, clear: Boolean(options?.clear) },
    )
  }

  private commandOutput(result: CommandResult): string {
    const output = `${result.stderr}\n${result.stdout}`.trim()
    if (output) return output
    return `exit code ${result.exitCode ?? 'null'}`
  }

  private buildPipUnavailableHint(): string {
    if (this.platform === 'win32') {
      return 'Windows 请确认 Python 安装时已包含 pip/venv，必要时执行 `py -m ensurepip --upgrade`。'
    }
    return 'WSL/Linux 请安装系统 venv 组件后重试（如 Debian/Ubuntu: `sudo apt install python3-venv` 或 `sudo apt install python3.12-venv`）。'
  }

  private async ensurePipAvailable(paths: RuntimePaths): Promise<void> {
    const diagnostics: Record<string, unknown> = {}

    const firstCheck = await this.runCommand(paths.pythonPath, ['-m', 'pip', '--version'], {
      timeoutMs: DEFAULT_OPERATION_TIMEOUT_MS,
    })
    if ((firstCheck.exitCode ?? 1) === 0) return
    diagnostics.initialPipCheck = this.commandOutput(firstCheck)

    try {
      await this.createVenv(paths, { clear: true })
      diagnostics.recreateVenv = 'ok'
    } catch (error) {
      diagnostics.recreateVenv = error instanceof Error ? error.message : String(error)
    }

    const secondCheck = await this.runCommand(paths.pythonPath, ['-m', 'pip', '--version'], {
      timeoutMs: DEFAULT_OPERATION_TIMEOUT_MS,
    })
    if ((secondCheck.exitCode ?? 1) === 0) {
      logger.info('recovered managed runtime pip by recreating venv', {
        venvPath: paths.venvPath,
      })
      return
    }
    diagnostics.afterRecreatePipCheck = this.commandOutput(secondCheck)

    try {
      const ensurePipResult = await this.runCommand(paths.pythonPath, ['-m', 'ensurepip', '--upgrade'], {
        timeoutMs: DEFAULT_OPERATION_TIMEOUT_MS,
      })
      diagnostics.ensurePip = this.commandOutput(ensurePipResult)
    } catch (error) {
      diagnostics.ensurePip = error instanceof Error ? error.message : String(error)
    }

    const finalCheck = await this.runCommand(paths.pythonPath, ['-m', 'pip', '--version'], {
      timeoutMs: DEFAULT_OPERATION_TIMEOUT_MS,
    })
    if ((finalCheck.exitCode ?? 1) === 0) {
      logger.info('recovered managed runtime pip via ensurepip', {
        venvPath: paths.venvPath,
      })
      return
    }
    diagnostics.finalPipCheck = this.commandOutput(finalCheck)

    throw new PythonRuntimeServiceError(
      `受管环境 pip 不可用，自动修复失败。${this.buildPipUnavailableHint()}`,
      500,
      'PYTHON_RUNTIME_PIP_UNAVAILABLE',
      diagnostics,
    )
  }

  async ensureManagedRuntime(): Promise<RuntimePaths> {
    const paths = this.resolvePaths()
    await fs.mkdir(paths.runtimeRoot, { recursive: true })

    if (!(await this.fileExists(paths.pythonPath))) {
      await this.createVenv(paths)
    }
    await this.ensurePipAvailable(paths)

    return paths
  }

  async getManagedPythonPath(): Promise<string> {
    const paths = await this.ensureManagedRuntime()
    return paths.pythonPath
  }

  private buildPipIndexArgs(indexes: PythonRuntimeIndexes): string[] {
    const args: string[] = []
    if (indexes.indexUrl) {
      args.push('--index-url', indexes.indexUrl)
    }
    for (const extraIndex of indexes.extraIndexUrls) {
      args.push('--extra-index-url', extraIndex)
    }
    for (const host of indexes.trustedHosts) {
      args.push('--trusted-host', host)
    }
    return args
  }

  private parseRequirements(requirements: string[]): RequirementEntry[] {
    if (!Array.isArray(requirements) || requirements.length === 0) {
      throw new PythonRuntimeServiceError('至少提供一个依赖项', 400, 'PYTHON_RUNTIME_EMPTY_REQUIREMENTS')
    }

    const dedup = new Map<string, RequirementEntry>()
    for (const requirement of requirements) {
      const parsed = parseRequirement(requirement)
      if (!dedup.has(parsed.raw)) {
        dedup.set(parsed.raw, parsed)
      }
    }
    return Array.from(dedup.values())
  }

  async listInstalledPackages(): Promise<PythonRuntimeInstalledPackage[]> {
    const paths = await this.ensureManagedRuntime()
    const result = await this.runCommand(paths.pythonPath, ['-m', 'pip', 'list', '--format=json'], {
      timeoutMs: DEFAULT_PIP_TIMEOUT_MS,
    })

    if ((result.exitCode ?? 1) !== 0) {
      throw new PythonRuntimeServiceError(
        `读取已安装包失败：${result.stderr || 'unknown error'}`,
        500,
        'PYTHON_RUNTIME_LIST_PACKAGES_FAILED',
      )
    }

    try {
      const parsed = JSON.parse(result.stdout)
      if (!Array.isArray(parsed)) return []
      return parsed
        .map((item) => ({
          name: typeof item?.name === 'string' ? item.name : '',
          version: typeof item?.version === 'string' ? item.version : '',
        }))
        .filter((item) => item.name)
        .sort((a, b) => a.name.localeCompare(b.name))
    } catch {
      return []
    }
  }

  private async runPipCheck(paths: RuntimePaths): Promise<{ passed: boolean; output: string }> {
    const checkResult = await this.runCommand(paths.pythonPath, ['-m', 'pip', 'check'], {
      timeoutMs: DEFAULT_PIP_TIMEOUT_MS,
    })

    const output = `${checkResult.stdout}\n${checkResult.stderr}`.trim()
    return {
      passed: (checkResult.exitCode ?? 1) === 0,
      output,
    }
  }

  async collectActiveDependencies(): Promise<PythonRuntimeDependencyItem[]> {
    const skills = await (this.prisma as any).skill.findMany({
      where: { status: 'active' },
      include: {
        defaultVersion: {
          select: {
            id: true,
            version: true,
            status: true,
            manifestJson: true,
            createdAt: true,
            activatedAt: true,
          },
        },
        versions: {
          where: { status: 'active' },
          select: {
            id: true,
            version: true,
            status: true,
            manifestJson: true,
            createdAt: true,
            activatedAt: true,
          },
          orderBy: [{ activatedAt: 'desc' }, { createdAt: 'desc' }],
          take: 1,
        },
      },
    })

    const items: PythonRuntimeDependencyItem[] = []

    for (const skill of skills) {
      const version =
        skill.defaultVersion && skill.defaultVersion.status === 'active'
          ? skill.defaultVersion
          : Array.isArray(skill.versions) && skill.versions.length > 0
            ? skill.versions[0]
            : null
      if (!version) continue

      let manifest: Record<string, unknown> = {}
      try {
        manifest = version.manifestJson ? JSON.parse(version.manifestJson) : {}
      } catch {
        manifest = {}
      }

      const pythonPackages = Array.isArray(manifest.python_packages)
        ? manifest.python_packages
        : []

      for (const requirement of pythonPackages) {
        if (typeof requirement !== 'string') continue
        const parsed = parseRequirement(requirement)
        items.push({
          skillId: skill.id,
          skillSlug: skill.slug,
          skillDisplayName: skill.displayName,
          versionId: version.id,
          version: version.version,
          requirement: parsed.raw,
          packageName: parsed.packageName,
        })
      }
    }

    return items.sort((a, b) => {
      const skillCompare = a.skillSlug.localeCompare(b.skillSlug)
      if (skillCompare !== 0) return skillCompare
      return a.packageName.localeCompare(b.packageName)
    })
  }

  analyzeConflicts(dependencies: PythonRuntimeDependencyItem[]): PythonRuntimeConflictItem[] {
    const packageMap = new Map<string, PythonRuntimeDependencyItem[]>()
    for (const dependency of dependencies) {
      const list = packageMap.get(dependency.packageName) ?? []
      list.push(dependency)
      packageMap.set(dependency.packageName, list)
    }

    const conflicts: PythonRuntimeConflictItem[] = []
    for (const [packageName, list] of packageMap.entries()) {
      const requirementSet = Array.from(new Set(list.map((item) => item.requirement)))
      if (requirementSet.length <= 1) continue
      conflicts.push({
        packageName,
        requirements: requirementSet,
        skills: list.map((item) => ({
          skillId: item.skillId,
          skillSlug: item.skillSlug,
          versionId: item.versionId,
          version: item.version,
          requirement: item.requirement,
        })),
      })
    }

    return conflicts.sort((a, b) => a.packageName.localeCompare(b.packageName))
  }

  async getRuntimeStatus(): Promise<PythonRuntimeStatus> {
    const paths = this.resolvePaths()
    const [indexes, manualPackages, dependencies] = await Promise.all([
      this.getIndexes(),
      this.getManualPackages(),
      this.collectActiveDependencies(),
    ])

    const conflicts = this.analyzeConflicts(dependencies)
    try {
      await this.ensureManagedRuntime()
      const installedPackages = await this.listInstalledPackages()

      return {
        dataRoot: paths.dataRoot,
        runtimeRoot: paths.runtimeRoot,
        venvPath: paths.venvPath,
        pythonPath: paths.pythonPath,
        ready: true,
        indexes,
        manualPackages,
        installedPackages,
        activeDependencies: dependencies,
        conflicts,
      }
    } catch (error) {
      if (error instanceof PythonRuntimeServiceError && DEGRADED_RUNTIME_STATUS_CODES.has(error.code)) {
        logger.warn('python runtime status degraded', {
          code: error.code,
          message: error.message,
          details: error.details,
          pythonPath: paths.pythonPath,
        })
        return {
          dataRoot: paths.dataRoot,
          runtimeRoot: paths.runtimeRoot,
          venvPath: paths.venvPath,
          pythonPath: paths.pythonPath,
          ready: false,
          runtimeIssue: {
            code: error.code,
            message: error.message,
            details: error.details,
          },
          indexes,
          manualPackages,
          installedPackages: [],
          activeDependencies: dependencies,
          conflicts,
        }
      }
      throw error
    }
  }

  async installRequirements(input: {
    requirements: string[]
    source: PythonRuntimeInstallSource
    skillId?: number
    versionId?: number
  }): Promise<PythonRuntimeInstallResult> {
    const entries = this.parseRequirements(input.requirements)
    return this.enqueue(async () => {
      const paths = await this.ensureManagedRuntime()
      const indexes = await this.getIndexes()
      const args = [
        '-m',
        'pip',
        'install',
        '--disable-pip-version-check',
        '--no-input',
        ...this.buildPipIndexArgs(indexes),
        ...entries.map((item) => item.raw),
      ]

      const result = await this.runCommand(paths.pythonPath, args, {
        timeoutMs: DEFAULT_PIP_TIMEOUT_MS,
      })

      if ((result.exitCode ?? 1) !== 0) {
        throw new PythonRuntimeServiceError(
          `安装依赖失败：${result.stderr || result.stdout || 'unknown error'}`,
          400,
          'PYTHON_RUNTIME_INSTALL_FAILED',
          {
            requirements: entries.map((item) => item.raw),
            source: input.source,
            skillId: input.skillId,
            versionId: input.versionId,
          },
        )
      }

      const pipCheck = await this.runPipCheck(paths)
      if (!pipCheck.passed) {
        throw new PythonRuntimeServiceError(
          `pip check 失败：${pipCheck.output || 'unknown error'}`,
          400,
          'PYTHON_RUNTIME_PIP_CHECK_FAILED',
        )
      }

      if (input.source === 'manual') {
        await this.addManualPackages(entries.map((item) => item.packageName))
      }

      logger.info('installed python requirements', {
        source: input.source,
        requirements: entries.map((item) => item.raw),
        skillId: input.skillId,
        versionId: input.versionId,
        durationMs: result.durationMs,
      })

      const installedPackages = await this.listInstalledPackages()
      return {
        source: input.source,
        requirements: entries.map((item) => item.raw),
        pipCheckPassed: true,
        pipCheckOutput: pipCheck.output,
        installedPackages,
      }
    })
  }

  async uninstallPackages(packages: string[]): Promise<PythonRuntimeUninstallResult> {
    if (!Array.isArray(packages) || packages.length === 0) {
      throw new PythonRuntimeServiceError('至少提供一个包名', 400, 'PYTHON_RUNTIME_EMPTY_PACKAGES')
    }

    const normalized = Array.from(
      new Set(
        packages
          .map((pkg) => validatePackageName(pkg))
          .filter((pkg): pkg is string => Boolean(pkg)),
      ),
    )

    if (normalized.length === 0) {
      throw new PythonRuntimeServiceError('包名格式无效', 400, 'PYTHON_RUNTIME_INVALID_PACKAGE_NAME')
    }

    const dependencies = await this.collectActiveDependencies()
    const blocked = dependencies.filter((item) => normalized.includes(item.packageName))
    if (blocked.length > 0) {
      throw new PythonRuntimeServiceError(
        '存在激活 Skill 依赖，禁止卸载',
        409,
        'PYTHON_RUNTIME_PACKAGE_IN_USE',
        {
          blocked,
        },
      )
    }

    return this.enqueue(async () => {
      const paths = await this.ensureManagedRuntime()
      const result = await this.runCommand(
        paths.pythonPath,
        ['-m', 'pip', 'uninstall', '-y', ...normalized],
        {
          timeoutMs: DEFAULT_PIP_TIMEOUT_MS,
        },
      )

      if ((result.exitCode ?? 1) !== 0) {
        throw new PythonRuntimeServiceError(
          `卸载失败：${result.stderr || result.stdout || 'unknown error'}`,
          400,
          'PYTHON_RUNTIME_UNINSTALL_FAILED',
          { packages: normalized },
        )
      }

      const pipCheck = await this.runPipCheck(paths)
      if (!pipCheck.passed) {
        throw new PythonRuntimeServiceError(
          `pip check 失败：${pipCheck.output || 'unknown error'}`,
          400,
          'PYTHON_RUNTIME_PIP_CHECK_FAILED',
        )
      }

      await this.removeManualPackages(normalized)

      logger.info('uninstalled python packages', {
        packages: normalized,
        durationMs: result.durationMs,
      })

      const installedPackages = await this.listInstalledPackages()
      return {
        packages: normalized,
        pipCheckPassed: true,
        pipCheckOutput: pipCheck.output,
        installedPackages,
      }
    })
  }

  async reconcile(): Promise<PythonRuntimeReconcileResult> {
    const dependencies = await this.collectActiveDependencies()
    const conflicts = this.analyzeConflicts(dependencies)
    const requirements = Array.from(new Set(dependencies.map((item) => item.requirement)))

    return this.enqueue(async () => {
      const paths = await this.ensureManagedRuntime()
      if (requirements.length > 0) {
        const indexes = await this.getIndexes()
        const installResult = await this.runCommand(
          paths.pythonPath,
          [
            '-m',
            'pip',
            'install',
            '--disable-pip-version-check',
            '--no-input',
            ...this.buildPipIndexArgs(indexes),
            ...requirements,
          ],
          {
            timeoutMs: DEFAULT_PIP_TIMEOUT_MS,
          },
        )

        if ((installResult.exitCode ?? 1) !== 0) {
          throw new PythonRuntimeServiceError(
            `reconcile 安装失败：${installResult.stderr || installResult.stdout || 'unknown error'}`,
            400,
            'PYTHON_RUNTIME_RECONCILE_INSTALL_FAILED',
            { requirements },
          )
        }
      }

      const pipCheck = await this.runPipCheck(paths)
      if (!pipCheck.passed) {
        throw new PythonRuntimeServiceError(
          `pip check 失败：${pipCheck.output || 'unknown error'}`,
          400,
          'PYTHON_RUNTIME_PIP_CHECK_FAILED',
        )
      }

      logger.info('reconciled python runtime', {
        requirements,
        conflicts: conflicts.length,
      })

      const installedPackages = await this.listInstalledPackages()
      return {
        requirements,
        pipCheckPassed: true,
        pipCheckOutput: pipCheck.output,
        installedPackages,
        conflicts,
      }
    })
  }
}
