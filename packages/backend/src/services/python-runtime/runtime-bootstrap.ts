import fs from 'node:fs/promises'
import type { CommandResult } from './pip-command-gateway'
import type { RuntimePaths } from './platform-adapter'

type RuntimeBootstrapErrorFactory = (
  message: string,
  statusCode: number,
  code: string,
  details?: Record<string, unknown>,
) => Error

export class PythonRuntimeBootstrap {
  constructor(
    private readonly deps: {
      env: NodeJS.ProcessEnv
      platform: NodeJS.Platform
      operationTimeoutMs: number
      runCommand: (
        command: string,
        args: string[],
        options?: { cwd?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv },
      ) => Promise<CommandResult>
      createError: RuntimeBootstrapErrorFactory
      onInfo?: (message: string, payload?: Record<string, unknown>) => void
    },
  ) {}

  private async fileExists(targetPath: string): Promise<boolean> {
    try {
      await fs.access(targetPath)
      return true
    } catch {
      return false
    }
  }

  private commandOutput(result: CommandResult): string {
    const output = `${result.stderr}\n${result.stdout}`.trim()
    if (output) return output
    return `exit code ${result.exitCode ?? 'null'}`
  }

  private buildPipUnavailableHint(): string {
    if (this.deps.platform === 'win32') {
      return 'Windows 请确认 Python 安装时已包含 pip/venv，必要时执行 `py -m ensurepip --upgrade`。'
    }
    return 'WSL/Linux 请安装系统 venv 组件后重试（如 Debian/Ubuntu: `sudo apt install python3-venv` 或 `sudo apt install python3.12-venv`）。'
  }

  private async createVenv(paths: RuntimePaths, options?: { clear?: boolean }): Promise<void> {
    const bootstrapCandidates =
      this.deps.platform === 'win32'
        ? [this.deps.env.PYTHON_BOOTSTRAP_COMMAND || 'python', 'py']
        : [this.deps.env.PYTHON_BOOTSTRAP_COMMAND || 'python3', 'python']
    const args = ['-m', 'venv', ...(options?.clear ? ['--clear'] : []), paths.venvPath]

    let lastError: unknown = null
    for (const candidate of bootstrapCandidates) {
      const command = (candidate || '').trim()
      if (!command) continue
      try {
        const result = await this.deps.runCommand(command, args, {
          timeoutMs: this.deps.operationTimeoutMs,
        })
        if ((result.exitCode ?? 1) !== 0) {
          lastError = new Error(result.stderr || `exit code ${result.exitCode}`)
          continue
        }
        this.deps.onInfo?.('created managed venv', {
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
    throw this.deps.createError(
      `无法创建 Python 虚拟环境：${message}`,
      500,
      'PYTHON_RUNTIME_CREATE_VENV_FAILED',
      { venvPath: paths.venvPath, clear: Boolean(options?.clear) },
    )
  }

  private async ensurePipAvailable(paths: RuntimePaths): Promise<void> {
    const diagnostics: Record<string, unknown> = {}

    const firstCheck = await this.deps.runCommand(paths.pythonPath, ['-m', 'pip', '--version'], {
      timeoutMs: this.deps.operationTimeoutMs,
    })
    if ((firstCheck.exitCode ?? 1) === 0) return
    diagnostics.initialPipCheck = this.commandOutput(firstCheck)

    try {
      await this.createVenv(paths, { clear: true })
      diagnostics.recreateVenv = 'ok'
    } catch (error) {
      diagnostics.recreateVenv = error instanceof Error ? error.message : String(error)
    }

    const secondCheck = await this.deps.runCommand(paths.pythonPath, ['-m', 'pip', '--version'], {
      timeoutMs: this.deps.operationTimeoutMs,
    })
    if ((secondCheck.exitCode ?? 1) === 0) {
      this.deps.onInfo?.('recovered managed runtime pip by recreating venv', {
        venvPath: paths.venvPath,
      })
      return
    }
    diagnostics.afterRecreatePipCheck = this.commandOutput(secondCheck)

    try {
      const ensurePipResult = await this.deps.runCommand(paths.pythonPath, ['-m', 'ensurepip', '--upgrade'], {
        timeoutMs: this.deps.operationTimeoutMs,
      })
      diagnostics.ensurePip = this.commandOutput(ensurePipResult)
    } catch (error) {
      diagnostics.ensurePip = error instanceof Error ? error.message : String(error)
    }

    const finalCheck = await this.deps.runCommand(paths.pythonPath, ['-m', 'pip', '--version'], {
      timeoutMs: this.deps.operationTimeoutMs,
    })
    if ((finalCheck.exitCode ?? 1) === 0) {
      this.deps.onInfo?.('recovered managed runtime pip via ensurepip', {
        venvPath: paths.venvPath,
      })
      return
    }
    diagnostics.finalPipCheck = this.commandOutput(finalCheck)

    throw this.deps.createError(
      `受管环境 pip 不可用，自动修复失败。${this.buildPipUnavailableHint()}`,
      500,
      'PYTHON_RUNTIME_PIP_UNAVAILABLE',
      diagnostics,
    )
  }

  async ensureManagedRuntime(paths: RuntimePaths): Promise<RuntimePaths> {
    await fs.mkdir(paths.runtimeRoot, { recursive: true })

    if (!(await this.fileExists(paths.pythonPath))) {
      await this.createVenv(paths)
    }
    await this.ensurePipAvailable(paths)

    return paths
  }
}
