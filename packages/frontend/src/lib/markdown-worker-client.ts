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
  contentHtml: string
  reasoningHtml?: string
  contentVersion: number
  reasoningVersion: number
  errored?: boolean
  errorMessage?: string
}

interface PendingJob {
  resolve: (value: RenderResponse) => void
  reject: (error: Error) => void
}

let workerInstance: Worker | null = null
const pendingJobs = new Map<string, PendingJob>()
let jobCounter = 0

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
      pending.reject(new Error(data.errorMessage || '渲染失败'))
      return
    }
    pending.resolve({
      contentHtml: data.contentHtml,
      reasoningHtml: data.reasoningHtml,
      contentVersion: data.contentVersion,
      reasoningVersion: data.reasoningVersion,
    })
  })
  workerInstance.addEventListener('error', (error) => {
    pendingJobs.forEach((job) => job.reject(error instanceof Error ? error : new Error('渲染失败')))
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
    pendingJobs.set(jobId, { resolve, reject })
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
