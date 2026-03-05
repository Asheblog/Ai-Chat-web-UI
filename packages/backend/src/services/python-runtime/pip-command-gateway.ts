import type { RuntimePaths } from './platform-adapter'

export interface CommandResult {
  stdout: string
  stderr: string
  exitCode: number | null
  durationMs: number
}

export interface PythonRuntimeInstalledPackage {
  name: string
  version: string
}

export class PipCommandGateway {
  constructor(
    private readonly runCommand: (
      cmd: string,
      args: string[],
      options?: { cwd?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv },
    ) => Promise<CommandResult>,
  ) {}

  async runCheck(paths: RuntimePaths, timeoutMs: number): Promise<{ passed: boolean; output: string }> {
    const checkResult = await this.runCommand(paths.pythonPath, ['-m', 'pip', 'check'], {
      timeoutMs,
    })

    const output = `${checkResult.stdout}\n${checkResult.stderr}`.trim()
    return {
      passed: (checkResult.exitCode ?? 1) === 0,
      output,
    }
  }

  async listInstalledPackages(paths: RuntimePaths, timeoutMs: number): Promise<PythonRuntimeInstalledPackage[]> {
    const result = await this.runCommand(paths.pythonPath, ['-m', 'pip', 'list', '--format=json'], {
      timeoutMs,
    })

    if ((result.exitCode ?? 1) !== 0) {
      throw new Error(result.stderr || 'pip list failed')
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
}
