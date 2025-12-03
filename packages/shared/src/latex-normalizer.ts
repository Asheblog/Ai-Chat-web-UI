const ALLOWED_SURROUNDING_CHARS =
  '\\s。，、､;；„“‘’“”（）「」『』［］《》【】‹›«»…⋯:：？！～⇒?!-\\/:-@\\[-`{-~\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Hangul}'

const boundaryMatcher = new RegExp(`[${ALLOWED_SURROUNDING_CHARS}]`, 'u')
const PLACEHOLDER_PREFIX = '@@LATEX-'
const PLACEHOLDER_SUFFIX = '@@'
const PLACEHOLDER_PATTERN = /@@LATEX-(INLINE|BLOCK):([A-Za-z0-9_-]+)@@/g

interface LatexDelimiter {
  left: string
  right: string
  displayMode: boolean
  balanced?: boolean
}

interface LatexToken {
  start: number
  end: number
  value: string
  raw: string
  displayMode: boolean
}

const DELIMITERS: LatexDelimiter[] = [
  { left: '$$', right: '$$', displayMode: true },
  { left: '$', right: '$', displayMode: false },
  { left: '\\(', right: '\\)', displayMode: false },
  { left: '\\[', right: '\\]', displayMode: true },
  { left: '\\pu{', right: '}', displayMode: false, balanced: true },
  { left: '\\ce{', right: '}', displayMode: false, balanced: true },
  { left: '\\boxed{', right: '}', displayMode: false, balanced: true },
  { left: '\\begin{equation}', right: '\\end{equation}', displayMode: true },
  { left: '\\begin{align}', right: '\\end{align}', displayMode: true },
  { left: '\\begin{aligned}', right: '\\end{aligned}', displayMode: true },
  { left: '\\begin{cases}', right: '\\end{cases}', displayMode: true },
  { left: '\\begin{matrix}', right: '\\end{matrix}', displayMode: true },
  { left: '\\begin{pmatrix}', right: '\\end{pmatrix}', displayMode: true },
  { left: '\\begin{bmatrix}', right: '\\end{bmatrix}', displayMode: true },
  { left: '\\begin{vmatrix}', right: '\\end{vmatrix}', displayMode: true },
]

const isBoundaryChar = (char: string | undefined) => {
  if (!char) return true
  return boundaryMatcher.test(char)
}

const isEscaped = (value: string, index: number) => {
  let slashCount = 0
  for (let i = index - 1; i >= 0; i -= 1) {
    if (value[i] !== '\\') break
    slashCount += 1
  }
  return slashCount % 2 === 1
}

