/**
 * 文本分块服务
 * 参考 LangChain 的 RecursiveCharacterTextSplitter 实现
 */

export interface TextChunk {
  content: string
  index: number
  metadata: {
    startChar: number
    endChar: number
    [key: string]: unknown
  }
}

export interface ChunkingOptions {
  /**
   * 分块大小（字符数）
   */
  chunkSize: number

  /**
   * 分块重叠（字符数）
   */
  chunkOverlap: number

  /**
   * 分隔符列表（按优先级排序）
   */
  separators?: string[]
}

const DEFAULT_SEPARATORS = ['\n\n', '\n', '。', '！', '？', '.', '!', '?', ' ', '']

/**
 * 递归字符文本分割器
 */
export class RecursiveCharacterTextSplitter {
  private chunkSize: number
  private chunkOverlap: number
  private separators: string[]

  constructor(options: ChunkingOptions) {
    this.chunkSize = options.chunkSize
    this.chunkOverlap = options.chunkOverlap
    this.separators = options.separators || DEFAULT_SEPARATORS

    if (this.chunkOverlap >= this.chunkSize) {
      throw new Error('chunkOverlap must be less than chunkSize')
    }
  }

  /**
   * 分割文本
   */
  split(text: string): TextChunk[] {
    const chunks = this.splitText(text, this.separators)
    return this.mergeChunks(chunks, text)
  }

  private splitText(text: string, separators: string[]): string[] {
    const finalChunks: string[] = []

    // 找到适用的分隔符
    let separator = separators[separators.length - 1]
    let newSeparators: string[] = []

    for (let i = 0; i < separators.length; i++) {
      const sep = separators[i]
      if (sep === '') {
        separator = sep
        break
      }
      if (text.includes(sep)) {
        separator = sep
        newSeparators = separators.slice(i + 1)
        break
      }
    }

    // 使用分隔符分割
    const splits = separator ? text.split(separator) : Array.from(text)

    // 处理每个分割片段
    let goodSplits: string[] = []
    const mergeSeparator = separator === '' ? '' : separator

    for (const s of splits) {
      if (s.length < this.chunkSize) {
        goodSplits.push(s)
      } else {
        if (goodSplits.length > 0) {
          const mergedText = this.mergeSplits(goodSplits, mergeSeparator)
          finalChunks.push(...mergedText)
          goodSplits = []
        }

        if (newSeparators.length === 0) {
          finalChunks.push(s)
        } else {
          const otherChunks = this.splitText(s, newSeparators)
          finalChunks.push(...otherChunks)
        }
      }
    }

    if (goodSplits.length > 0) {
      const mergedText = this.mergeSplits(goodSplits, mergeSeparator)
      finalChunks.push(...mergedText)
    }

    return finalChunks
  }

  private mergeSplits(splits: string[], separator: string): string[] {
    const docs: string[] = []
    const currentDoc: string[] = []
    let total = 0

    for (const d of splits) {
      const len = d.length
      const sepLen = currentDoc.length > 0 ? separator.length : 0

      if (total + len + sepLen > this.chunkSize) {
        if (total > this.chunkSize) {
          console.warn(
            `Created a chunk of size ${total}, which is longer than the specified ${this.chunkSize}`
          )
        }

        if (currentDoc.length > 0) {
          const doc = currentDoc.join(separator)
          if (doc.trim()) {
            docs.push(doc)
          }

          // 保留重叠部分
          while (total > this.chunkOverlap || (total > 0 && total + len + sepLen > this.chunkSize)) {
            const removed = currentDoc.shift()
            if (removed) {
              total -= removed.length + (currentDoc.length > 0 ? separator.length : 0)
            }
          }
        }
      }

      currentDoc.push(d)
      total += len + (currentDoc.length > 1 ? separator.length : 0)
    }

    if (currentDoc.length > 0) {
      const doc = currentDoc.join(separator)
      if (doc.trim()) {
        docs.push(doc)
      }
    }

    return docs
  }

  private mergeChunks(chunks: string[], originalText: string): TextChunk[] {
    const result: TextChunk[] = []
    let currentPos = 0

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]

      // 找到这个chunk在原文中的位置
      const startPos = originalText.indexOf(chunk, currentPos)
      const actualStart = startPos >= 0 ? startPos : currentPos
      const endPos = actualStart + chunk.length

      result.push({
        content: chunk,
        index: i,
        metadata: {
          startChar: actualStart,
          endChar: endPos,
        },
      })

      // 考虑重叠，下一次搜索从重叠位置开始
      currentPos = Math.max(actualStart + 1, endPos - this.chunkOverlap)
    }

    return result
  }
}

