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
}

interface PendingJob {
  request: RenderRequest
  resolve: (value: RenderResponse) => void
  timer?: ReturnType<typeof setTimeout>
  sent: boolean
}

const READY_TIMEOUT_MS = 3000
const JOB_TIMEOUT_MS = 5000
const RETRY_COOLDOWN_MS = 10000
const MAX_CONSECUTIVE_FAILURES = 3
let workerInstance: Worker | null = null
let ready = false
let readyTimer: ReturnType<typeof setTimeout> | undefined
let failures = 0
let retryAt = 0
let jobCounter = 0
const pendingJobs = new Map<string, PendingJob>()

const fallback = (request: RenderRequest, reason: string): RenderResponse => ({
  contentHtml: null,
  reasoningHtml: request.reasoning ? null : undefined,
  contentVersion: request.contentVersion,
  reasoningVersion: request.reasoningVersion,
  errored: true,
  errorMessage: reason,
})

const settle = (jobId: string, response: RenderResponse) => {
  const job = pendingJobs.get(jobId)
  if (!job) return
  clearTimeout(job.timer)
  pendingJobs.delete(jobId)
  job.resolve(response)
}

const dispose = (reason: string) => {
  const worker = workerInstance
  workerInstance = null
  ready = false
  clearTimeout(readyTimer)
  readyTimer = undefined
  worker?.terminate()
  for (const [id, job] of pendingJobs) settle(id, fallback(job.request, reason))
}

const fail = (worker: Worker | null, reason: string) => {
  if (worker !== workerInstance) return
  failures += 1
  retryAt = Date.now() + RETRY_COOLDOWN_MS
  dispose(reason)
  console.warn('[markdown-worker] ' + reason)
}

const send = (worker: Worker, jobId: string, job: PendingJob) => {
  if (!ready || job.sent || worker !== workerInstance) return
  job.sent = true
  job.timer = setTimeout(() => fail(worker, 'task-timeout'), JOB_TIMEOUT_MS)
  try {
    worker.postMessage({ ...job.request, jobId, messageId: String(job.request.messageId) })
  } catch {
    fail(worker, 'post-message-failed')
  }
}

const ensureWorker = (): Worker | null => {
  if (workerInstance) return workerInstance
  if (failures >= MAX_CONSECUTIVE_FAILURES || Date.now() < retryAt) return null
  try {
    const worker = new Worker(new URL('../workers/markdown-worker.ts', import.meta.url), { type: 'module' })
    workerInstance = worker
    readyTimer = setTimeout(() => fail(worker, 'initialization-timeout'), READY_TIMEOUT_MS)
    worker.addEventListener('message', (event: MessageEvent<any>) => {
      if (worker !== workerInstance) return
      const data = event.data
      if (data?.type === 'ready') {
        ready = true
        clearTimeout(readyTimer)
        readyTimer = undefined
        for (const [id, job] of pendingJobs) send(worker, id, job)
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
      failures = 0
      retryAt = 0
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

export const requestMarkdownRender = async (request: RenderRequest): Promise<RenderResponse> => {
  if (!request.content && !request.reasoning) {
    return { contentHtml: '', contentVersion: request.contentVersion, reasoningVersion: request.reasoningVersion }
  }
  if (typeof window === 'undefined') return fallback(request, 'server-render')
  const worker = ensureWorker()
  if (!worker) return fallback(request, 'worker-unavailable')
  const id = 'job-' + jobCounter++
  return new Promise((resolve) => {
    const job: PendingJob = { request, resolve, sent: false }
    pendingJobs.set(id, job)
    send(worker, id, job)
  })
}

export const shutdownMarkdownWorker = () => {
  dispose('cancelled')
  failures = 0
  retryAt = 0
}