const findClosingBrace = (value: string, start: number) => {
  let depth = 1
  for (let i = start; i < value.length; i += 1) {
    const ch = value[i]
    if (ch === '\\') {
      i += 1
      continue
    }
    if (ch === '{') {
      depth += 1
      continue
    }
    if (ch === '}') {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return -1
}

const extractWithDelimiter = (value: string, fromIndex: number, delimiter: LatexDelimiter): LatexToken | null => {
  let searchIndex = fromIndex
  while (searchIndex < value.length) {
    const leftIndex = value.indexOf(delimiter.left, searchIndex)
    if (leftIndex === -1) return null
    if ((delimiter.left === '$$' || delimiter.left === '$') && isEscaped(value, leftIndex)) {
      searchIndex = leftIndex + delimiter.left.length
      continue
    }
    const prevChar = leftIndex === 0 ? undefined : value[leftIndex - 1]
    if (!isBoundaryChar(prevChar)) {
      searchIndex = leftIndex + delimiter.left.length
      continue
    }
    const contentStart = leftIndex + delimiter.left.length
    let contentEnd = -1
    if (delimiter.balanced) {
      contentEnd = findClosingBrace(value, contentStart)
    } else {
      contentEnd = value.indexOf(delimiter.right, contentStart)
    }
    if (contentEnd === -1) {
      searchIndex = leftIndex + delimiter.left.length
      continue
    }
    const rawEnd = contentEnd + delimiter.right.length
    const nextChar = rawEnd < value.length ? value[rawEnd] : undefined
    if (!isBoundaryChar(nextChar)) {
      searchIndex = leftIndex + delimiter.left.length
      continue
    }
    const content = value.slice(contentStart, contentEnd)
    if (!content.trim()) {
      searchIndex = rawEnd
      continue
    }
    return {
      start: leftIndex,
      end: rawEnd,
      value: content,
      raw: value.slice(leftIndex, rawEnd),
      displayMode: delimiter.displayMode,
    }
  }
  return null
}

const findNextToken = (value: string, fromIndex: number): LatexToken | null => {
  let candidate: LatexToken | null = null
  for (const delimiter of DELIMITERS) {
    const token = extractWithDelimiter(value, fromIndex, delimiter)
    if (!token) continue
    if (!candidate || token.start < candidate.start) {
      candidate = token
    }
  }
  return candidate
}

const extractLatexTokens = (value: string): LatexToken[] => {
  if (!value) return []
  const tokens: LatexToken[] = []
  let cursor = 0
  while (cursor < value.length) {
    const token = findNextToken(value, cursor)
    if (!token) break
    tokens.push(token)
    cursor = token.end
  }
  return tokens
}

const getBuffer = () => {
  if (typeof globalThis === 'undefined') return null
  return (globalThis as any).Buffer ?? null
}

const encodeBase64 = (value: string) => {
  const bufferLike = getBuffer()
  if (bufferLike) {
    return bufferLike.from(value, 'utf8').toString('base64')
  }
  if (typeof btoa === 'function') {
    const encoder = new TextEncoder()
    const bytes = encoder.encode(value)
    let binary = ''
    for (const byte of bytes) {
      binary += String.fromCharCode(byte)
    }
    return btoa(binary)
  }
  throw new Error('Base64 encoding not supported in this environment')
}

const decodeBase64 = (value: string) => {
  const bufferLike = getBuffer()
  if (bufferLike) {
    return bufferLike.from(value, 'base64').toString('utf8')
  }
  if (typeof atob === 'function') {
    const binary = atob(value)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i)
    }
    const decoder = new TextDecoder()
    return decoder.decode(bytes)
  }
  throw new Error('Base64 decoding not supported in this environment')
}

