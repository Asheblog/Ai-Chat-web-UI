import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import { getAppConfig, type WorkspaceConfig } from '../../config/app-config'
import { WorkspaceServiceError } from './workspace-errors'
import { createLogger } from '../../utils/logger'

const DOCKER_CHECK_CACHE_MS = 30_000
const DOCKER_MOUNT_CACHE_MS = 30_000
export const WORKSPACE_CONTAINER_NAME_PREFIX = 'aichat-ws-'

const resolveSeccompProfilePath = () => {
  const candidates = [
    path.resolve(process.cwd(), 'dist', 'py-sandbox-seccomp.json'),
    path.resolve(process.cwd(), 'src', 'services', 'workspace', 'py-sandbox-seccomp.json'),
    path.resolve(process.cwd(), 'packages', 'backend', 'dist', 'py-sandbox-seccomp.json'),
    path.resolve(process.cwd(), 'packages', 'backend', 'src', 'services', 'workspace', 'py-sandbox-seccomp.json'),
  ]
  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0]
}
const SECCOMP_PROFILE_PATH = resolveSeccompProfilePath()
const SECCOMP_AVAILABLE = fs.existsSync(SECCOMP_PROFILE_PATH)
const log = createLogger('WorkspaceDocker')
const runtimeContainerUser = resolveRuntimeContainerUser()

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
  workdir?: string
  readOnlyMounts?: Array<{ source: string; target: string }>
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
  spawnFn?: typeof spawn
}

type QueueWaiter = {
  resolve: (release: () => void) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout | null
}

export class DockerExecutor {
  private readonly config: WorkspaceConfig
  private readonly spawnFn: typeof spawn
  private dockerAvailableCache: { at: number; ok: boolean } | null = null
  private mountCache: { at: number; mounts: DockerMountPoint[] } | null = null
  private activeRuns = 0
  private readonly runQueue: QueueWaiter[] = []

