import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkRehype from 'remark-rehype'
import rehypeRaw from 'rehype-raw'
import rehypeStringify from 'rehype-stringify'
import rehypeKatex from 'rehype-katex'
import { visit } from 'unist-util-visit'
import 'katex/contrib/mhchem'
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

const renderMarkdown = async (markdown: string): Promise<{ html: string }> => {
  const trimmed = markdown.trim()
  if (trimmed.length === 0) {
    return { html: '' }
  }
  try {
    const processor = createProcessor()
    const prepared = encodeLatexPlaceholders(trimmed)
    const file = await processor.process(prepared)
    return { html: String(file) }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[markdown-worker] render failed', error)
    return { html: `<pre>${escapeHtml(trimmed)}</pre>` }
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
