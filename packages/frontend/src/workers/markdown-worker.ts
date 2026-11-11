import { renderMarkdownToHtml } from '@/lib/markdown-pipeline'
import { containsMath } from '@/lib/markdown-math'

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
// KaTeX 懒加载
//
// KaTeX + rehype-katex 是 Worker 里最大的依赖（构建产物以 MB 计）。静态导入会
// 把它塞进 Worker 首包，弱网下 ready 握手轻松超过初始化预算，整条 Markdown 链路
// 都会降级成纯文本。这里只在正文真的含公式时才按需加载；加载失败也只损失公式，
// 普通 Markdown 照常渲染。
// ---------------------------------------------------------------------------
let mathPlugin: any = null
let mathReady = false
let mathLoading: Promise<any | null> | null = null

const loadMathPipeline = (): Promise<any | null> => {
  if (mathReady) return Promise.resolve(mathPlugin)
  if (mathLoading) return mathLoading
  mathLoading = Promise.all([
    import('rehype-katex'),
    import('katex/contrib/mhchem'),
  ])
    .then(([rehypeKatexModule]) => {
      mathPlugin = rehypeKatexModule.default ?? rehypeKatexModule
      mathReady = true
      return mathPlugin
    })
    .catch(() => {
      // 失败不缓存：下次含公式的渲染仍可重试，普通 Markdown 不受影响。
      console.warn('[markdown-worker] math-renderer-unavailable')
      return null
    })
    .finally(() => {
      mathLoading = null
    })
  return mathLoading
}

const renderMarkdown = async (
  markdown: string,
  isStreaming?: boolean,
): Promise<{ html: string }> => {
  const rehypeKatexPlugin = containsMath(markdown) ? await loadMathPipeline() : null
  return renderMarkdownToHtml(markdown, {
    isStreaming,
    rehypeKatexPlugin: rehypeKatexPlugin ?? undefined,
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
      errorMessage: 'render-failed',
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

// Static dependencies initialized before the client can submit work.
self.postMessage({ type: 'ready' })
