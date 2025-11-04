'use client'

type MessageId = number | string

interface RenderRequest {
  messageId: MessageId
  content: string
  reasoning?: string
  contentVersion: number
  reasoningVersion: number
}

interface RenderResponse {
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
  reject: (error: Error) => void
}

let workerInstance: Worker | null = null
const pendingJobs = new Map<string, PendingJob>()
let jobCounter = 0

const createFallbackResponse = (
  request: RenderRequest,
  errorMessage?: string | null
): RenderResponse => ({
  contentHtml: null,
  reasoningHtml: request.reasoning ? null : undefined,
  contentVersion: request.contentVersion,
  reasoningVersion: request.reasoningVersion,
  errored: true,
  errorMessage: errorMessage ?? undefined,
})

const ensureWorker = () => {
  if (workerInstance || typeof window === 'undefined') {
    return workerInstance
  }
  workerInstance = new Worker(new URL('../workers/markdown-worker.ts', import.meta.url), {
    type: 'module',
  })
  workerInstance.addEventListener('message', (event: MessageEvent<any>) => {
    const data = event.data
    if (!data || typeof data.jobId !== 'string') return
    const pending = pendingJobs.get(data.jobId)
    if (!pending) return
    pendingJobs.delete(data.jobId)
    if (data.errored) {
      if (process.env.NODE_ENV !== 'production') {
        // eslint-disable-next-line no-console
        console.warn('[markdown-worker-client] Markdown worker fallback', data.errorMessage || '渲染失败')
      }
      pending.resolve(createFallbackResponse(pending.request, data.errorMessage))
      return
    }
    pending.resolve({
      contentHtml: data.contentHtml,
      reasoningHtml: data.reasoningHtml ?? null,
      contentVersion: data.contentVersion,
      reasoningVersion: data.reasoningVersion,
    })
  })
  workerInstance.addEventListener('error', (error) => {
    const message = error instanceof Error ? error.message : '渲染失败'
    pendingJobs.forEach((job) => {
      if (process.env.NODE_ENV !== 'production') {
        // eslint-disable-next-line no-console
        console.warn('[markdown-worker-client] Markdown worker error fallback', message)
      }
      job.resolve(createFallbackResponse(job.request, message))
    })
    pendingJobs.clear()
    workerInstance?.terminate()
    workerInstance = null
  })
  return workerInstance
}

export const requestMarkdownRender = async (payload: RenderRequest): Promise<RenderResponse> => {
  if (!payload.content && !payload.reasoning) {
    return {
      contentHtml: '',
      reasoningHtml: payload.reasoning ? '' : undefined,
      contentVersion: payload.contentVersion,
      reasoningVersion: payload.reasoningVersion,
    }
  }

  if (typeof window === 'undefined') {
    return {
      contentHtml: payload.content,
      reasoningHtml: payload.reasoning,
      contentVersion: payload.contentVersion,
      reasoningVersion: payload.reasoningVersion,
    }
  }

  const worker = ensureWorker()
  if (!worker) {
    return {
      contentHtml: payload.content,
      reasoningHtml: payload.reasoning,
      contentVersion: payload.contentVersion,
      reasoningVersion: payload.reasoningVersion,
    }
  }

  const jobId = `job-${Date.now()}-${jobCounter++}`

  const response = new Promise<RenderResponse>((resolve, reject) => {
    pendingJobs.set(jobId, { request: payload, resolve, reject })
  })

  worker.postMessage({
    jobId,
    messageId: payload.messageId,
    content: payload.content,
    reasoning: payload.reasoning,
    contentVersion: payload.contentVersion,
    reasoningVersion: payload.reasoningVersion,
  })

  return response
}

export const shutdownMarkdownWorker = () => {
  workerInstance?.terminate()
  workerInstance = null
  pendingJobs.forEach((job) => job.reject(new Error('渲染被取消')))
  pendingJobs.clear()
}
