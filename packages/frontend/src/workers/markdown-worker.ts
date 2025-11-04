import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkRehype from 'remark-rehype'
import rehypeStringify from 'rehype-stringify'
import rehypeHighlight from 'rehype-highlight'
import { visit } from 'unist-util-visit'

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

const escapeHtml = (input: string) =>
  input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

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

const createProcessor = (skipHighlight: boolean) => {
  const processor = unified().use(remarkParse).use(remarkGfm).use(remarkRehype)
  if (!skipHighlight) {
    processor.use(rehypeHighlight as any, { ignoreMissing: true })
  }
  processor.use(enhanceNodes).use(rehypeStringify)
  return processor
}

const renderMarkdown = async (markdown: string): Promise<{ html: string; skipHighlight: boolean }> => {
  const trimmed = markdown.trim()
  if (trimmed.length === 0) {
    return { html: '', skipHighlight: false }
  }
  const lineCount = trimmed.split(/\r?\n/).length
  const skipHighlight = trimmed.length > 20000 || lineCount > 400
  try {
    const processor = createProcessor(skipHighlight)
    const file = await processor.process(trimmed)
    return { html: String(file), skipHighlight }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[markdown-worker] render failed', error)
    return { html: `<pre>${escapeHtml(trimmed)}</pre>`, skipHighlight }
  }
}

self.addEventListener('message', async (event: MessageEvent<WorkerRequest>) => {
  const payload = event.data
  if (!payload || typeof payload.jobId !== 'string') {
    return
  }

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
  }
})
