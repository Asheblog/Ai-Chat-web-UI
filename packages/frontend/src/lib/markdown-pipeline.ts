/**
 * 共享的 Markdown → HTML 渲染管线
 *
 * 抽取自 markdown-worker.ts 的 unified/remark/rehype 处理链，
 * 确保 Worker 和主线程降级路径产生 **完全一致** 的 HTML 输出，
 * 包括相同的 CSS 类名（md-pre / md-code）、代码块 marker、链接属性等。
 */
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkRehype from 'remark-rehype'
import rehypeRaw from 'rehype-raw'
import rehypeStringify from 'rehype-stringify'
import { visit } from 'unist-util-visit'
import {
  remarkKatexTokenizer,
  defaultRemarkMathOptions,
  encodeLatexPlaceholders,
} from '@aichat/shared/latex-normalizer'
import { rehypeLinkBoundaries } from '@/lib/markdown-link-boundary'
import { closeOpenMarkdownBlocks } from '@/lib/markdown-streaming'

// ---------------------------------------------------------------------------
// Code block marker (与 worker 保持一致)
// ---------------------------------------------------------------------------
const CODE_BLOCK_MARKER_PREFIX = 'AICHAT_CODE_BLOCK:'

const escapeHtml = (input: string) =>
  input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

const encodeBase64Url = (value: string) => {
  try {
    const bytes = new TextEncoder().encode(value)
    let binary = ''
    bytes.forEach((b) => {
      binary += String.fromCharCode(b)
    })
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
  } catch {
    const buf = (globalThis as any).Buffer
    if (!buf) throw new Error('Base64 encoding not supported')
    return buf
      .from(value, 'utf8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '')
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

// ---------------------------------------------------------------------------
// rehype 插件：将 <pre><code> 替换为 HTML 注释 marker
// ---------------------------------------------------------------------------
const extractCodeBlocks = () => (tree: any) => {
  visit(tree, 'element', (node: any, index: number | undefined, parent: any) => {
    if (!parent || typeof index !== 'number') return
    if (node?.tagName !== 'pre' || !Array.isArray(node.children)) return
    const codeNode =
      node.children.find(
        (child: any) => child?.type === 'element' && child?.tagName === 'code',
      ) ?? null
    if (!codeNode) return

    const classNameRaw = codeNode.properties?.className
    const cls = Array.isArray(classNameRaw)
      ? classNameRaw.join(' ')
      : String(classNameRaw || '')
    const match = /language-([\w+-]+)/i.exec(cls)
    const language = match ? match[1] : ''
    const code = extractText(codeNode).replace(/\n$/, '')

    const encoded = encodeBase64Url(JSON.stringify({ language, code }))
    parent.children[index] = {
      type: 'comment',
      value: `${CODE_BLOCK_MARKER_PREFIX}${encoded}`,
    }
  })
}

// ---------------------------------------------------------------------------
// rehype 插件：给 a / pre / code 添加统一的 CSS 类和属性
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// 构建 unified processor（可注入 rehypeKatex 插件）
// ---------------------------------------------------------------------------
export const createMarkdownProcessor = (rehypeKatexPlugin?: any) => {
  const processor = unified()
    .use(remarkParse)
    .use(remarkKatexTokenizer)
    .use(remarkMath, defaultRemarkMathOptions)
    .use(remarkGfm)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)

  if (rehypeKatexPlugin) {
    processor.use(rehypeKatexPlugin, { strict: false })
  }

  return processor
    .use(rehypeLinkBoundaries)
    .use(extractCodeBlocks)
    .use(enhanceNodes)
    .use(rehypeStringify)
}

// ---------------------------------------------------------------------------
// 渲染 Markdown → HTML（主线程同步版本）
// ---------------------------------------------------------------------------
export interface RenderResult {
  html: string
}

let cachedProcessor: ReturnType<typeof createMarkdownProcessor> | null = null
let cachedProcessorWithKatex: ReturnType<typeof createMarkdownProcessor> | null = null

export const renderMarkdownToHtml = (
  markdown: string,
  options?: {
    isStreaming?: boolean
    rehypeKatexPlugin?: any
  },
): RenderResult => {
  const { isStreaming = false, rehypeKatexPlugin } = options ?? {}

  const preparedMarkdown = isStreaming
    ? closeOpenMarkdownBlocks(markdown)
    : markdown
  const trimmed = preparedMarkdown.trim()
  if (trimmed.length === 0) {
    return { html: '' }
  }

  try {
    // 按是否有 KaTeX 插件分别缓存 processor
    if (rehypeKatexPlugin) {
      if (!cachedProcessorWithKatex) {
        cachedProcessorWithKatex = createMarkdownProcessor(rehypeKatexPlugin)
      }
      const file = cachedProcessorWithKatex.processSync(
        encodeLatexPlaceholders(trimmed),
      )
      return { html: String(file) }
    }

    if (!cachedProcessor) {
      cachedProcessor = createMarkdownProcessor()
    }
    const file = cachedProcessor.processSync(
      encodeLatexPlaceholders(trimmed),
    )
    return { html: String(file) }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[markdown-pipeline] render failed', error)
    return { html: `<pre>${escapeHtml(trimmed)}</pre>` }
  }
}
