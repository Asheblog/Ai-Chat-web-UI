import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { PrismaClient } from '@prisma/client'
import { prisma as defaultPrisma } from '../../db'
import { getAppConfig, type WorkspaceConfig } from '../../config/app-config'
import {
  ArtifactService,
  artifactService as defaultArtifactService,
  type ArtifactDescriptor,
} from './artifact-service'
import { DockerExecutor, dockerExecutor as defaultDockerExecutor } from './docker-executor'
import { WorkspaceService, workspaceService as defaultWorkspaceService } from './workspace-service'
import { WorkspaceServiceError } from './workspace-errors'

const MISSING_MODULE_PACKAGE_MAP: Record<string, string> = {
  cv2: 'opencv-python',
  pil: 'Pillow',
  yaml: 'PyYAML',
  bs4: 'beautifulsoup4',
  sklearn: 'scikit-learn',
  crypto: 'pycryptodome',
  dateutil: 'python-dateutil',
  dotenv: 'python-dotenv',
  docx: 'python-docx',
  pptx: 'python-pptx',
  openpyxl: 'openpyxl',
  xlrd: 'xlrd',
  xlsxwriter: 'XlsxWriter',
  reportlab: 'reportlab',
  matplotlib: 'matplotlib',
  numpy: 'numpy',
  pandas: 'pandas',
  scipy: 'scipy',
  seaborn: 'seaborn',
  pypdf2: 'PyPDF2',
  fitz: 'PyMuPDF',
  lxml: 'lxml',
}

const MAX_AUTO_INSTALL_ROUNDS = 3
const PREVIEW_LIMIT = 4000

const normalizeCode = (raw: string) => raw.replace(/\r\n/g, '\n')

const truncateText = (value: string, limit: number) => {
  if (!value) return ''
  if (value.length <= limit) return value
  return `${value.slice(0, limit)}...`
}

const toContainerPath = (relativePath: string) =>
  `/workspace/${relativePath.split(path.sep).join('/')}`

const packageNameFromMissingModule = (moduleName: string) => {
  const normalized = (moduleName || '').trim().toLowerCase()
  if (!normalized) return null
  // Only accept canonical python module tokens; reject URL/path-like strings.
  if (!/^[A-Za-z0-9_.-]+$/.test(normalized)) {
    return null
  }
  const base = normalized.split('.')[0]
  const mapped = MISSING_MODULE_PACKAGE_MAP[base] || base
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(mapped)) {
    return null
  }
  return mapped
}

export const extractMissingModuleRequirements = (output: string): string[] => {
  const regex = /No module named ['"]?([^'"\r\n]+)['"]?/gi
  const found = new Set<string>()
  let match: RegExpExecArray | null
  while ((match = regex.exec(output)) !== null) {
    const moduleName = (match[1] || '').trim()
    if (!moduleName) continue
    const requirement = packageNameFromMissingModule(moduleName)
    if (!requirement) continue
    found.add(requirement)
  }
  return Array.from(found)
}

const classifyRunErrorStatus = (error: unknown): 'error' | 'timeout' | 'cancelled' => {
  if (error instanceof WorkspaceServiceError) {
    if (error.code === 'WORKSPACE_EXEC_TIMEOUT') return 'timeout'
    if (error.code === 'WORKSPACE_EXEC_CANCELLED') return 'cancelled'
  }
  return 'error'
}

export interface WorkspacePythonRuntimeDeps {
  prisma?: PrismaClient
  config?: WorkspaceConfig
  workspaceService?: WorkspaceService
  dockerExecutor?: DockerExecutor
  artifactService?: ArtifactService
}

export interface WorkspacePythonRunParams {
  sessionId: number
  messageId: number | null
  toolCallId: string
  code: string
  input?: string
  timeoutMs: number
  maxOutputChars: number
  maxSourceChars: number
}

export interface WorkspacePythonRunResult {
  stdout: string
  stderr: string
  exitCode: number | null
  durationMs: number
  truncated: boolean
  autoInstalledRequirements?: string[]
  artifacts: ArtifactDescriptor[]
}

export class WorkspacePythonRuntime {
  private readonly prisma: PrismaClient
  private readonly config: WorkspaceConfig
  private readonly workspaceService: WorkspaceService
  private readonly dockerExecutor: DockerExecutor
  private readonly artifactService: ArtifactService

  constructor(deps: WorkspacePythonRuntimeDeps = {}) {
    this.prisma = deps.prisma ?? defaultPrisma
    this.config = deps.config ?? getAppConfig().workspace
    this.workspaceService = deps.workspaceService ?? defaultWorkspaceService
    this.dockerExecutor = deps.dockerExecutor ?? defaultDockerExecutor
    this.artifactService = deps.artifactService ?? defaultArtifactService
  }

