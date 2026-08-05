/**
 * 从推理文本中剥离历史遗留的工具进度文案。
 *
 * 旧链路曾把 tool handler 的 emitReasoning(kind=tool) 拼进 reasoning；
 * 展示层用本函数净化落库文本（落库后无 meta.kind）。
 */

/** 整行匹配的工具进度前缀（行首起） */
const TOOL_PROGRESS_LINE_PATTERNS: RegExp[] = [
  // web_search
  /^联网搜索[：:]/,
  /^联网搜索失败[：:]/,
  /^模型请求了空的联网搜索参数/,
  /^搜索后自动读取网页[（(]/,
  /^网页读取成功[：:]/,
  /^网页读取失败[：:]/,
  /^获得\s*\d+\s*条结果/,
  /^搜索结果出现(?:低重叠冲突|来源不足)/,
  // read_url
  /^模型请求读取 URL/,
  /^正在读取网页[：:]/,
  /^注意：该网址可能是动态页面/,
  /^读取网页失败[：:]/,
  /^成功读取(?:网页|图片资源)/,
  // python
  /^在会话 workspace 中执行 Python/,
  /^Python 执行完成/,
  /^Python 执行失败[：:]/,
  // document tools
  /^获取会话文档列表/,
  /^已获取会话文档$/,
  /^在文档中搜索[：:]/,
  /^搜索完成，已获取相关内容$/,
  /^获取文档\s+.+\s+内容/,
  /^已获取文档\s+.+\s+内容$/,
  /^获取文档\s+.+\s+目录结构/,
  /^已获取目录结构$/,
  /^获取章节\s+.+\s+内容/,
  /^已获取章节内容$/,
  /^正在同步文档到 workspace/,
  /^文档桥接同步(?:完成|失败)$/,
  /^获取文档\s+.+\s+的 workspace 路径/,
  /^已获取 workspace 路径$/,
  /^获取 workspace 路径失败$/,
  /^文档工具失败[：:]/,
  /^执行文档工具[：:]/,
  // knowledge base
  /^获取知识库列表/,
  /^已获取知识库概要$/,
  /^获取知识库\s+.+\s+的文档列表/,
  /^已获取知识库文档列表$/,
  /^在知识库中搜索[：:]/,
  /^获取文档\s+.+\s+的内容/,
  /^已获取文档内容$/,
  /^获取文档\s+.+\s+的目录结构/,
  /^知识库工具失败[：:]/,
  /^执行知识库工具[：:]/,
]

export const isToolProgressReasoningLine = (line: string): boolean => {
  const trimmed = line.trim()
  if (!trimmed) return false
  return TOOL_PROGRESS_LINE_PATTERNS.some((pattern) => pattern.test(trimmed))
}

/**
 * 判断 reasoning SSE meta 是否应被忽略（工具进度不得进入推理通道）。
 */
export const shouldIgnoreReasoningMeta = (meta?: Record<string, unknown> | null): boolean => {
  if (!meta || typeof meta !== 'object') return false
  return meta.kind === 'tool'
}

/**
 * 剥离推理文本中的工具进度行，折叠多余空行。
 */
export const stripToolProgressFromReasoning = (text: string | null | undefined): string => {
  if (typeof text !== 'string' || text.length === 0) return ''

  const lines = text.split(/\r?\n/)
  const kept: string[] = []
  for (const line of lines) {
    if (isToolProgressReasoningLine(line)) continue
    kept.push(line)
  }

  // 折叠连续空行，并去掉首尾空白行
  const collapsed: string[] = []
  let pendingBlank = false
  for (const line of kept) {
    if (line.trim().length === 0) {
      if (collapsed.length === 0) continue
      pendingBlank = true
      continue
    }
    if (pendingBlank) {
      collapsed.push('')
      pendingBlank = false
    }
    collapsed.push(line)
  }

  return collapsed.join('\n').trim()
}
