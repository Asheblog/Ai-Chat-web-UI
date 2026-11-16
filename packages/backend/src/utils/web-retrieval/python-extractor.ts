/**
 * Trafilatura 正文提取适配器（Python 常驻 worker）
 *
 * 只处理已经下载好的 HTML：模块不做任何网络请求，也不负责正文质量判定。
 * 调用方（readUrlContent 内部流程）在 Node 侧提取不足时把同一份 HTML 交进来，
 * 得到 null 就继续沿用既有结果。
 *
 * 接口约定：
 *  - 返回 { title?, content, excerpt? }，content 为纯文本正文；提取不到正文返回 null。
 *  - 不可用（没有 Python、缺 Trafilatura、进程启动失败）时返回 null，并只记录一次能力缺失日志，
 *    不让网页读取因此失败。
 *  - 单实例最多 1 个在途任务、队列上限 2 个等待任务；队列满时立刻返回 null，不排队等总截止线。
 *  - timeoutMs（默认 1500）内未返回、或 signal 取消时，结束该任务并终止自己拥有的 worker，
 *    由下一个任务重建进程；取消不会拖住队列。
 *  - 空闲 idleTimeoutMs（默认 15000）后进程自行退出，容器内不常驻无尽负载。
 *  - 输入超过 maxInputBytes（默认 1 MiB）时跳过并返回 null，不做截断后提取。
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { createLogger, type Logger } from '../logger'

/** 单次提取的默认时限；调用方阶段预算应小于总截止线。 */
export const WEB_EXTRACTOR_DEFAULT_TIMEOUT_MS = 1500
/** 无任务时进程存活时间。 */
export const WEB_EXTRACTOR_IDLE_TIMEOUT_MS = 15000
/** 交入 Python 的 HTML 上限，超过即跳过。 */
export const WEB_EXTRACTOR_MAX_INPUT_BYTES = 1024 * 1024
/** 等待队列上限（在途任务之外）。 */
export const WEB_EXTRACTOR_QUEUE_LIMIT = 2

const READY_TIMEOUT_MS = 5000
const KILL_GRACE_MS = 500
const DEFAULT_RETRY_COOLDOWN_MS = 30_000
const MAX_PROTOCOL_LINE_BYTES = 2 * 1024 * 1024
const MAX_STDERR_TAIL_BYTES = 4096
const MAX_CONTENT_CHARS = 200_000
// worker 脚本相对仓库可能出现的两个布局：backend 包目录内，或仓库根目录。
const SCRIPT_SEARCH_SEGMENTS = [
  path.join('scripts', 'web-extractor', 'extract_worker.py'),
  path.join('packages', 'backend', 'scripts', 'web-extractor', 'extract_worker.py'),
]
const SCRIPT_SEARCH_DEPTH = 5

export interface WebExtractorDocument {
  title?: string
  content: string
  excerpt?: string
}

export interface WebExtractorOptions {
  signal?: AbortSignal
  timeoutMs?: number
}

export interface WebExtractorConfig {
  /** 显式 Python 解释器路径；缺省按 APP_WEB_EXTRACTOR_PYTHON、镜像与数据目录、PATH 顺序解析。 */
  pythonPath?: string
  /** 显式 worker 脚本路径；缺省按模块位置向上查找 scripts/web-extractor/extract_worker.py。 */
  scriptPath?: string
  timeoutMs?: number
  idleTimeoutMs?: number
  queueLimit?: number
  maxInputBytes?: number
  /** 可恢复故障（进程启动失败、崩溃）后重新尝试的冷却时间，默认 30 秒。 */
  retryCooldownMs?: number
  env?: NodeJS.ProcessEnv
  logger?: Logger
}

export interface PythonInterpreterResolutionOptions {
  explicitPath?: string
  env?: NodeJS.ProcessEnv
  /** 覆盖候选列表（测试与特殊部署用）；候选项为路径或 PATH 中的命令名。 */
  candidates?: readonly string[]
}

type ResolvedRuntime = {
  pythonPath: string
  scriptPath: string
}

interface PendingTask {
  id: string
  html: string
  url: string
  timeoutMs: number
  /** 排队即开始计时：timeoutMs 覆盖等待时间，不因排队被拉长。 */
  deadlineAt: number
  settled: boolean
  timer: NodeJS.Timeout | null
  signal?: AbortSignal
  onAbort?: () => void
  resolve: (document: WebExtractorDocument | null) => void
}