  async runPythonSnippet(params: WorkspacePythonRunParams): Promise<WorkspacePythonRunResult> {
    const normalizedCode = normalizeCode(params.code || '')
    if (!normalizedCode.trim()) {
      throw new WorkspaceServiceError('Python code 不能为空', 400, 'WORKSPACE_PYTHON_CODE_EMPTY')
    }
    if (normalizedCode.length > params.maxSourceChars) {
      throw new WorkspaceServiceError(
        `Python 代码超出限制（最大 ${params.maxSourceChars} 字符）`,
        400,
        'WORKSPACE_PYTHON_CODE_TOO_LARGE',
      )
    }

    const workspace = await this.workspaceService.ensureWorkspace(params.sessionId)
    const beforeArtifacts = await ArtifactService.snapshotArtifactTree(workspace.artifactsPath)
    const workspaceUsageBytes = await this.workspaceService.computeWorkspaceSizeBytes(workspace.rootPath)
    if (workspaceUsageBytes > this.config.maxWorkspaceBytes) {
      throw new WorkspaceServiceError(
        'workspace 空间已超过上限，请清理后重试',
        413,
        'WORKSPACE_QUOTA_EXCEEDED',
      )
    }

    const runRecord = await this.prisma.workspaceRun.create({
      data: {
        workspaceSessionId: workspace.record.id,
        messageId: params.messageId,
        toolCallId: params.toolCallId,
        toolName: 'python_runner',
        status: 'running',
      },
    })

    const runStartedAt = Date.now()
    try {
      await this.ensureVirtualEnvironment(workspace.rootPath)
      const scriptRelativePath = path.join('.meta', 'runs', `${params.toolCallId || randomUUID()}.py`)
      const scriptAbsolutePath = path.resolve(workspace.rootPath, scriptRelativePath)
      await fs.mkdir(path.dirname(scriptAbsolutePath), { recursive: true })
      await fs.writeFile(scriptAbsolutePath, normalizedCode, 'utf8')

      const executeResult = await this.executeWithAutoInstall({
        workspaceRoot: workspace.rootPath,
        scriptRelativePath,
        input: params.input,
        timeoutMs: Math.max(1000, Math.min(params.timeoutMs, this.config.runTimeoutMs)),
        maxOutputChars: params.maxOutputChars,
      })

      const afterArtifacts = await ArtifactService.snapshotArtifactTree(workspace.artifactsPath)
      const changedRelativePaths = ArtifactService.diffArtifactSnapshot(beforeArtifacts, afterArtifacts)
      const changedFiles = changedRelativePaths.map((relativePath) => ({
        relativePath,
        absolutePath: path.resolve(workspace.rootPath, relativePath),
      }))

      const artifacts = await this.artifactService.publishDiscoveredFiles({
        workspaceSessionId: workspace.record.id,
        sessionId: params.sessionId,
        workspaceRoot: workspace.rootPath,
        messageId: params.messageId,
        files: changedFiles,
      })

      await this.workspaceService.touchWorkspace(params.sessionId)

      const durationMs = Math.max(0, Date.now() - runStartedAt)
      await this.prisma.workspaceRun.update({
        where: { id: runRecord.id },
        data: {
          status: (executeResult.exitCode ?? 1) === 0 ? 'success' : 'error',
          exitCode: executeResult.exitCode,
          stdoutPreview: truncateText(executeResult.stdout, PREVIEW_LIMIT),
          stderrPreview: truncateText(executeResult.stderr, PREVIEW_LIMIT),
          durationMs,
        },
      })

      const finalUsageBytes = await this.workspaceService.computeWorkspaceSizeBytes(workspace.rootPath)
      if (finalUsageBytes > this.config.maxWorkspaceBytes) {
        throw new WorkspaceServiceError(
          'workspace 空间已超过上限，请清理后重试',
          413,
          'WORKSPACE_QUOTA_EXCEEDED',
        )
      }

      return {
        stdout: executeResult.stdout,
        stderr: executeResult.stderr,
        exitCode: executeResult.exitCode,
        durationMs,
        truncated: executeResult.truncated,
        autoInstalledRequirements:
          executeResult.autoInstalledRequirements.length > 0
            ? executeResult.autoInstalledRequirements
            : undefined,
        artifacts,
      }
    } catch (error) {
      const durationMs = Math.max(0, Date.now() - runStartedAt)
      const status = classifyRunErrorStatus(error)
      await this.prisma.workspaceRun.update({
        where: { id: runRecord.id },
        data: {
          status,
          stdoutPreview: '',
          stderrPreview: truncateText(error instanceof Error ? error.message : String(error), PREVIEW_LIMIT),
          durationMs,
        },
      })
      throw error
    }
  }