const encodeBase64Url = (value: string) =>
  encodeBase64(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')

const decodeBase64Url = (value: string) => {
  const paddingLength = (4 - (value.length % 4)) % 4
  const padded = `${value}${'='.repeat(paddingLength)}`
  return decodeBase64(padded.replace(/-/g, '+').replace(/_/g, '/'))
}

const shouldSkipParent = (parent: any) => {
  if (!parent) return false
  return parent.type === 'code' || parent.type === 'inlineCode'
}

const buildPlaceholder = (token: LatexToken) => {
  const encoded = encodeBase64Url(token.value)
  return `${PLACEHOLDER_PREFIX}${token.displayMode ? 'BLOCK' : 'INLINE'}:${encoded}${PLACEHOLDER_SUFFIX}`
}

export const encodeLatexPlaceholders = (markdown: string) => {
  if (!markdown) return ''
  const tokens = extractLatexTokens(markdown)
  if (tokens.length === 0) return markdown
  let offset = 0
  const parts: string[] = []
  for (const token of tokens) {
    if (token.start > offset) {
      parts.push(markdown.slice(offset, token.start))
    }
    parts.push(buildPlaceholder(token))
    offset = token.end
  }
  if (offset < markdown.length) {
    parts.push(markdown.slice(offset))
  }
  return parts.join('')
}

const decodePlaceholder = (match: RegExpMatchArray) => {
  const type = match[1]
  const content = decodeBase64Url(match[2])
  return {
    displayMode: type === 'BLOCK',
    value: content.trim(),
  }
}

const isWhitespaceText = (node: any) => node?.type === 'text' && (!node.value || !node.value.trim())

const hasMeaningfulChildren = (children: any[]) =>
  Array.isArray(children) && children.some((child) => !isWhitespaceText(child))

const normalizeBlockNodes = (node: any) => {
  if (!node?.children || !Array.isArray(node.children)) return
  for (let i = 0; i < node.children.length; i += 1) {
    const child = node.children[i]
    if (child?.type === 'paragraph' && Array.isArray(child.children)) {
      const segments: any[] = []
      let buffer: any[] = []
      let mutated = false
      const flushBuffer = () => {
        if (buffer.length === 0) return
        segments.push({
          type: 'paragraph',
          children: buffer,
        })
        buffer = []
      }
      for (const grandchild of child.children) {
        if (grandchild?.type === 'math') {
          mutated = true
          flushBuffer()
          segments.push(grandchild)
          continue
        }
        buffer.push(grandchild)
      }
      flushBuffer()
      if (mutated) {
        const normalizedSegments = segments.filter((segment) => {
          if (segment.type !== 'paragraph') return true
          return hasMeaningfulChildren(segment.children)
        })
        if (normalizedSegments.length === 0) {
          node.children.splice(i, 1)
          i -= 1
        } else {
          node.children.splice(i, 1, ...normalizedSegments)
          i += normalizedSegments.length - 1
        }
        continue
      }
    }
    if (child?.children) {
      normalizeBlockNodes(child)
    }
  }
}

export const remarkKatexTokenizer = () => (tree: any) => {
  const transformNode = (node: any) => {
    if (!node || !node.children || !Array.isArray(node.children)) {
      return
    }
    for (let i = 0; i < node.children.length; i += 1) {
      const child = node.children[i]
      if (!child) continue
      if (child.type === 'text' && typeof child.value === 'string' && !shouldSkipParent(node)) {
        const matches = Array.from(child.value.matchAll(PLACEHOLDER_PATTERN)) as RegExpMatchArray[]
        if (matches.length === 0) {
          continue
        }
        const newChildren: any[] = []
        let lastIndex = 0
        for (const match of matches) {
          const matchIndex = match.index ?? 0
          if (matchIndex > lastIndex) {
            newChildren.push({
              type: 'text',
              value: child.value.slice(lastIndex, matchIndex),
            })
          }
          const decoded = decodePlaceholder(match)
          const isBlock = decoded.displayMode
          newChildren.push({
            type: isBlock ? 'math' : 'inlineMath',
            value: decoded.value,
            data: {
              hName: 'code',
              hProperties: {
                className: ['language-math', isBlock ? 'math-display' : 'math-inline'],
              },
              hChildren: [{ type: 'text', value: decoded.value }],
            },
          })
          lastIndex = matchIndex + match[0].length
        }
        if (lastIndex < child.value.length) {
          newChildren.push({
            type: 'text',
            value: child.value.slice(lastIndex),
          })
        }
        node.children.splice(i, 1, ...newChildren)
        i += newChildren.length - 1
        continue
      }
      if (child.children) {
        transformNode(child)
      }
    }
  }
  transformNode(tree)
  normalizeBlockNodes(tree)
}

export type LatexDecisionReason = 'inline_token' | 'display_token'

export interface LatexSegmentAudit {
  raw: string
  normalized: string
  trimmed: string
  matched: boolean
  reason: LatexDecisionReason
}

export interface LatexAuditResult {
  normalized: string
  segments: LatexSegmentAudit[]
  matchedCount: number
  unmatchedCount: number
}

export const containsLatexTokens = (markdown: string) => extractLatexTokens(markdown).length > 0

export const analyzeLatexBlocks = (markdown: string): LatexAuditResult => {
  if (!markdown) {
    return { normalized: '', segments: [], matchedCount: 0, unmatchedCount: 0 }
  }
  const tokens = extractLatexTokens(markdown)
  const segments: LatexSegmentAudit[] = tokens.map((token) => ({
    raw: token.raw,
    normalized: token.displayMode
      ? `\\[\n${token.value.trim()}\n\\]`
      : `\\(${token.value.trim()}\\)`,
    trimmed: token.raw.trim(),
    matched: true,
    reason: token.displayMode ? 'display_token' : 'inline_token',
  }))
  return {
    normalized: markdown,
    segments,
    matchedCount: segments.length,
    unmatchedCount: 0,
  }
}

export const defaultRemarkMathOptions = {
  singleDollarTextMath: false,
  inlineMath: [
    ['$', '$'],
    ['\\(', '\\)'],
  ],
  math: [
    ['$$', '$$'],
    ['\\[', '\\]'],
  ],
}