/**
 * 简化的分块函数
 */
export function splitText(
  text: string,
  options: ChunkingOptions = { chunkSize: 1500, chunkOverlap: 100 }
): TextChunk[] {
  const splitter = new RecursiveCharacterTextSplitter(options)
  return splitter.split(text)
}

/**
 * 流式分块生成器（增量产出 chunk，避免一次性持有全部 chunk/embedding）
 *
 * 规则：
 * - 每次取 [pos, pos+chunkSize] 窗口
 * - 在窗口内按 separators 的优先级寻找最后一个分隔符作为切点
 * - 若找不到分隔符则硬切 chunkSize
 * - 下一段从 cut - chunkOverlap 开始
 */
export function* iterateTextChunks(
  text: string,
  options: ChunkingOptions = { chunkSize: 1500, chunkOverlap: 100 }
): Generator<TextChunk> {
  const chunkSize = options.chunkSize
  const chunkOverlap = options.chunkOverlap
  const separators = options.separators || DEFAULT_SEPARATORS

  if (chunkOverlap >= chunkSize) {
    throw new Error('chunkOverlap must be less than chunkSize')
  }

  const totalLen = text.length
  let pos = 0
  let index = 0

  while (pos < totalLen) {
    const windowEnd = Math.min(totalLen, pos + chunkSize)
    let cut = windowEnd

    for (const sep of separators) {
      if (!sep) continue
      const last = text.lastIndexOf(sep, windowEnd)
      if (last > pos) {
        cut = last + sep.length
        break
      }
    }

    if (cut <= pos) {
      cut = windowEnd
    }

    const chunkText = text.slice(pos, cut)
    if (chunkText.trim()) {
      yield {
        content: chunkText,
        index,
        metadata: {
          startChar: pos,
          endChar: cut,
        },
      }
      index++
    }

    if (cut >= totalLen) {
      break
    }

    // 保留 overlap，且确保前进至少 1 字符避免死循环
    pos = Math.max(cut - chunkOverlap, pos + 1)
  }
}

/**
 * 估算 token 数量（简单估算：中文1字≈1.5token，英文4字符≈1token）
 */
export function estimateTokenCount(text: string): number {
  let count = 0

  for (const char of text) {
    // CJK字符范围
    if (/[\u4e00-\u9fff\u3400-\u4dbf\u3000-\u303f]/.test(char)) {
      count += 1.5
    } else {
      count += 0.25
    }
  }

  return Math.ceil(count)
}

/**
 * 页面内容定义
 */
export interface PageContent {
  pageContent: string
  pageNumber: number
  metadata?: Record<string, unknown>
}

/**
 * 带页码的文本分块
 */
export interface PageAwareTextChunk extends TextChunk {
  metadata: TextChunk['metadata'] & {
    pageNumber: number
    pageStart?: number // chunk 开始的页码
    pageEnd?: number // chunk 结束的页码（跨页时）
  }
}

/**
 * 按页分块生成器
 * 对每个页面独立分块，保留页码信息
 *
 * 策略：
 * - 每页独立分块，不跨页合并
 * - 如果单页内容小于 chunkSize，整页作为一个 chunk
 * - 如果单页内容大于 chunkSize，在页内分块
 * - 每个 chunk 的 metadata 包含 pageNumber
 */
export function* iteratePageAwareChunks(
  pages: PageContent[],
  options: ChunkingOptions = { chunkSize: 1500, chunkOverlap: 100 }
): Generator<PageAwareTextChunk> {
  const chunkSize = options.chunkSize
  const chunkOverlap = options.chunkOverlap
  const separators = options.separators || DEFAULT_SEPARATORS

  if (chunkOverlap >= chunkSize) {
    throw new Error('chunkOverlap must be less than chunkSize')
  }

  let globalIndex = 0

  for (const page of pages) {
    const pageText = page.pageContent
    const pageNumber = page.pageNumber

    // 跳过空页
    if (!pageText.trim()) {
      continue
    }

    // 如果页面内容小于等于 chunkSize，整页作为一个 chunk
    if (pageText.length <= chunkSize) {
      yield {
        content: pageText,
        index: globalIndex++,
        metadata: {
          startChar: 0,
          endChar: pageText.length,
          pageNumber,
          pageStart: pageNumber,
          pageEnd: pageNumber,
          ...page.metadata,
        },
      }
      continue
    }

    // 页面内容大于 chunkSize，在页内分块
    let pos = 0
    const totalLen = pageText.length

    while (pos < totalLen) {
      const windowEnd = Math.min(totalLen, pos + chunkSize)
      let cut = windowEnd

      // 在窗口内按分隔符优先级寻找最后一个分隔符作为切点
      for (const sep of separators) {
        if (!sep) continue
        const last = pageText.lastIndexOf(sep, windowEnd)
        if (last > pos) {
          cut = last + sep.length
          break
        }
      }

      if (cut <= pos) {
        cut = windowEnd
      }

      const chunkText = pageText.slice(pos, cut)
      if (chunkText.trim()) {
        yield {
          content: chunkText,
          index: globalIndex++,
          metadata: {
            startChar: pos,
            endChar: cut,
            pageNumber,
            pageStart: pageNumber,
            pageEnd: pageNumber,
            ...page.metadata,
          },
        }
      }

      if (cut >= totalLen) {
        break
      }

      // 保留 overlap，且确保前进至少 1 字符避免死循环
      pos = Math.max(cut - chunkOverlap, pos + 1)
    }
  }
}

