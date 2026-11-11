'use client'

export interface RenderRequest {
  messageId: number | string
  content: string
  reasoning?: string
  contentVersion: number
  reasoningVersion: number
  isStreaming?: boolean
}

export interface RenderResponse {
  contentHtml: string | null
  reasoningHtml?: string | null
  contentVersion: number
  reasoningVersion: number
  errored?: boolean
  errorMessage?: string
  /** 建议调用方在这个毫秒数之后再重试；缺省时按调用方自己的节奏。 */
  retryAfterMs?: number
}

interface PendingJob {
  request: RenderRequest
  resolve: (value: RenderResponse) => void
  timer?: ReturnType<typeof setTimeout>
  sent: boolean
}

interface NetworkInformationLike {
  effectiveType?: string
  downlink?: number
}

type ReadyListener = () => void

/**
 * 任务截止：单次渲染的硬上限。Worker 是按消息串行处理的，超时后只结算该任务，
 * 连续两次超时才重启 Worker，避免一条慢消息把整页 markdown 拖进纯文本。
 */
const JOB_TIMEOUT_MS = 15000
/**
 * 初始化等待（软等待）：超时只把当前排队的任务结算成纯文本，**不终止** Worker。
 * Worker 的大模块在弱网下可能还在下载，迟到的 ready 会广播给所有订阅者并自愈。
 */
const INITIALIZATION_GRACE_MS = 15000
const SLOW_INITIALIZATION_GRACE_MS = 30000
/** Worker 真正卡死（连脚本都没下载完且无 error 事件）才回收，避免无限占资源。 */
const INITIALIZATION_HARD_TIMEOUT_MS = 60000
const SLOW_INITIALIZATION_HARD_TIMEOUT_MS = 120000
const BASE_RETRY_COOLDOWN_MS = 10000
const MAX_RETRY_COOLDOWN_MS = 60000
const MAX_COOLDOWN_EXPONENT = 3
const INITIALIZATION_RETRY_HINT_MS = 5000

let workerInstance: Worker | null = null
let ready = false
let initTimer: ReturnType<typeof setTimeout> | undefined
let failures = 0
let retryAt = 0
let consecutiveJobTimeouts = 0
let jobCounter = 0
let onlineListenerInstalled = false
const pendingJobs = new Map<string, PendingJob>()
const readyListeners = new Set<ReadyListener>()

const readConnection = (): NetworkInformationLike | undefined => {
  if (typeof navigator === 'undefined') return undefined
  return (navigator as Navigator & { connection?: NetworkInformationLike }).connection
}

const isSlowNetwork = (): boolean => {
  const connection = readConnection()
  if (!connection) return false
  if (
    connection.effectiveType === 'slow-2g' ||
    connection.effectiveType === '2g' ||
    connection.effectiveType === '3g'
  ) {
    return true
  }
  return typeof connection.downlink === 'number' && connection.downlink > 0 && connection.downlink < 1.5
}

const initializationGraceMs = () => (isSlowNetwork() ? SLOW_INITIALIZATION_GRACE_MS : INITIALIZATION_GRACE_MS)
const initializationHardTimeoutMs = () =>
  isSlowNetwork() ? SLOW_INITIALIZATION_HARD_TIMEOUT_MS : INITIALIZATION_HARD_TIMEOUT_MS

const retryCooldownMs = (count: number) => {
  const exponent = Math.min(Math.max(count - 1, 0), MAX_COOLDOWN_EXPONENT)
  return Math.min(BASE_RETRY_COOLDOWN_MS * 2 ** exponent, MAX_RETRY_COOLDOWN_MS)
}

const fallback = (
  request: RenderRequest,
  reason: string,
  retryAfterMs?: number,
): RenderResponse => ({
  contentHtml: null,
  reasoningHtml: request.reasoning ? null : undefined,
  contentVersion: request.contentVersion,
  reasoningVersion: request.reasoningVersion,
  errored: true,
  errorMessage: reason,
  retryAfterMs,
})

const settle = (jobId: string, response: RenderResponse) => {
  const job = pendingJobs.get(jobId)
  if (!job) return
  clearTimeout(job.timer)
  pendingJobs.delete(jobId)
  job.resolve(response)
}

const notifyReady = () => {
  for (const listener of Array.from(readyListeners)) {
    try {
      listener()
    } catch {
      console.warn('[markdown-worker] ready-listener-failed')
    }
  }
}

const dispose = (reason: string) => {
  const worker = workerInstance
  workerInstance = null
  ready = false
  clearTimeout(initTimer)
  initTimer = undefined
  worker?.terminate()
  for (const [id, job] of pendingJobs) settle(id, fallback(job.request, reason))
}

const resetBudget = () => {
  failures = 0
  retryAt = 0
  consecutiveJobTimeouts = 0
}

