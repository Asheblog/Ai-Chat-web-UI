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
