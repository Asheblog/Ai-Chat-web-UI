import { renderMarkdownToHtml } from '@/lib/markdown-pipeline'
import rehypeKatex from 'rehype-katex'

interface WorkerRequest {
  jobId: string
  messageId: string | number
  content: string
  reasoning?: string
  contentVersion: number
  reasoningVersion: number
  isStreaming?: boolean
}

interface WorkerResponse {
  jobId: string
  messageId: string
  contentHtml: string
  reasoningHtml?: string
  contentVersion: number
  reasoningVersion: number
  errored?: boolean
  errorMessage?: string
}

const escapeHtml = (input: string) =>
  input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

// ---------------------------------------------------------------------------
// mhchem 懒加载（仅在 Worker 中处理，因为主线程已通过 load-katex 处理）
// ---------------------------------------------------------------------------
let mhchemReady = false
let mhchemLoading: Promise<void> | null = null

const ensureMhchem = async () => {
  if (mhchemReady) return
  if (mhchemLoading) {
    await mhchemLoading
    return
  }
  mhchemLoading = import('katex/contrib/mhchem')
    .then(() => {
      mhchemReady = true
    })
    .catch((error) => {
      if (typeof console !== 'undefined') {
        // eslint-disable-next-line no-console
        console.warn(
          '[markdown-worker] mhchem unavailable, continue without chemistry extension',
          error,
        )
      }
    })
    .finally(() => {
      mhchemLoading = null
    })

  await mhchemLoading
}

const renderMarkdown = async (
  markdown: string,
  isStreaming?: boolean,
): Promise<{ html: string }> => {
  await ensureMhchem()
  // renderMarkdownToHtml 是同步函数，但 mhchem 需要异步加载
  return renderMarkdownToHtml(markdown, {
    isStreaming,
    rehypeKatexPlugin: rehypeKatex,
  })
}

// ---------------------------------------------------------------------------
// Job batching & scheduling（Worker 专有逻辑，无修改）
// ---------------------------------------------------------------------------
const BATCH_WINDOW_MS = 36
const pendingByMessage = new Map<string, WorkerRequest>()
const deferredByMessage = new Map<string, WorkerRequest>()
const processingMessages = new Set<string>()
let flushTimer: ReturnType<typeof setTimeout> | null = null
const toMessageKey = (messageId: WorkerRequest['messageId']) => String(messageId)

const postSupersededJob = (payload: WorkerRequest) => {
  const response: WorkerResponse = {
    jobId: payload.jobId,
    messageId: toMessageKey(payload.messageId),
    contentHtml: '',
    reasoningHtml: payload.reasoning ? '' : undefined,
    contentVersion: -1,
    reasoningVersion: -1,
  }
  self.postMessage(response)
}

const scheduleFlush = () => {
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    const jobs = Array.from(pendingByMessage.values())
    pendingByMessage.clear()
    jobs.forEach((job) => {
      void processJob(job)
    })
  }, BATCH_WINDOW_MS)
}

const queueJob = (payload: WorkerRequest) => {
  const messageKey = toMessageKey(payload.messageId)
  const previous = pendingByMessage.get(messageKey)
  if (previous && previous.jobId !== payload.jobId) {
    postSupersededJob(previous)
  }
  pendingByMessage.set(messageKey, payload)
  scheduleFlush()
}

const processJob = async (payload: WorkerRequest) => {
  const messageKey = toMessageKey(payload.messageId)
  if (processingMessages.has(messageKey)) {
    const previous = deferredByMessage.get(messageKey)
    if (previous && previous.jobId !== payload.jobId) {
      postSupersededJob(previous)
    }
    deferredByMessage.set(messageKey, payload)
    return
  }
  processingMessages.add(messageKey)

  const {
    jobId,
    messageId,
    content,
    reasoning,
    contentVersion,
    reasoningVersion,
    isStreaming,
  } = payload
  const responseMessageId = toMessageKey(messageId)

  try {
    const contentResult = await renderMarkdown(content || '', isStreaming)
    const response: WorkerResponse = {
      jobId,
      messageId: responseMessageId,
      contentHtml: contentResult.html,
      contentVersion,
      reasoningVersion,
    }

    if (reasoning) {
      const reasoningResult = await renderMarkdown(reasoning, isStreaming)
      response.reasoningHtml = reasoningResult.html
    }

    self.postMessage(response)
  } catch (error: any) {
    const response: WorkerResponse = {
      jobId,
      messageId: responseMessageId,
      contentHtml: `<pre>${escapeHtml(content || '')}</pre>`,
      contentVersion,
      reasoningVersion,
      errored: true,
      errorMessage: error?.message || '渲染失败',
    }
    if (reasoning) {
      response.reasoningHtml = `<pre>${escapeHtml(reasoning)}</pre>`
    }
    self.postMessage(response)
  } finally {
    processingMessages.delete(messageKey)
    const deferred = deferredByMessage.get(messageKey)
    if (deferred) {
      deferredByMessage.delete(messageKey)
      queueJob(deferred)
    }
  }
}

self.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  const payload = event.data
  if (!payload || typeof payload.jobId !== 'string') {
    return
  }
  if (
    typeof payload.messageId !== 'string' &&
    typeof payload.messageId !== 'number'
  ) {
    return
  }
  queueJob(payload)
})
