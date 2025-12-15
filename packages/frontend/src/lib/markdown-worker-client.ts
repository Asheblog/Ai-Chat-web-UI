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
let workerFailed = false // 标记 Worker 是否初始化失败，避免重复尝试
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

const ensureWorker = (): Worker | null => {
  // 服务端渲染时直接返回 null
  if (typeof window === 'undefined') {
    return null
  }

  // 如果已有实例，直接返回
  if (workerInstance) {
    return workerInstance
  }

  // 如果之前初始化失败过，不再尝试
  if (workerFailed) {
    return null
  }

  try {
    // 使用 try-catch 包裹 Worker 初始化，捕获可能的错误
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
      const message = error instanceof ErrorEvent ? error.message : '渲染失败'
      if (process.env.NODE_ENV !== 'production') {
        // eslint-disable-next-line no-console
        console.warn('[markdown-worker-client] Worker error, falling back to main thread:', message)
      }
      pendingJobs.forEach((job) => {
        job.resolve(createFallbackResponse(job.request, message))
      })
      pendingJobs.clear()
      workerInstance?.terminate()
      workerInstance = null
      workerFailed = true // 标记失败，后续使用 fallback
    })

    return workerInstance
  } catch (err) {
    // Worker 初始化失败（如 standalone 模式下文件不存在）
    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.warn('[markdown-worker-client] Failed to initialize worker, using fallback:', err)
    }
    workerFailed = true
    return null
  }
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
    // Worker 不可用时，返回 null 让 MarkdownRenderer 使用 ReactMarkdown fallback
    // 不能返回原始 content，因为那会被当作 HTML 直接插入导致显示原始 Markdown 文本
    return {
      contentHtml: null,
      reasoningHtml: payload.reasoning ? null : undefined,
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