interface WorkerHandle {
  child: ChildProcessWithoutNullStreams
  stdoutBuffer: string
  stderrTail: string
  ready: boolean
  readySettled: boolean
  resolveReady: (ready: boolean) => void
  readyPromise: Promise<boolean>
  readyTimer: NodeJS.Timeout | null
  /** 进程真正退出后 resolve；旧进程退出前不重建新进程。 */
  exited: Promise<void>
}

const fileExists = (candidate: string): boolean => {
  try {
    return existsSync(candidate)
  } catch {
    return false
  }
}

const isPathLike = (candidate: string): boolean =>
  candidate.includes('/') || candidate.includes('\\') || /^[a-zA-Z]:/.test(candidate)

const PATH_EXTENSIONS_UNIX: readonly string[] = ['']
const PATH_EXTENSIONS_WINDOWS: readonly string[] = (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM')
  .split(';')
  .filter(Boolean)

const findOnPath = (command: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string | undefined => {
  const rawPath = env.PATH || env.Path || ''
  const extensions = platform === 'win32' ? PATH_EXTENSIONS_WINDOWS : PATH_EXTENSIONS_UNIX
  for (const directory of rawPath.split(path.delimiter)) {
    if (!directory) continue
    for (const extension of extensions) {
      const candidate = path.join(directory, command + extension)
      if (fileExists(candidate)) return candidate
    }
  }
  return undefined
}

/**
 * 解析 Python 解释器候选：显式配置 → 环境变量 → 镜像自带 venv → 应用数据目录 venv → PATH。
 * 只做存在性判断，不启动进程；返回 undefined 表示没有可用解释器。
 */
export const resolvePythonInterpreter = (
  options: PythonInterpreterResolutionOptions = {},
): string | undefined => {
  const env = options.env ?? process.env
  const platform = process.platform
  const appDataDir = env.APP_DATA_DIR || env.DATA_DIR
  const venvPython = platform === 'win32' ? path.join('Scripts', 'python.exe') : path.join('bin', 'python')
  const defaultCandidates = [
    env.APP_WEB_EXTRACTOR_PYTHON,
    '/opt/python-extractor/bin/python',
    appDataDir ? path.join(appDataDir, 'python-extractor', 'venv', venvPython) : undefined,
    platform === 'win32' ? 'python' : 'python3',
    'python',
  ].filter((candidate): candidate is string => Boolean(candidate && candidate.trim()))

  const candidates = options.explicitPath
    ? [options.explicitPath, ...(options.candidates ?? defaultCandidates)]
    : options.candidates ?? defaultCandidates

  for (const candidate of candidates) {
    const trimmed = candidate.trim()
    if (!trimmed) continue
    if (isPathLike(trimmed)) {
      if (fileExists(trimmed)) return trimmed
      continue
    }
    const onPath = findOnPath(trimmed, env, platform)
    if (onPath) return onPath
  }
  return undefined
}

/**
 * 解析 worker 脚本路径：显式配置 → 环境变量 → 从起始目录（默认当前工作目录）逐级向上查找。
 * 容器里 supervisor 的工作目录是 /app/packages/backend，裸起 dist 时可能是 /app，两种布局都覆盖。
 */
export const resolveExtractorScriptPath = (options: {
  explicitPath?: string
  env?: NodeJS.ProcessEnv
  startDir?: string
} = {}): string | undefined => {
  const env = options.env ?? process.env
  const candidates: string[] = []
  if (options.explicitPath) candidates.push(options.explicitPath)
  if (env.APP_WEB_EXTRACTOR_SCRIPT) candidates.push(env.APP_WEB_EXTRACTOR_SCRIPT)

  let directory = path.resolve(options.startDir ?? process.cwd())
  for (let depth = 0; depth < SCRIPT_SEARCH_DEPTH; depth += 1) {
    for (const segment of SCRIPT_SEARCH_SEGMENTS) {
      candidates.push(path.join(directory, segment))
    }
    const parent = path.dirname(directory)
    if (parent === directory) break
    directory = parent
  }

  for (const candidate of candidates) {
    if (candidate && fileExists(candidate)) return candidate
  }
  return undefined
}

const parseJsonLine = (line: string): Record<string, unknown> | null => {
  try {
    const parsed: unknown = JSON.parse(line)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    return null
  } catch {
    return null
  }
}

const readString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

/**
 * 常驻 Python 提取器。进程、队列与生命周期都在实例内，调用方只看到一个 extract。
 */
export class PythonHtmlExtractor {
  private readonly logger: Logger
  private readonly env: NodeJS.ProcessEnv
  private readonly timeoutMs: number
  private readonly idleTimeoutMs: number
  private readonly queueLimit: number
  private readonly maxInputBytes: number
  private readonly retryCooldownMs: number
  private readonly explicitPythonPath?: string
  private readonly explicitScriptPath?: string

  private runtime: ResolvedRuntime | null = null
  private worker: WorkerHandle | null = null
  private active: PendingTask | null = null
  private readonly queue: PendingTask[] = []
  private idleTimer: NodeJS.Timeout | null = null
  /** 配置级不可用（缺解释器/脚本）：本进程内不再尝试。 */
  private unavailableReason: string | null = null
  /** 可恢复故障：冷却到期后重新尝试，不永久禁用。 */
  private cooldownUntil = 0
  private cooldownReason: string | null = null
  private cooldownReported = false
  private capabilityReported = false
  private dyingWorker: Promise<void> | null = null
  private closed = false
  private taskSequence = 0

  constructor(config: WebExtractorConfig = {}) {
    this.logger = config.logger ?? createLogger('WebRetrieval')
    this.env = config.env ?? process.env
    this.timeoutMs = config.timeoutMs ?? WEB_EXTRACTOR_DEFAULT_TIMEOUT_MS
    this.idleTimeoutMs = config.idleTimeoutMs ?? WEB_EXTRACTOR_IDLE_TIMEOUT_MS
    this.queueLimit = config.queueLimit ?? WEB_EXTRACTOR_QUEUE_LIMIT
    this.maxInputBytes = config.maxInputBytes ?? WEB_EXTRACTOR_MAX_INPUT_BYTES
    this.retryCooldownMs = config.retryCooldownMs ?? DEFAULT_RETRY_COOLDOWN_MS
    this.explicitPythonPath = config.pythonPath
    this.explicitScriptPath = config.scriptPath
  }

  async extract(
    html: string,
    url: string,
    options: WebExtractorOptions = {},
  ): Promise<WebExtractorDocument | null> {
    if (this.isUnavailable()) return null
    if (options.signal?.aborted) return null
    if (typeof html !== 'string' || !html.trim()) return null

    const inputBytes = Buffer.byteLength(html, 'utf8')
    if (inputBytes > this.maxInputBytes) {
      this.logger.debug('Python 正文提取跳过：HTML 超过输入上限', {
        url,
        inputBytes,
        limit: this.maxInputBytes,
      })
      return null
    }

    if (!this.resolveRuntime()) return null

    if (this.active && this.queue.length >= this.queueLimit) {
      this.logger.warn('Python 正文提取队列已满，跳过该页', { url, queueLimit: this.queueLimit })
      return null
    }

    const task = this.createTask(html, url, options)
    return new Promise<WebExtractorDocument | null>((resolve) => {
      task.resolve = resolve
      this.attachAbort(task)
      if (task.settled) return
      // 从排队开始计时：等待时间计入 timeoutMs，队列不会把单次提取拉长成两倍时限。
      task.timer = setTimeout(() => this.handleTaskDeadline(task), task.timeoutMs)
      this.queue.push(task)
      this.pump()
    })
  }

  /** 结束当前进程并结算在途任务；测试与进程收尾使用。 */
  async close(): Promise<void> {
    const wasClosed = this.closed
    this.closed = true
    this.clearIdleTimer()
    this.drainQueue('closed')
    const inFlight = this.active
    if (inFlight) {
      this.killWorker('close')
      this.settleTask(inFlight, null, 'closed')
    } else {
      this.shutdownWorker('close')
    }
    if (!wasClosed) this.logger.debug('Python 正文提取适配器已关闭')
  }

  /** 供日志与诊断读取的只读状态。 */
  describeState(): {
    active: boolean
    queued: number
    workerReady: boolean
    unavailableReason: string | null
    cooldownReason: string | null
    cooldownRemainingMs: number
  } {
    return {
      active: this.active !== null,
      queued: this.queue.length,
      workerReady: Boolean(this.worker?.ready),
      unavailableReason: this.unavailableReason,
      cooldownReason: this.cooldownReason,
      cooldownRemainingMs: Math.max(0, this.cooldownUntil - Date.now()),
    }
  }

  private createTask(html: string, url: string, options: WebExtractorOptions): PendingTask {
    this.taskSequence += 1
    const timeoutMs =
      typeof options.timeoutMs === 'number' && Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
        ? options.timeoutMs
        : this.timeoutMs
    return {
      id: 'wx-' + this.taskSequence,
      html,
      url,
      timeoutMs,
      // 准入即开始计时：deadlineAt 覆盖排队等待，不在 startTask 时重置。
      deadlineAt: Date.now() + timeoutMs,
      settled: false,
      timer: null,
      signal: options.signal,
      resolve: () => undefined,
    }
  }

  private resolveRuntime(): ResolvedRuntime | null {
    if (this.runtime) return this.runtime
    const pythonPath = resolvePythonInterpreter({
      explicitPath: this.explicitPythonPath,
      env: this.env,
    })
    if (!pythonPath) {
      this.reportUnavailable('未找到可用的 Python 解释器')
      return null
    }
    const scriptPath = resolveExtractorScriptPath({
      explicitPath: this.explicitScriptPath,
      env: this.env,
    })
    if (!scriptPath) {
      this.reportUnavailable('未找到 web-extractor worker 脚本')
      return null
    }
    this.runtime = { pythonPath, scriptPath }
    return this.runtime
  }

  private isUnavailable(): boolean {
    if (this.closed) return true
    if (this.unavailableReason) return true
    return this.cooldownUntil > Date.now()
  }

  /** 配置级缺失（缺解释器或脚本）：本进程内不再尝试，只记录一次。 */
  private reportUnavailable(reason: string): void {
    this.unavailableReason = reason
    if (this.capabilityReported) return
    this.capabilityReported = true
    this.logger.warn('Python 正文提取不可用，已跳过该适配器；既有 Node 提取与浏览器能力不受影响', {
      reason,
    })
  }

  /** 可恢复故障（启动失败、崩溃）：冷却后重新尝试，不做永久禁用。 */
  private reportRecoverableFailure(reason: string): void {
    this.cooldownReason = reason
    this.cooldownUntil = Date.now() + this.retryCooldownMs
    this.logger.warn('Python 正文提取暂时失败，冷却后重试', {
      reason,
      cooldownMs: this.retryCooldownMs,
    })
  }

  private attachAbort(task: PendingTask): void {
    const signal = task.signal
    if (!signal) return
    task.onAbort = () => this.handleAbort(task)
    signal.addEventListener('abort', task.onAbort, { once: true })
  }

  private detachAbort(task: PendingTask): void {
    if (!task.signal || !task.onAbort) return
    task.signal.removeEventListener('abort', task.onAbort)
    task.onAbort = undefined
  }

  private handleAbort(task: PendingTask): void {
    if (task.settled) return
    if (this.active === task) this.killWorker('aborted')
    this.settleTask(task, null, 'aborted')
  }

  private finishTask(task: PendingTask, document: WebExtractorDocument | null, reason: string): void {
    if (task.settled) return
    task.settled = true
    if (task.timer) {
      clearTimeout(task.timer)
      task.timer = null
    }
    this.detachAbort(task)
    if (reason !== 'ok' && reason !== 'empty') {
      this.logger.debug('Python 正文提取任务结算为空', { url: task.url, reason })
    }
    task.resolve(document)
  }

  /**
   * 按任务结算：只结束这张任务，不动其他任务。
   * 已终止 worker 的后续回调可能晚于新任务启动，因此不能按“当前在途任务”结算。
   */
  private settleTask(task: PendingTask, document: WebExtractorDocument | null, reason: string): void {
    if (this.active === task) {
      this.active = null
      this.finishTask(task, document, reason)
      this.scheduleIdle()
      this.pump()
      return
    }
    const index = this.queue.indexOf(task)
    if (index >= 0) this.queue.splice(index, 1)
    this.finishTask(task, document, reason)
    this.pump()
  }

  private pump(): void {
    if (this.closed || this.active) return
    const next = this.queue[0]
    if (!next) return
    const dying = this.dyingWorker
    if (dying) {
      // 旧进程（被取消/超时的 owned child）真正退出前不重建：门控一直保留到 exit 被观察到。
      // 期间可以有多次 pump，但都等同一个 promise；先到的那个清理门控并继续，谁都不能跳过它去 spawn。
      void dying.then(() => {
        if (this.dyingWorker === dying) this.dyingWorker = null
        this.pump()
      })
      return
    }
    this.queue.shift()
    void this.startTask(next)
  }

  private drainQueue(reason: string): void {
    while (this.queue.length > 0) {
      const task = this.queue.shift()
      if (task) this.finishTask(task, null, reason)
    }
  }

  private async startTask(task: PendingTask): Promise<void> {
    this.clearIdleTimer()
    this.active = task

    const worker = await this.ensureWorker()
    // 等待就绪期间任务可能已被取消或已结算；此时不能影响新接手的任务。
    if (task.settled || this.active !== task) return
    if (!worker) {
      this.settleTask(task, null, 'worker-unavailable')
      return
    }

    const payload = JSON.stringify({ id: task.id, url: task.url, html: task.html }) + '\n'
    try {
      worker.child.stdin.write(payload, 'utf8', (error) => {
        if (!error) return
        this.failTask(task, '写入 worker 失败：' + error.message)
      })
    } catch (error) {
      this.failTask(task, '写入 worker 失败：' + (error instanceof Error ? error.message : String(error)))
    }
  }

  private failTask(task: PendingTask, reason: string): void {
    if (task.settled) return
    if (this.active === task) this.killWorker(reason)
    this.settleTask(task, null, reason)
  }

  /** 任务时限（含排队等待）到期：在途则终止 worker，排队中则直接结算。 */
  private handleTaskDeadline(task: PendingTask): void {
    if (task.settled) return
    this.logger.debug('Python 正文提取超出任务时限，取消该任务', {
      url: task.url,
      timeoutMs: task.timeoutMs,
      stage: this.active === task ? 'active' : 'queued',
    })
    this.failTask(task, 'timeout')
  }

  private ensureWorker(): Promise<WorkerHandle | null> {
    if (this.worker) {
      const pending = this.worker
      if (pending.ready) return Promise.resolve(pending)
      return pending.readyPromise.then((ready) => (ready ? pending : null))
    }
    const handle = this.spawnWorker()
    if (!handle) return Promise.resolve(null)
    return handle.readyPromise.then((ready) => (ready ? handle : null))
  }

  private spawnWorker(): WorkerHandle | null {
    const runtime = this.runtime
    if (!runtime) return null
    let child: ChildProcessWithoutNullStreams
    try {
      child = spawn(runtime.pythonPath, [runtime.scriptPath], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        env: this.env,
      })
    } catch (error) {
      this.reportRecoverableFailure(
        '启动 Python 进程失败：' + (error instanceof Error ? error.message : String(error)),
      )
      return null
    }

    let resolveReady: (ready: boolean) => void = () => undefined
    const readyPromise = new Promise<boolean>((resolve) => {
      resolveReady = resolve
    })

    const exited = new Promise<void>((resolve) => {
      child.once('exit', () => resolve())
      child.once('error', () => resolve())
    })

    const handle: WorkerHandle = {
      child,
      stdoutBuffer: '',
      stderrTail: '',
      exited,
      ready: false,
      readySettled: false,
      resolveReady: (ready: boolean) => {
        if (handle.readySettled) return
        handle.readySettled = true
        if (handle.readyTimer) {
          clearTimeout(handle.readyTimer)
          handle.readyTimer = null
        }
        handle.ready = ready
        resolveReady(ready)
      },
      readyPromise,
      readyTimer: null,
    }

    handle.readyTimer = setTimeout(() => {
      if (handle.ready) return
      this.logger.debug('Python 正文提取进程未在时限内就绪', { timeoutMs: READY_TIMEOUT_MS })
      this.reportRecoverableFailure('Python 正文提取进程未在时限内就绪')
      this.teardownWorker(handle, 'ready-timeout')
      handle.resolveReady(false)
    }, READY_TIMEOUT_MS)
    handle.readyTimer.unref?.()

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => this.onStdout(handle, chunk))
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => this.onStderr(handle, chunk))
    // 进程已退出时写 stdin 会触发 error 事件；不监听会成为未捕获异常。
    child.stdin.on('error', () => undefined)
    child.on('error', (error) => this.onWorkerError(handle, error))
    child.on('exit', (code, signal) => this.onWorkerExit(handle, code, signal))

    this.worker = handle
    return handle
  }

  private onStdout(handle: WorkerHandle, chunk: string): void {
    handle.stdoutBuffer += chunk
    let newlineIndex = handle.stdoutBuffer.indexOf('\n')
    while (newlineIndex >= 0) {
      const line = handle.stdoutBuffer.slice(0, newlineIndex).trim()
      handle.stdoutBuffer = handle.stdoutBuffer.slice(newlineIndex + 1)
      if (line) this.handleProtocolLine(handle, line)
      newlineIndex = handle.stdoutBuffer.indexOf('\n')
    }
    if (handle.stdoutBuffer.length > MAX_PROTOCOL_LINE_BYTES) {
      this.logger.warn('Python 正文提取输出行超限，终止 worker', {
        pendingBytes: handle.stdoutBuffer.length,
      })
      const task = this.active
      if (task) this.failTask(task, 'protocol-line-overflow')
    }
  }

  private handleProtocolLine(handle: WorkerHandle, line: string): void {
    const event = parseJsonLine(line)
    if (!event) {
      this.logger.debug('Python 正文提取返回了无法解析的行', { preview: line.slice(0, 200) })
      return
    }
    if (event.type === 'ready') {
      handle.resolveReady(true)
      this.logger.debug('Python 正文提取进程就绪', {
        trafilatura: typeof event.trafilatura === 'string' ? event.trafilatura : 'unknown',
      })
      return
    }

    const taskId = readString(event.id)
    if (!taskId) {
      this.logger.debug('Python 正文提取返回了无任务标识的事件', { preview: line.slice(0, 200) })
      return
    }
    const task = this.active
    if (!task || task.id !== taskId) {
      this.logger.debug('Python 正文提取返回了非在途任务的结果，已忽略', { taskId })
      return
    }

    if (event.ok === false) {
      const error = event.error
      const errorRecord =
        error && typeof error === 'object' ? (error as Record<string, unknown>) : undefined
      this.logger.debug('Python 正文提取未取得正文', {
        url: task.url,
        errorCode: readString(errorRecord?.code),
        errorMessage: readString(errorRecord?.message)?.slice(0, 200),
      })
      this.settleTask(task, null, 'extract-error')
      return
    }

    const document = this.toDocument(event)
    this.settleTask(task, document, document ? 'ok' : 'empty')
  }

  private toDocument(event: Record<string, unknown>): WebExtractorDocument | null {
    if (event.ok !== true) return null
    const raw = event.document
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
    const source = raw as Record<string, unknown>
    const content = readString(source.content)
    if (!content) return null
    const truncated = content.length > MAX_CONTENT_CHARS
    const document: WebExtractorDocument = {
      content: truncated ? content.slice(0, MAX_CONTENT_CHARS) : content,
    }
    const title = readString(source.title)
    if (title) document.title = title
    const excerpt = readString(source.excerpt)
    if (excerpt) document.excerpt = excerpt
    if (truncated) {
      this.logger.debug('Python 正文提取结果已按上限截断', {
        originalChars: content.length,
        limit: MAX_CONTENT_CHARS,
      })
    }
    return document
  }

  private onStderr(handle: WorkerHandle, chunk: string): void {
    handle.stderrTail = (handle.stderrTail + chunk).slice(-MAX_STDERR_TAIL_BYTES)
  }

  private onWorkerError(handle: WorkerHandle, error: Error): void {
    // 已被主动终止或替换的旧进程，其退出/错误事件不得波及当前在途任务。
    if (this.worker !== handle) return
    this.worker = null
    handle.resolveReady(false)
    this.reportRecoverableFailure('Python 进程错误：' + error.message)
    const inFlight = this.active
    if (inFlight) this.settleTask(inFlight, null, 'worker-error')
    this.drainQueue('worker-unavailable')
  }

  private onWorkerExit(handle: WorkerHandle, code: number | null, signal: NodeJS.Signals | null): void {
    // 超时、取消、close 与替换都会先置空 worker；旧进程随后到达的 exit 只做清理，不再结算任务。
    if (this.worker !== handle) return
    this.worker = null
    const wasReady = handle.ready
    handle.resolveReady(false)
    if (!wasReady) {
      const detail = handle.stderrTail.trim() || 'exit code ' + String(code)
      this.reportRecoverableFailure('Python 正文提取进程启动失败：' + detail.slice(0, 300))
      const startingTask = this.active
      if (startingTask) this.settleTask(startingTask, null, 'worker-startup-failed')
      this.drainQueue('worker-unavailable')
      return
    }
    this.logger.debug('Python 正文提取进程已退出', { code, signal })
    const inFlight = this.active
    if (inFlight) this.settleTask(inFlight, null, 'worker-exit')
  }

  private killWorker(reason: string): void {
    const handle = this.worker
    if (!handle) return
    this.worker = null
    // 立即 SIGKILL 自己拥有的进程；重建等下一条 pump 见到 exit 之后。
    this.dyingWorker = handle.exited
    handle.resolveReady(false)
    try {
      handle.child.stdin.end()
    } catch {
      // 进程已退出时 end 可能抛错；能做的只有尽力而为
    }
    try {
      handle.child.kill('SIGKILL')
    } catch {
      // 终止失败不影响任务结算
    }
    this.logger.debug('Python 正文提取进程已终止', { reason, pid: handle.child.pid })
  }

  private teardownWorker(handle: WorkerHandle, reason: string): void {
    if (this.worker !== handle) return
    this.worker = null
    this.dyingWorker = handle.exited
    handle.resolveReady(false)
    try {
      handle.child.stdin.end()
    } catch {
      // 忽略
    }
    try {
      handle.child.kill('SIGKILL')
    } catch {
      // 忽略
    }
    this.logger.debug('Python 正文提取进程已拆除', { reason, pid: handle.child.pid })
  }

  private shutdownWorker(reason: string): void {
    const handle = this.worker
    if (!handle) return
    this.worker = null
    handle.resolveReady(false)
    const child = handle.child
    try {
      child.stdin.end()
    } catch {
      // 忽略
    }
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        // 忽略
      }
    }, KILL_GRACE_MS)
    timer.unref?.()
    child.once('exit', () => clearTimeout(timer))
    this.logger.debug('Python 正文提取进程请求退出', { reason, pid: child.pid })
  }

  private clearIdleTimer(): void {
    if (!this.idleTimer) return
    clearTimeout(this.idleTimer)
    this.idleTimer = null
  }

  private scheduleIdle(): void {
    this.clearIdleTimer()
    if (this.closed || this.active || this.queue.length > 0 || !this.worker) return
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null
      if (this.closed || this.active || this.queue.length > 0) return
      this.shutdownWorker('idle')
    }, this.idleTimeoutMs)
    // 空闲退出定时器不保持事件循环存活：没有其他句柄时进程可以正常结束。
    this.idleTimer.unref?.()
  }
}

let sharedExtractor: PythonHtmlExtractor | null = null

/** 进程内共享实例；构造一次后复用，避免每次请求重启 Python。 */
export const getPythonHtmlExtractor = (): PythonHtmlExtractor => {
  if (!sharedExtractor) sharedExtractor = new PythonHtmlExtractor()
  return sharedExtractor
}

/**
 * 用 Trafilatura 从已下载的 HTML 中提取正文。
 * 返回 null 表示不可用或没有正文，调用方继续沿用自身结果。
 */
export const extractHtmlWithPython = (
  html: string,
  url: string,
  options?: WebExtractorOptions,
): Promise<WebExtractorDocument | null> => getPythonHtmlExtractor().extract(html, url, options)

/** 关闭共享实例（测试与进程收尾）。 */
export const shutdownPythonHtmlExtractor = async (): Promise<void> => {
  const current = sharedExtractor
  sharedExtractor = null
  if (current) await current.close()
}