/**
 * 智能分块策略配置
 * 根据文档类型返回最优的分块参数
 */
export interface SmartChunkingConfig {
  chunkSize: number
  chunkOverlap: number
  separators: string[]
}

/**
 * 根据文档类型获取最优分块参数
 * 
 * @param mimeType 文档的 MIME 类型
 * @param filename 文件名（用于扩展名检测）
 * @returns 优化后的分块配置
 */
export function getSmartChunkingConfig(
  mimeType: string,
  filename: string
): SmartChunkingConfig {
  const ext = filename.split('.').pop()?.toLowerCase() || ''

  // 代码文件：较大的 chunkSize，保持函数完整性
  if (
    ['js', 'ts', 'jsx', 'tsx', 'py', 'java', 'css', 'html', 'json', 'md'].includes(ext) ||
    mimeType.includes('javascript') ||
    mimeType.includes('typescript') ||
    mimeType.includes('python')
  ) {
    return {
      chunkSize: 2000,
      chunkOverlap: 200,
      separators: ['\n\n', '\nfunction ', '\nclass ', '\ndef ', '\n// ', '\n# ', '\n'],
    }
  }

  // CSV/表格：较小的 chunkSize，每行独立
  if (ext === 'csv' || mimeType.includes('csv')) {
    return {
      chunkSize: 500,
      chunkOverlap: 50,
      separators: ['\n'],
    }
  }

  // 法律/合同文档：中等 chunkSize，按条款分割
  // 可通过文件名关键词检测
  if (
    filename.toLowerCase().includes('合同') ||
    filename.toLowerCase().includes('contract') ||
    filename.toLowerCase().includes('协议') ||
    filename.toLowerCase().includes('agreement')
  ) {
    return {
      chunkSize: 1000,
      chunkOverlap: 100,
      separators: ['\n\n', '\n第', '\n（', '\n一、', '\n二、', '\n三、', '\n'],
    }
  }

  // PDF/报告：默认配置
  if (mimeType === 'application/pdf') {
    return {
      chunkSize: 1500,
      chunkOverlap: 150,
      separators: DEFAULT_SEPARATORS,
    }
  }

  // 默认配置
  return {
    chunkSize: 1500,
    chunkOverlap: 100,
    separators: DEFAULT_SEPARATORS,
  }
}

/**
 * 提取内容锚点（用于快速定位）
 * 返回内容的前几个有意义的词
 */
export function extractAnchor(content: string, maxLength: number = 40): string {
  const trimmed = content.trim()
  if (trimmed.length <= maxLength) {
    return trimmed
  }

  // 尝试在词边界截断
  const truncated = trimmed.substring(0, maxLength)
  const lastSpace = truncated.lastIndexOf(' ')
  const lastPunctuation = Math.max(
    truncated.lastIndexOf('。'),
    truncated.lastIndexOf('，'),
    truncated.lastIndexOf('.'),
    truncated.lastIndexOf(',')
  )

  const cutPoint = Math.max(lastSpace, lastPunctuation, maxLength - 10)
  return truncated.substring(0, cutPoint) + '...'
}

/**
 * 计算内容在页面中的位置
 */
export function calculatePagePosition(
  chunkStartChar: number,
  chunkEndChar: number,
  totalPageChars: number
): 'top' | 'middle' | 'bottom' {
  const midpoint = (chunkStartChar + chunkEndChar) / 2
  const relativePosition = midpoint / totalPageChars

  if (relativePosition < 0.33) {
    return 'top'
  } else if (relativePosition > 0.67) {
    return 'bottom'
  }
  return 'middle'
}
