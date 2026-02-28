import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkRehype from 'remark-rehype'
import rehypeRaw from 'rehype-raw'
import rehypeStringify from 'rehype-stringify'
import rehypeKatex from 'rehype-katex'
import { visit } from 'unist-util-visit'
import {
  remarkKatexTokenizer,
  defaultRemarkMathOptions,
  encodeLatexPlaceholders,
} from '@aichat/shared/latex-normalizer'

interface WorkerRequest {
  jobId: string
  messageId: string
  content: string
  reasoning?: string
  contentVersion: number
  reasoningVersion: number
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

const CODE_BLOCK_MARKER_PREFIX = 'AICHAT_CODE_BLOCK:'

const escapeHtml = (input: string) =>
  input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

const encodeBase64Url = (value: string) => {
  try {
    // browser / worker
    const bytes = new TextEncoder().encode(value)
    let binary = ''
    bytes.forEach((b) => {
      binary += String.fromCharCode(b)
    })
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
  } catch {
    // node fallback (vitest/ssr)
    const buf = (globalThis as any).Buffer
    if (!buf) {
      throw new Error('Base64 encoding not supported')
    }
    return buf.from(value, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
  }
}

const extractText = (node: any): string => {
  if (!node) return ''
  if (node.type === 'text' && typeof node.value === 'string') {
    return node.value
  }
  if (Array.isArray(node.children)) {
    return node.children.map(extractText).join('')
  }
  return ''
}

const extractCodeBlocks = () => (tree: any) => {
  visit(tree, 'element', (node: any, index: number | undefined, parent: any) => {
    if (!parent || typeof index !== 'number') return
    if (node?.tagName !== 'pre' || !Array.isArray(node.children)) return
    const codeNode = node.children.find((child: any) => child?.type === 'element' && child?.tagName === 'code') ?? null
    if (!codeNode) return

    const classNameRaw = codeNode.properties?.className
    const cls = Array.isArray(classNameRaw) ? classNameRaw.join(' ') : String(classNameRaw || '')
    const match = /language-([\w+-]+)/i.exec(cls)
    const language = match ? match[1] : ''
    const code = extractText(codeNode).replace(/\n$/, '')

    const encoded = encodeBase64Url(JSON.stringify({ language, code }))
    parent.children[index] = { type: 'comment', value: `${CODE_BLOCK_MARKER_PREFIX}${encoded}` }
  })
}

const enhanceNodes = () => (tree: any) => {
  visit(tree, 'element', (node: any) => {
    if (node.tagName === 'a') {
      node.properties = node.properties || {}
      node.properties.target = '_blank'
      node.properties.rel = 'noopener noreferrer'
      return
    }
    if (node.tagName === 'pre') {
      node.properties = node.properties || {}
      const cls = node.properties.className || []
      node.properties.className = Array.isArray(cls)
        ? Array.from(new Set([...cls, 'md-pre']))
        : `${cls || ''} md-pre`.trim()
    }
    if (node.tagName === 'code') {
      node.properties = node.properties || {}
      const cls = node.properties.className || []
      node.properties.className = Array.isArray(cls)
        ? Array.from(new Set([...cls, 'md-code']))
        : `${cls || ''} md-code`.trim()
    }
  })
}

const createProcessor = () => {
  const processor = unified()
    .use(remarkParse)
    .use(remarkKatexTokenizer)
    .use(remarkMath, defaultRemarkMathOptions)
    .use(remarkGfm)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypeKatex, { strict: false })
    .use(extractCodeBlocks)
    .use(enhanceNodes)
    .use(rehypeStringify)
  return processor
}
let cachedProcessor: ReturnType<typeof createProcessor> | null = null

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
      // Worker 环境下个别打包/运行时会触发 document 相关错误，降级为不启用 mhchem。
      if (typeof console !== 'undefined') {
        // eslint-disable-next-line no-console
        console.warn('[markdown-worker] mhchem unavailable, continue without chemistry extension', error)
      }
    })
    .finally(() => {
      mhchemLoading = null
    })

  await mhchemLoading
}

const renderMarkdown = async (markdown: string): Promise<{ html: string }> => {
  const trimmed = markdown.trim()
  if (trimmed.length === 0) {
    return { html: '' }
  }
  try {
    await ensureMhchem()
    if (!cachedProcessor) {
      cachedProcessor = createProcessor()
    }
    const processor = cachedProcessor
    const prepared = encodeLatexPlaceholders(trimmed)
    const file = await processor.process(prepared)
    return { html: String(file) }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[markdown-worker] render failed', error)
    return { html: `<pre>${escapeHtml(trimmed)}</pre>` }
  }
}

const BATCH_WINDOW_MS = 36
const pendingByMessage = new Map<string, WorkerRequest>()
const deferredByMessage = new Map<string, WorkerRequest>()
const processingMessages = new Set<string>()
let flushTimer: ReturnType<typeof setTimeout> | null = null

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
  pendingByMessage.set(payload.messageId, payload)
  scheduleFlush()
}

const processJob = async (payload: WorkerRequest) => {
  if (processingMessages.has(payload.messageId)) {
    deferredByMessage.set(payload.messageId, payload)
    return
  }
  processingMessages.add(payload.messageId)

  const { jobId, messageId, content, reasoning, contentVersion, reasoningVersion } = payload

  try {
    const contentResult = await renderMarkdown(content || '')
    const response: WorkerResponse = {
      jobId,
      messageId,
      contentHtml: contentResult.html,
      contentVersion,
      reasoningVersion,
    }

    if (reasoning) {
      const reasoningResult = await renderMarkdown(reasoning)
      response.reasoningHtml = reasoningResult.html
    }

    self.postMessage(response)
  } catch (error: any) {
    const response: WorkerResponse = {
      jobId,
      messageId,
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
    processingMessages.delete(messageId)
    const deferred = deferredByMessage.get(messageId)
    if (deferred) {
      deferredByMessage.delete(messageId)
      queueJob(deferred)
    }
  }
}

self.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  const payload = event.data
  if (!payload || typeof payload.jobId !== 'string' || typeof payload.messageId !== 'string') {
    return
  }
  queueJob(payload)
})
