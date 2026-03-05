import { spawn } from 'node:child_process'
import type { CommandResult } from './pip-command-gateway'

export interface RuntimeCommandErrorFactory {
  (
    message: string,
    statusCode: number,
    code: string,
    details?: Record<string, unknown>,
  ): Error
}

export class PythonRuntimeCommandExecutor {
  constructor(
    private readonly deps: {
      defaultTimeoutMs: number
      outputLimit: number
      createError: RuntimeCommandErrorFactory
    },
  ) {}

  async run(
    command: string,
    args: string[],
    options?: { cwd?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv },
  ): Promise<CommandResult> {
    const timeoutMs = Math.max(1_000, options?.timeoutMs ?? this.deps.defaultTimeoutMs)
    const startedAt = Date.now()

    return new Promise<CommandResult>((resolve, reject) => {
      const child = spawn(command, args, {
        cwd: options?.cwd,
        env: options?.env,
        stdio: 'pipe',
      })

      const stdoutChunks: Buffer[] = []
      const stderrChunks: Buffer[] = []
      let stdoutLength = 0
      let stderrLength = 0

      const collect = (chunks: Buffer[], chunk: Buffer, currentLength: number): number => {
        const nextLength = currentLength + chunk.length
        if (nextLength <= this.deps.outputLimit) {
          chunks.push(chunk)
          return nextLength
        }
        const remain = this.deps.outputLimit - currentLength
        if (remain > 0) {
          chunks.push(chunk.subarray(0, remain))
        }
        return this.deps.outputLimit
      }

      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        reject(
          this.deps.createError(
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
          this.deps.createError(
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
}
