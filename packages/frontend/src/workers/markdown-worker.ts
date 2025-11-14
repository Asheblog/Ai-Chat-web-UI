import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkRehype from 'remark-rehype'
import rehypeStringify from 'rehype-stringify'
import rehypeHighlight from 'rehype-highlight'
import rehypeKatex from 'rehype-katex'
import { visit } from 'unist-util-visit'
import 'katex/contrib/mhchem'

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

const blockSplitRegex = /((?:\r?\n){2,})/
const newlineRunMatcher = /^(\r?\n){2,}$/
const mathDelimiterRegex = /(\$\$?|\\\(|\\\[)/
const mathEnvironmentRegex =
  /\\begin\{(?:aligned|align|array|cases|matrix|pmatrix|bmatrix|vmatrix|Vmatrix|split|equation)\}/
const greekLetterRegex =
  /\\(?:alpha|beta|gamma|delta|epsilon|theta|vartheta|lambda|mu|nu|xi|rho|sigma|tau|upsilon|phi|varphi|chi|psi|omega|pi)/g
const chemicalMacroRegex = /\\(?:ce|pu)\{[^}]+\}/
const likelyMathMacros = [
  '\\frac',
  '\\int',
  '\\sum',
  '\\sqrt',
  '\\prod',
  '\\lim',
  '\\log',
  '\\sin',
  '\\cos',
  '\\tan',
  '\\sec',
  '\\csc',
  '\\cot',
  '\\arcsin',
  '\\arccos',
  '\\arctan',
  '\\ce',
  '\\pu',
  '\\text',
  '\\operatorname',
  '\\begin{equation}',
]
const blockContextRegex = /^\s*(?:>|\d+\.\s|[-*+]\s)/

const hasExistingMathDelimiters = (segment: string) => mathDelimiterRegex.test(segment)
const containsCodeFence = (segment: string) => /```|~~~/.test(segment)
const containsUrl = (segment: string) => /https?:\/\//i.test(segment)

const hasEnoughMathHints = (segment: string) => {
  if (mathEnvironmentRegex.test(segment)) return true
  const macroHits = likelyMathMacros.reduce((acc, macro) => (segment.includes(macro) ? acc + 1 : acc), 0)
  if (macroHits >= 2) return true
  if (macroHits === 0) return false
  const greekHits = (segment.match(greekLetterRegex) || []).length
  if (greekHits > 0) return true
  if (/\\frac\{[^}]+\}\{[^}]+\}/.test(segment) && (segment.includes('\\sqrt') || segment.includes('\\int') || segment.includes('\\sum'))) {
    return true
  }
  if (chemicalMacroRegex.test(segment)) return true
  const exponentOrSubscript = (segment.match(/[\^_]\s*\\?[a-zA-Z]/g) || []).length
  return exponentOrSubscript > 0
}

const shouldWrapSegment = (segment: string) => {
  const trimmed = segment.trim()
  if (!trimmed) return false
  if (blockContextRegex.test(trimmed)) return false
  if (hasExistingMathDelimiters(segment)) return false
  if (containsCodeFence(segment)) return false
  if (containsUrl(segment)) return false
  const slashCount = (segment.match(/\\/g) || []).length
  if (slashCount < 2) return false
  return hasEnoughMathHints(segment)
}

const wrapSegment = (segment: string) => {
  const leading = segment.match(/^\s*/)?.[0] ?? ''
  const trailing = segment.match(/\s*$/)?.[0] ?? ''
  const core = segment.trim()
  if (!core) return segment
  const normalizedCore = core.replace(/\r/g, '').replace(/\u00a0/g, ' ')
  return `${leading}$$\n${normalizedCore}\n$$${trailing}`
}

const wrapBareMathBlocks = (markdown: string) => {
  if (!markdown) return markdown
  const parts = markdown.split(blockSplitRegex)
  if (parts.length === 1) {
    return shouldWrapSegment(parts[0]) ? wrapSegment(parts[0]) : markdown
  }
  const result: string[] = []
  for (let i = 0; i < parts.length; i++) {
    const segment = parts[i]
    if (!segment) {
      result.push(segment)
      continue
    }
    if (i % 2 === 1 && newlineRunMatcher.test(segment)) {
      result.push(segment)
      continue
    }
    result.push(shouldWrapSegment(segment) ? wrapSegment(segment) : segment)
  }
  return result.join('')
}

const createProcessor = (skipHighlight: boolean) => {
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    .use(remarkRehype)
    .use(rehypeKatex, { strict: false })
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
    const normalized = wrapBareMathBlocks(trimmed)
    const file = await processor.process(normalized)
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
