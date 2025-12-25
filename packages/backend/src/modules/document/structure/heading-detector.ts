/**
 * 启发式标题检测器
 * 基于文本模式识别章节标题
 */

import type { ChunkWithMetadata, DocumentSection } from './types'

export interface HeadingCandidate {
  text: string;
  chunkIndex: number;
  pageNumber?: number;
  level: number;
  confidence: number;
  pattern: string;
}

// 中文数字映射
const CHINESE_NUMBERS: Record<string, number> = {
  '一': 1, '二': 2, '三': 3, '四': 4, '五': 5,
  '六': 6, '七': 7, '八': 8, '九': 9, '十': 10,
  '十一': 11, '十二': 12, '十三': 13, '十四': 14, '十五': 15,
  '十六': 16, '十七': 17, '十八': 18, '十九': 19, '二十': 20,
}

// 标题模式定义
const HEADING_PATTERNS = [
  // 1级标题: 第X章, Chapter X
  {
    regex: /^第([一二三四五六七八九十百千]+)章[\s\.:：]*(.*)/,
    level: 1,
    pattern: 'chinese_chapter',
    confidence: 0.95,
  },
  {
    regex: /^Chapter\s+(\d+)[\s\.:：]*(.*)/i,
    level: 1,
    pattern: 'english_chapter',
    confidence: 0.95,
  },
  {
    regex: /^(\d+)\s+([A-Z][a-zA-Z\s]{3,50})$/,
    level: 1,
    pattern: 'numbered_title',
    confidence: 0.85,
  },
  
  // 2级标题: X.Y, 第X节
  {
    regex: /^(\d+)\.(\d+)[\s\.:：]+(.+)/,
    level: 2,
    pattern: 'decimal_section',
    confidence: 0.9,
  },
  {
    regex: /^第([一二三四五六七八九十百千]+)节[\s\.:：]*(.*)/,
    level: 2,
    pattern: 'chinese_section',
    confidence: 0.9,
  },
  {
    regex: /^Section\s+(\d+(?:\.\d+)?)[\s\.:：]*(.*)/i,
    level: 2,
    pattern: 'english_section',
    confidence: 0.9,
  },
  
  // 3级标题: X.Y.Z
  {
    regex: /^(\d+)\.(\d+)\.(\d+)[\s\.:：]+(.+)/,
    level: 3,
    pattern: 'decimal_subsection',
    confidence: 0.9,
  },
  
  // 4级标题: X.Y.Z.W
  {
    regex: /^(\d+)\.(\d+)\.(\d+)\.(\d+)[\s\.:：]+(.+)/,
    level: 4,
    pattern: 'decimal_subsubsection',
    confidence: 0.85,
  },
  
  // 通用编号: (1), (一), 1), 一、
  {
    regex: /^[（\(]([一二三四五六七八九十\d]+)[）\)][\s\.:：]*(.+)/,
    level: 2,
    pattern: 'parenthesis_number',
    confidence: 0.7,
  },
  {
    regex: /^([一二三四五六七八九十]+)[、\.][\s]*(.+)/,
    level: 2,
    pattern: 'chinese_number',
    confidence: 0.75,
  },
]

/**
 * 判断一行是否像标题
 * 标题特征：短、独立、有编号格式
 */
function isLikelyHeading(line: string): boolean {
  const trimmed = line.trim()
  
  // 排除空行
  if (!trimmed) return false
  
  // 排除太长的行（>100字符）
  if (trimmed.length > 100) return false
  
  // 排除太短的行（<3字符，除非是编号如"1."）
  if (trimmed.length < 3 && !/^\d+\.?$/.test(trimmed)) return false
  
  // 排除以常见句子开头
  const sentenceStarts = ['如果', '因为', '所以', '但是', '而且', '或者', '以及',
    'If', 'Because', 'However', 'Therefore', 'And', 'Or', 'The', 'A ', 'An ']
  for (const start of sentenceStarts) {
    if (trimmed.startsWith(start)) return false
  }
  
  // 排除包含多个句号的行（可能是正文）
  if ((trimmed.match(/[。\.]/g) || []).length > 2) return false
  
  // 检查是否匹配任何标题模式
  for (const pattern of HEADING_PATTERNS) {
    if (pattern.regex.test(trimmed)) return true
  }
  
  // 检查是否是全大写英文（可能是标题）
  if (/^[A-Z][A-Z\s]{5,50}$/.test(trimmed)) return true
  
  return false
}

