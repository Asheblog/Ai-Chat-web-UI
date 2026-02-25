import { spawn } from 'node:child_process'
import path from 'node:path'
import { getAppConfig, type WorkspaceConfig } from '../../config/app-config'
import { WorkspaceServiceError } from './workspace-errors'

const DOCKER_CHECK_CACHE_MS = 30_000

const buildOutputCollector = (limit: number) => {
  const chunks: Buffer[] = []
  let size = 0
  let truncated = false
  return {
    push(chunk: Buffer) {
      if (truncated) return
      const nextSize = size + chunk.length
      if (nextSize <= limit) {
        chunks.push(chunk)
        size = nextSize
        return
      }
      const remaining = Math.max(0, limit - size)
      if (remaining > 0) {
        chunks.push(chunk.subarray(0, remaining))
      }
      size = limit
      truncated = true
    },
    toString() {
      return Buffer.concat(chunks).toString('utf8')
    },
    isTruncated() {
      return truncated
    },
  }
}

export interface DockerRunOptions {
  workspaceRoot: string
  command: string[]
  stdin?: string
  timeoutMs: number
  maxOutputChars: number
  networkMode: 'none' | 'default'
  env?: Record<string, string>
}

export interface DockerRunResult {
  stdout: string
  stderr: string
  exitCode: number | null
  durationMs: number
  truncated: boolean
  timeout: boolean
}

export interface DockerExecutorDeps {
  workspaceConfig?: WorkspaceConfig
}

export class DockerExecutor {
  private readonly config: WorkspaceConfig
  private dockerAvailableCache: { at: number; ok: boolean } | null = null

  constructor(deps: DockerExecutorDeps = {}) {
    this.config = deps.workspaceConfig ?? getAppConfig().workspace
  }

  async assertDockerAvailable(): Promise<void> {
    const now = Date.now()
    if (
      this.dockerAvailableCache &&
      this.dockerAvailableCache.ok &&
      now - this.dockerAvailableCache.at < DOCKER_CHECK_CACHE_MS
    ) {
      return
    }

    const result = await this.execDocker(['version', '--format', '{{.Server.Version}}'], {
      timeoutMs: 10_000,
      maxOutputChars: 2048,
    })

    if (result.exitCode !== 0) {
      this.dockerAvailableCache = { at: now, ok: false }
      throw new WorkspaceServiceError(
        'Docker 不可用，workspace 执行已禁用',
        503,
        'WORKSPACE_DOCKER_UNAVAILABLE',
        {
          stderr: result.stderr.trim(),
          exitCode: result.exitCode,
        },
      )
    }

    this.dockerAvailableCache = { at: now, ok: true }
  }

  async run(options: DockerRunOptions): Promise<DockerRunResult> {
    await this.assertDockerAvailable()

    const workspaceRoot = path.resolve(options.workspaceRoot)
    const maxOutputChars = Math.max(256, options.maxOutputChars)
    const args: string[] = [
      'run',
      '--rm',
      '--workdir',
      '/workspace',
      '--cpus',
      this.config.dockerCpu,
      '--memory',
      this.config.dockerMemory,
      '--pids-limit',
      String(this.config.dockerPidsLimit),
      '--cap-drop=ALL',
      '--security-opt',
      'no-new-privileges',
      '--read-only',
      '--tmpfs',
      '/tmp:rw,noexec,nosuid,size=268435456',
      '--volume',
      `${workspaceRoot}:/workspace`,
    ]

    if (options.networkMode === 'none') {
      args.push('--network', 'none')
    }

    const envEntries = Object.entries(options.env || {})
      .filter(([key, value]) => key.trim().length > 0 && value.trim().length > 0)
      .slice(0, 32)
    for (const [key, value] of envEntries) {
      args.push('-e', `${key}=${value}`)
    }

    args.push(this.config.dockerImage, ...options.command)

    const result = await this.execDocker(args, {
      stdin: options.stdin,
      timeoutMs: options.timeoutMs,
      maxOutputChars,
    })

    if (result.timeout) {
      throw new WorkspaceServiceError(
        `workspace 执行超时（${options.timeoutMs}ms）`,
        408,
        'WORKSPACE_EXEC_TIMEOUT',
      )
    }

    return result
  }

  private async execDocker(
    args: string[],
    options: {
      stdin?: string
      timeoutMs: number
      maxOutputChars: number
    },
  ): Promise<DockerRunResult> {
    const startedAt = Date.now()
    const stdoutCollector = buildOutputCollector(options.maxOutputChars)
    const stderrCollector = buildOutputCollector(options.maxOutputChars)

    return new Promise<DockerRunResult>((resolve, reject) => {
      let finished = false
      let timedOut = false

      const child = spawn('docker', args, {
        stdio: 'pipe',
        windowsHide: true,
      })

      const finish = (result: DockerRunResult) => {
        if (finished) return
        finished = true
        resolve(result)
      }

      const fail = (error: Error) => {
        if (finished) return
        finished = true
        reject(error)
      }

      const timer =
        options.timeoutMs > 0
          ? setTimeout(() => {
              timedOut = true
              try {
                child.kill('SIGKILL')
              } catch {
                // ignore
              }
            }, options.timeoutMs)
          : null

      child.on('error', (error: any) => {
        if (timer) clearTimeout(timer)
        if (error?.code === 'ENOENT') {
          fail(
            new WorkspaceServiceError(
              'Docker 不可用，workspace 执行已禁用',
              503,
              'WORKSPACE_DOCKER_UNAVAILABLE',
            ),
          )
          return
        }
        fail(error instanceof Error ? error : new Error(String(error)))
      })

      child.stdout.on('data', (chunk: Buffer) => {
        stdoutCollector.push(chunk)
      })
      child.stderr.on('data', (chunk: Buffer) => {
        stderrCollector.push(chunk)
      })

      child.on('close', (code) => {
        if (timer) clearTimeout(timer)
        finish({
          stdout: stdoutCollector.toString(),
          stderr: stderrCollector.toString(),
          exitCode: typeof code === 'number' ? code : null,
          durationMs: Math.max(0, Date.now() - startedAt),
          truncated: stdoutCollector.isTruncated() || stderrCollector.isTruncated(),
          timeout: timedOut,
        })
      })

      if (typeof options.stdin === 'string' && options.stdin.length > 0) {
        child.stdin.write(options.stdin)
      }
      child.stdin.end()
    })
  }
}

let dockerExecutor = new DockerExecutor()

export const setDockerExecutor = (executor: DockerExecutor) => {
  dockerExecutor = executor
}

export { dockerExecutor }