const fail = (worker: Worker | null, reason: string) => {
  if (worker !== workerInstance) return
  failures += 1
  retryAt = Date.now() + retryCooldownMs(failures)
  dispose(reason)
  console.warn('[markdown-worker] ' + reason)
}

const handleJobTimeout = (worker: Worker, jobId: string, job: PendingJob) => {
  if (worker !== workerInstance) return
  consecutiveJobTimeouts += 1
  settle(jobId, fallback(job.request, 'task-timeout', retryCooldownMs(1)))
  if (consecutiveJobTimeouts >= 2) {
    fail(worker, 'task-timeout')
  } else {
    console.warn('[markdown-worker] task-timeout')
  }
}

const send = (worker: Worker, jobId: string, job: PendingJob) => {
  if (!ready || job.sent || worker !== workerInstance) return
  job.sent = true
  clearTimeout(job.timer)
  job.timer = setTimeout(() => handleJobTimeout(worker, jobId, job), JOB_TIMEOUT_MS)
  try {
    worker.postMessage({ ...job.request, jobId, messageId: String(job.request.messageId) })
  } catch {
    fail(worker, 'post-message-failed')
  }
}

const ensureWorker = (): Worker | null => {
  if (workerInstance) return workerInstance
  if (Date.now() < retryAt) return null
  if (typeof Worker === 'undefined') return null
  try {
    const worker = new Worker(new URL('../workers/markdown-worker.ts', import.meta.url), { type: 'module' })
    workerInstance = worker
    ready = false
    initTimer = setTimeout(() => fail(worker, 'initialization-timeout'), initializationHardTimeoutMs())
    worker.addEventListener('message', (event: MessageEvent<any>) => {
      if (worker !== workerInstance) return
      const data = event.data
      if (data?.type === 'ready') {
        if (ready) return
        ready = true
        clearTimeout(initTimer)
        initTimer = undefined
        resetBudget()
        for (const [id, job] of pendingJobs) send(worker, id, job)
        notifyReady()
        return
      }
      if (typeof data?.jobId !== 'string') return
      const job = pendingJobs.get(data.jobId)
      if (!job) return
      if (data.errored || data.contentVersion !== job.request.contentVersion ||
          data.reasoningVersion !== job.request.reasoningVersion || typeof data.contentHtml !== 'string') {
        settle(data.jobId, fallback(job.request, 'render-failed'))
        return
      }
      resetBudget()
      settle(data.jobId, {
        contentHtml: data.contentHtml,
        reasoningHtml: data.reasoningHtml ?? null,
        contentVersion: data.contentVersion,
        reasoningVersion: data.reasoningVersion,
      })
    })
    worker.addEventListener('error', () => fail(worker, 'worker-error'))
    worker.addEventListener('messageerror', () => fail(worker, 'message-error'))
    return worker
  } catch {
    fail(workerInstance, 'initialization-failed')
    return null
  }
}

const installOnlineListener = () => {
  if (onlineListenerInstalled || typeof window === 'undefined') return
  onlineListenerInstalled = true
  window.addEventListener('online', resetBudget)
}

export const requestMarkdownRender = async (request: RenderRequest): Promise<RenderResponse> => {
  if (!request.content && !request.reasoning) {
    return { contentHtml: '', contentVersion: request.contentVersion, reasoningVersion: request.reasoningVersion }
  }
  if (typeof window === 'undefined') return fallback(request, 'server-render')
  installOnlineListener()
  const worker = ensureWorker()
  if (!worker) return fallback(request, 'worker-unavailable', Math.max(0, retryAt - Date.now()))
  const id = 'job-' + jobCounter++
  return new Promise((resolve) => {
    const job: PendingJob = { request, resolve, sent: false }
    pendingJobs.set(id, job)
    if (!ready) {
      job.timer = setTimeout(
        () => settle(id, fallback(request, 'initialization-slow', INITIALIZATION_RETRY_HINT_MS)),
        initializationGraceMs(),
      )
    }
    send(worker, id, job)
  })
}

/**
 * 订阅 Worker 的 ready 事件。弱网下 Worker 可能在软超时之后才完成初始化；
 * 订阅者据此把已经降级成纯文本的快照重新交给 Worker 渲染，不需要刷新页面。
 */
export const subscribeMarkdownWorkerReady = (listener: ReadyListener) => {
  readyListeners.add(listener)
  return () => {
    readyListeners.delete(listener)
  }
}

/** 提前启动 Worker（下载 + 编译），把首次消息的等待挪到会话初始化阶段。 */
export const prewarmMarkdownWorker = () => {
  if (typeof window === 'undefined' || typeof Worker === 'undefined') return
  installOnlineListener()
  ensureWorker()
}

export const shutdownMarkdownWorker = () => {
  dispose('cancelled')
  resetBudget()
}