/**
 * 提取标题路径编号
 */
function extractPath(text: string): string | null {
  // 数字编号: 1.2.3
  const decimalMatch = text.match(/^((?:\d+\.)*\d+)[\s\.:：]/)
  if (decimalMatch) return decimalMatch[1]
  
  // 第X章
  const chapterMatch = text.match(/^第([一二三四五六七八九十百千]+)章/)
  if (chapterMatch) {
    const num = CHINESE_NUMBERS[chapterMatch[1]]
    return num ? String(num) : '1'
  }
  
  // 第X节
  const sectionMatch = text.match(/^第([一二三四五六七八九十百千]+)节/)
  if (sectionMatch) {
    const num = CHINESE_NUMBERS[sectionMatch[1]]
    return num ? `?.${num}` : '?.1' // 节需要父章节上下文
  }
  
  return null
}

/**
 * 检测标题候选
 */
export function detectHeadingCandidates(chunks: ChunkWithMetadata[]): HeadingCandidate[] {
  const candidates: HeadingCandidate[] = []
  
  for (const chunk of chunks) {
    const lines = chunk.content.split('\n')
    
    for (const line of lines) {
      const trimmed = line.trim()
      
      if (!isLikelyHeading(trimmed)) continue
      
      // 检查匹配哪个模式
      for (const pattern of HEADING_PATTERNS) {
        const match = trimmed.match(pattern.regex)
        if (match) {
          // 提取标题文本（去掉编号）
          const titleParts = match.slice(1).filter(p => p && !/^\d+$/.test(p))
          const title = titleParts.join(' ').trim() || trimmed
          
          candidates.push({
            text: title.length > 80 ? trimmed : title,
            chunkIndex: chunk.chunkIndex,
            pageNumber: chunk.pageNumber,
            level: pattern.level,
            confidence: pattern.confidence,
            pattern: pattern.pattern,
          })
          break // 只匹配第一个模式
        }
      }
    }
  }
  
  return candidates
}

/**
 * 从标题候选构建章节树
 */
export function buildSectionTree(
  documentId: number,
  candidates: HeadingCandidate[]
): DocumentSection[] {
  if (candidates.length === 0) return []
  
  const sections: DocumentSection[] = []
  const levelStack: DocumentSection[] = [] // 用于跟踪父级
  const pathCounters: number[] = [0, 0, 0, 0, 0] // 每级的计数器
  
  for (const candidate of candidates) {
    const level = candidate.level
    
    // 重置下级计数器
    for (let i = level; i < pathCounters.length; i++) {
      pathCounters[i] = 0
    }
    
    // 增加当前级计数器
    pathCounters[level - 1]++
    
    // 构建路径
    const path = pathCounters.slice(0, level).join('.')
    
    // 找父级
    let parentId: number | null = null
    while (levelStack.length > 0 && levelStack[levelStack.length - 1].level >= level) {
      levelStack.pop()
    }
    if (levelStack.length > 0) {
      parentId = levelStack[levelStack.length - 1].id || null
    }
    
    const section: DocumentSection = {
      documentId,
      parentId,
      level,
      title: candidate.text,
      path,
      startPage: candidate.pageNumber,
      startChunk: candidate.chunkIndex,
      detectionMethod: 'heuristic',
      confidence: candidate.confidence,
      metadata: { pattern: candidate.pattern },
    }
    
    sections.push(section)
    levelStack.push(section)
  }
  
  // 计算 endPage 和 endChunk
  for (let i = 0; i < sections.length; i++) {
    const current = sections[i]
    const next = sections[i + 1]
    
    if (next) {
      // 下一个章节的起始位置 - 1
      current.endPage = (next.startPage ?? current.startPage) 
      current.endChunk = (next.startChunk ?? current.startChunk)
      if (current.endChunk !== undefined && current.endChunk > 0) {
        current.endChunk--
      }
    }
  }
  
  return sections
}

export class HeadingDetector {
  /**
   * 从 chunks 中检测章节结构
   */
  detect(documentId: number, chunks: ChunkWithMetadata[]): DocumentSection[] {
    const candidates = detectHeadingCandidates(chunks)
    
    // 按出现顺序排序（chunkIndex）
    candidates.sort((a, b) => a.chunkIndex - b.chunkIndex)
    
    // 过滤掉低置信度的候选
    const filtered = candidates.filter(c => c.confidence >= 0.7)
    
    return buildSectionTree(documentId, filtered)
  }
}