  private async ensureVirtualEnvironment(workspaceRoot: string): Promise<void> {
    const venvPythonPath = path.resolve(workspaceRoot, '.venv', 'bin', 'python')
    const exists = await fs
      .access(venvPythonPath)
      .then(() => true)
      .catch(() => false)
    if (exists) return

    const createResult = await this.dockerExecutor.run({
      workspaceRoot,
      command: ['python', '-m', 'venv', '/workspace/.venv'],
      timeoutMs: Math.max(10_000, this.config.runTimeoutMs),
      maxOutputChars: 10_000,
      networkMode: 'none',
    })

    if ((createResult.exitCode ?? 1) !== 0) {
      throw new WorkspaceServiceError(
        `初始化 Python 虚拟环境失败：${createResult.stderr || createResult.stdout || 'unknown error'}`,
        500,
        'WORKSPACE_PYTHON_VENV_INIT_FAILED',
      )
    }
  }

  private async executeWithAutoInstall(params: {
    workspaceRoot: string
    scriptRelativePath: string
    input?: string
    timeoutMs: number
    maxOutputChars: number
  }): Promise<{
    stdout: string
    stderr: string
    exitCode: number | null
    truncated: boolean
    autoInstalledRequirements: string[]
  }> {
    const autoInstalledRequirements: string[] = []
    const installedSet = new Set<string>()
    let attempt = 0
    let lastResult:
      | {
          stdout: string
          stderr: string
          exitCode: number | null
          truncated: boolean
        }
      | null = null

    while (attempt <= MAX_AUTO_INSTALL_ROUNDS) {
      const runResult = await this.dockerExecutor.run({
        workspaceRoot: params.workspaceRoot,
        command: [
          '/workspace/.venv/bin/python',
          toContainerPath(params.scriptRelativePath),
        ],
        stdin: params.input,
        timeoutMs: params.timeoutMs,
        maxOutputChars: params.maxOutputChars,
        networkMode: 'none',
        env: {
          PYTHONUNBUFFERED: '1',
        },
      })

      lastResult = {
        stdout: runResult.stdout,
        stderr: runResult.stderr,
        exitCode: runResult.exitCode,
        truncated: runResult.truncated,
      }

      if ((runResult.exitCode ?? 1) === 0) {
        break
      }

      if (attempt >= MAX_AUTO_INSTALL_ROUNDS) {
        break
      }

      const missing = extractMissingModuleRequirements(`${runResult.stderr}\n${runResult.stdout}`)
        .filter((name) => !installedSet.has(name))
      if (missing.length === 0) {
        break
      }

      await this.installRequirements(params.workspaceRoot, missing)
      for (const requirement of missing) {
        installedSet.add(requirement)
        autoInstalledRequirements.push(requirement)
      }

      attempt += 1
    }

    if (!lastResult) {
      throw new WorkspaceServiceError('Python 执行失败', 500, 'WORKSPACE_PYTHON_RUN_FAILED')
    }

    return {
      ...lastResult,
      autoInstalledRequirements,
    }
  }

  private async installRequirements(workspaceRoot: string, requirements: string[]) {
    const safeRequirements = requirements
      .map((item) => (item || '').trim())
      .filter((item) => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(item))
      .slice(0, 16)
    if (safeRequirements.length === 0) {
      return
    }

    const installResult = await this.dockerExecutor.run({
      workspaceRoot,
      command: [
        '/workspace/.venv/bin/python',
        '-m',
        'pip',
        'install',
        '--disable-pip-version-check',
        '--no-input',
        ...safeRequirements,
      ],
      timeoutMs: this.config.pythonInstallTimeoutMs,
      maxOutputChars: 20_000,
      networkMode: 'default',
    })

    if ((installResult.exitCode ?? 1) !== 0) {
      throw new WorkspaceServiceError(
        `自动安装依赖失败：${installResult.stderr || installResult.stdout || 'unknown error'}`,
        500,
        'WORKSPACE_PYTHON_DEP_INSTALL_FAILED',
      )
    }
  }
}

let workspacePythonRuntime = new WorkspacePythonRuntime()

export const setWorkspacePythonRuntime = (runtime: WorkspacePythonRuntime) => {
  workspacePythonRuntime = runtime
}

export { workspacePythonRuntime }