  constructor(deps: DockerExecutorDeps = {}) {
    this.config = deps.workspaceConfig ?? getAppConfig().workspace
    this.spawnFn = deps.spawnFn ?? spawn
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

  async cleanupOrphanContainers(): Promise<number> {
    const listResult = await this.execDocker(
      ['ps', '-aq', '--filter', `name=^/${WORKSPACE_CONTAINER_NAME_PREFIX}`],
      {
        timeoutMs: 10_000,
        maxOutputChars: 64_000,
      },
    )
    if (listResult.exitCode !== 0) {
      log.warn('Failed to list orphan workspace containers', {
        stderr: listResult.stderr.trim(),
        exitCode: listResult.exitCode,
      })
      return 0
    }

    const ids = listResult.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
    if (ids.length === 0) return 0

    let cleaned = 0
    for (const id of ids) {
      const removed = await this.forceRemoveContainer(id)
      if (removed) cleaned += 1
    }
    if (cleaned > 0) {
      log.info('Cleaned orphan workspace containers on startup', { cleaned, total: ids.length })
    }
    return cleaned
  }

  async run(options: DockerRunOptions): Promise<DockerRunResult> {
    await this.assertDockerAvailable()
    const release = await this.acquireRunSlot()

    try {
      const workspaceRoot = path.resolve(options.workspaceRoot)
      const dockerWorkspaceRoot = await this.resolveDockerWorkspaceRoot(workspaceRoot)
      const maxOutputChars = Math.max(256, options.maxOutputChars)
      const workdir = options.workdir || '/workspace'
      const containerName = `${WORKSPACE_CONTAINER_NAME_PREFIX}${randomUUID()}`
      const args: string[] = [
        'run',
        '--rm',
        '--name',
        containerName,
        '--workdir',
        workdir,
        '--cpus',
        this.config.dockerCpu,
        '--memory',
        this.config.dockerMemory,
        '--memory-swap',
        this.config.dockerMemory,
        '--pids-limit',
        String(this.config.dockerPidsLimit),
        '--ulimit',
        'nofile=1024:1024',
        '--cap-drop=ALL',
        '--security-opt',
        'no-new-privileges',
        '--read-only',
        '--tmpfs',
        '/tmp:rw,noexec,nosuid,size=268435456',
      ]

      if (SECCOMP_AVAILABLE) {
        args.push('--security-opt', `seccomp=${SECCOMP_PROFILE_PATH}`)
      }

      // Keep file ownership/permissions consistent with the backend process user.
      // This avoids venv init/write failures under userns-remap and rootless daemon setups.
      if (runtimeContainerUser) {
        args.push('--user', runtimeContainerUser)
      }

      for (const mount of options.readOnlyMounts || []) {
        const source = await this.resolveDockerWorkspaceRoot(mount.source)
        args.push('--volume', `${source}:${mount.target}:ro`)
      }

      args.push('--volume', `${dockerWorkspaceRoot}:/workspace`)

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
        containerName,
      })

      if (result.timeout) {
        throw new WorkspaceServiceError(
          `workspace 执行超时（${options.timeoutMs}ms）`,
          408,
          'WORKSPACE_EXEC_TIMEOUT',
        )
      }

      return result
    } finally {
      release()
    }
  }

  private acquireRunSlot(): Promise<() => void> {
    const maxConcurrent = Math.max(1, this.config.maxConcurrentRuns)
    if (this.activeRuns < maxConcurrent) {
      this.activeRuns += 1
      return Promise.resolve(() => this.releaseRunSlot())
    }

    return new Promise<() => void>((resolve, reject) => {
      const waiter: QueueWaiter = {
        resolve: (release) => resolve(release),
        reject,
        timer: null,
      }
      waiter.timer = setTimeout(() => {
        const index = this.runQueue.indexOf(waiter)
        if (index >= 0) {
          this.runQueue.splice(index, 1)
        }
        reject(
          new WorkspaceServiceError(
            '工作区繁忙，请稍后重试',
            503,
            'WORKSPACE_RUN_QUEUE_TIMEOUT',
            {
              maxConcurrentRuns: this.config.maxConcurrentRuns,
              queueTimeoutMs: this.config.runQueueTimeoutMs,
            },
          ),
        )
      }, Math.max(1, this.config.runQueueTimeoutMs))
      this.runQueue.push(waiter)
    })
  }

  private releaseRunSlot(): void {
    const next = this.runQueue.shift()
    if (next) {
      if (next.timer) clearTimeout(next.timer)
      next.resolve(() => this.releaseRunSlot())
      return
    }
    this.activeRuns = Math.max(0, this.activeRuns - 1)
  }

  private async resolveDockerWorkspaceRoot(workspaceRoot: string): Promise<string> {
    const mounts = await this.loadCurrentContainerMounts()
    if (mounts.length === 0) {
      return workspaceRoot
    }

    const matched = mounts
      .filter((item) => isPathWithin(workspaceRoot, item.destination))
      .sort((a, b) => b.destination.length - a.destination.length)[0]
    if (!matched) {
      return workspaceRoot
    }

    const relative = path.relative(matched.destination, workspaceRoot)
    if (!isSafeRelativePath(relative)) {
      return workspaceRoot
    }

    const translated = path.resolve(matched.source, relative)
    if (translated === workspaceRoot) {
      return workspaceRoot
    }

    log.info('Translated workspace mount path for docker socket mode', {
      workspaceRoot,
      dockerWorkspaceRoot: translated,
      destination: matched.destination,
      source: matched.source,
    })
    return translated
  }

  private async loadCurrentContainerMounts(): Promise<DockerMountPoint[]> {
    const now = Date.now()
    if (this.mountCache && now - this.mountCache.at < DOCKER_MOUNT_CACHE_MS) {
      return this.mountCache.mounts
    }

    const containerRef = (process.env.HOSTNAME || '').trim()
    if (!containerRef) {
      this.mountCache = { at: now, mounts: [] }
      return []
    }

    const inspectResult = await this.execDocker(
      ['inspect', '--format', '{{json .Mounts}}', containerRef],
      {
        timeoutMs: 5_000,
        maxOutputChars: 64_000,
      },
    )

    if (inspectResult.exitCode !== 0) {
      this.mountCache = { at: now, mounts: [] }
      return []
    }

    const raw = inspectResult.stdout.trim()
    if (!raw || raw === 'null') {
      this.mountCache = { at: now, mounts: [] }
      return []
    }

    try {
      const parsed = JSON.parse(raw)
      const mounts = Array.isArray(parsed)
        ? parsed
            .map((item) => {
              const source = typeof item?.Source === 'string' ? path.resolve(item.Source) : null
              const destination =
                typeof item?.Destination === 'string' ? path.resolve(item.Destination) : null
              if (!source || !destination) return null
              return { source, destination }
            })
            .filter((item): item is DockerMountPoint => item !== null)
        : []
      this.mountCache = { at: now, mounts }
      return mounts
    } catch {
      this.mountCache = { at: now, mounts: [] }
      return []
    }
  }

  private async forceRemoveContainer(containerRef: string): Promise<boolean> {
    const killResult = await this.execDocker(['kill', containerRef], {
      timeoutMs: 5_000,
      maxOutputChars: 2048,
    })
    const rmResult = await this.execDocker(['rm', '-f', containerRef], {
      timeoutMs: 5_000,
      maxOutputChars: 2048,
    })
    const removed = killResult.exitCode === 0 || rmResult.exitCode === 0
    if (!removed) {
      log.warn('Failed to remove workspace container', {
        containerRef,
        killStderr: killResult.stderr.trim(),
        rmStderr: rmResult.stderr.trim(),
      })
    }
    return removed
  }

  private async execDocker(
    args: string[],
    options: {
      stdin?: string
      timeoutMs: number
      maxOutputChars: number
      containerName?: string
    },
  ): Promise<DockerRunResult> {
    const startedAt = Date.now()
    const stdoutCollector = buildOutputCollector(options.maxOutputChars)
    const stderrCollector = buildOutputCollector(options.maxOutputChars)

    return new Promise<DockerRunResult>((resolve, reject) => {
      let finished = false
      let timedOut = false
      let killingContainer = false

      const child = this.spawnFn('docker', args, {
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

      const killNamedContainer = async () => {
        if (!options.containerName || killingContainer) return
        killingContainer = true
        try {
          await this.forceRemoveContainer(options.containerName)
        } catch (error) {
          log.warn('Failed to kill timed-out workspace container', {
            containerName: options.containerName,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }

      const timer =
        options.timeoutMs > 0
          ? setTimeout(() => {
              timedOut = true
              void killNamedContainer().finally(() => {
                try {
                  child.kill('SIGKILL')
                } catch {
                  // ignore
                }
              })
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

      child.stdout?.on('data', (chunk: Buffer) => {
        stdoutCollector.push(chunk)
      })
      child.stderr?.on('data', (chunk: Buffer) => {
        stderrCollector.push(chunk)
      })

      child.on('close', (code) => {
        if (timer) clearTimeout(timer)
        if (timedOut && options.containerName) {
          void killNamedContainer().finally(() => {
            finish({
              stdout: stdoutCollector.toString(),
              stderr: stderrCollector.toString(),
              exitCode: typeof code === 'number' ? code : null,
              durationMs: Math.max(0, Date.now() - startedAt),
              truncated: stdoutCollector.isTruncated() || stderrCollector.isTruncated(),
              timeout: timedOut,
            })
          })
          return
        }
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
        child.stdin?.write(options.stdin)
      }
      child.stdin?.end()
    })
  }
}

interface DockerMountPoint {
  source: string
  destination: string
}

const isSafeRelativePath = (relativePath: string) => {
  if (!relativePath || relativePath === '.') return true
  if (path.isAbsolute(relativePath)) return false
  const normalized = relativePath.replace(/\\/g, '/')
  return !normalized.startsWith('../') && normalized !== '..'
}

const isPathWithin = (targetPath: string, parentPath: string) => {
  const relative = path.relative(parentPath, targetPath)
  return isSafeRelativePath(relative)
}

function resolveRuntimeContainerUser(): string | null {
  const uidGetter = (process as NodeJS.Process & { getuid?: () => number }).getuid
  const gidGetter = (process as NodeJS.Process & { getgid?: () => number }).getgid
  if (typeof uidGetter !== 'function' || typeof gidGetter !== 'function') {
    return null
  }
  try {
    const uid = uidGetter.call(process)
    const gid = gidGetter.call(process)
    if (Number.isInteger(uid) && Number.isInteger(gid) && uid >= 0 && gid >= 0) {
      return `${uid}:${gid}`
    }
  } catch {
    return null
  }
  return null
}

let dockerExecutor = new DockerExecutor()

export const setDockerExecutor = (executor: DockerExecutor) => {
  dockerExecutor = executor
}

export { dockerExecutor }
