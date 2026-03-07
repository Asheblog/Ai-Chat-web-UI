import { Tokenizer } from '../../../utils/tokenizer'

export type ToolLoopGuardMode = 'normal' | 'aggressive'

export interface ToolLoopContextGuardParams {
  messages: any[]
  contextLimit: number
  mode?: ToolLoopGuardMode
}

export interface ToolLoopContextGuardResult {
  messages: any[]
  changed: boolean
  beforeTokens: number
  afterTokens: number
  targetTokens: number
}

type BudgetMessage = { role: string; content: string }

const NORMAL_TARGET_RATIO = 0.82
const AGGRESSIVE_TARGET_RATIO = 0.6
const NORMAL_TOOL_CONTENT_CHARS = 1000
const AGGRESSIVE_TOOL_CONTENT_CHARS = 320
const NORMAL_GENERIC_CONTENT_CHARS = 480
const AGGRESSIVE_GENERIC_CONTENT_CHARS = 160
const NORMAL_TAIL_PROTECT = 6
const AGGRESSIVE_TAIL_PROTECT = 3
const MIN_TARGET_TOKENS = 256

const toStringSafe = (value: unknown): string => {
  if (typeof value === 'string') return value
  if (value == null) return ''
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return ''
  }
}

const flattenForBudget = (content: unknown): string => {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return toStringSafe(content)
  return content
    .map((part: any) => {
      if (!part || typeof part !== 'object') return ''
      if (part.type === 'text') return toStringSafe(part.text)
      if (part.type === 'image_url') return '[image]'
      return toStringSafe(part)
    })
    .filter(Boolean)
    .join('\n')
}

const truncateText = (text: string, limit: number): string => {
  if (!text || limit <= 0) return ''
  if (text.length <= limit) return text
  const omitted = text.length - limit
  return `${text.slice(0, limit)}\n...[已截断 ${omitted} 字符]`
}

const toBudgetMessages = (messages: any[]): BudgetMessage[] =>
  messages.map((msg) => ({
    role: typeof msg?.role === 'string' && msg.role ? msg.role : 'user',
    content: flattenForBudget(msg?.content),
  }))

const countTokens = async (messages: any[]): Promise<number> =>
  Tokenizer.countConversationTokens(toBudgetMessages(messages))

const buildToolSummary = (raw: string, maxChars: number): string => {
  const excerpt = truncateText(raw, maxChars)
  return `[工具结果已压缩，保留关键摘录]\n${excerpt || '(空结果)'}`
}

const isToolCallAssistantMessage = (msg: any): boolean =>
  msg?.role === 'assistant' && (Boolean(msg?.tool_calls) || Boolean(msg?.function_call))

export async function guardToolLoopMessages(
  params: ToolLoopContextGuardParams,
): Promise<ToolLoopContextGuardResult> {
  const mode: ToolLoopGuardMode = params.mode === 'aggressive' ? 'aggressive' : 'normal'
  const targetRatio = mode === 'aggressive' ? AGGRESSIVE_TARGET_RATIO : NORMAL_TARGET_RATIO
  const contextLimit = Number.isFinite(params.contextLimit) && params.contextLimit > 0
    ? Math.floor(params.contextLimit)
    : MIN_TARGET_TOKENS
  const targetTokens = Math.max(MIN_TARGET_TOKENS, Math.floor(contextLimit * targetRatio))
  const input = Array.isArray(params.messages) ? params.messages : []
  const mutable = input.map((msg) => ({ ...msg }))

  const beforeTokens = await countTokens(mutable)
  if (beforeTokens <= targetTokens) {
    return {
      messages: mutable,
      changed: false,
      beforeTokens,
      afterTokens: beforeTokens,
      targetTokens,
    }
  }

  const tailProtect = mode === 'aggressive' ? AGGRESSIVE_TAIL_PROTECT : NORMAL_TAIL_PROTECT
  const toolContentChars = mode === 'aggressive' ? AGGRESSIVE_TOOL_CONTENT_CHARS : NORMAL_TOOL_CONTENT_CHARS
  const genericContentChars = mode === 'aggressive' ? AGGRESSIVE_GENERIC_CONTENT_CHARS : NORMAL_GENERIC_CONTENT_CHARS

  const preserved = new Set<any>()
  for (const msg of mutable) {
    if (msg?.role !== 'system') break
    preserved.add(msg)
  }
  for (let i = Math.max(0, mutable.length - tailProtect); i < mutable.length; i += 1) {
    preserved.add(mutable[i])
  }
  for (let i = mutable.length - 1; i >= 0; i -= 1) {
    if (mutable[i]?.role === 'user') {
      preserved.add(mutable[i])
      break
    }
  }

  let changed = false

  // Step 1: 优先压缩较早的 tool 结果
  for (let i = 0; i < mutable.length; i += 1) {
    const msg = mutable[i]
    if (!msg) continue
    if (msg.role !== 'tool') continue
    const raw = flattenForBudget(msg.content)
    const next = buildToolSummary(raw, toolContentChars)
    if (next !== msg.content) {
      msg.content = next
      changed = true
    }
  }

  let afterTokens = await countTokens(mutable)
  if (afterTokens <= targetTokens) {
    return { messages: mutable, changed, beforeTokens, afterTokens, targetTokens }
  }

  // Step 2: 压缩旧的 assistant tool_call 消息
  for (let i = 0; i < mutable.length; i += 1) {
    const msg = mutable[i]
    if (!msg) continue
    if (!isToolCallAssistantMessage(msg)) continue
    const raw = flattenForBudget(msg.content)
    msg.content = raw ? truncateText(raw, Math.max(80, Math.floor(genericContentChars / 2))) : '[工具调用记录已折叠]'
    if (Object.prototype.hasOwnProperty.call(msg, 'reasoning_content')) {
      delete msg.reasoning_content
    }
    changed = true
  }

  afterTokens = await countTokens(mutable)
  if (afterTokens <= targetTokens) {
    return { messages: mutable, changed, beforeTokens, afterTokens, targetTokens }
  }

  // Step 3: 压缩其他早期消息
  for (let i = 0; i < mutable.length; i += 1) {
    const msg = mutable[i]
    if (!msg || preserved.has(msg)) continue
    if (msg.role === 'tool') continue
    const raw = flattenForBudget(msg.content)
    const next = truncateText(raw, genericContentChars)
    if (next !== msg.content) {
      msg.content = next
      changed = true
    }
  }

  afterTokens = await countTokens(mutable)
  if (afterTokens <= targetTokens) {
    return { messages: mutable, changed, beforeTokens, afterTokens, targetTokens }
  }

  // Step 4: 仍超限时删除最早的可移除消息（保留系统前缀 + 末尾关键轮次）
  while (afterTokens > targetTokens) {
    const removableIndex = mutable.findIndex((msg) => !preserved.has(msg))
    if (removableIndex < 0) break
    mutable.splice(removableIndex, 1)
    changed = true
    afterTokens = await countTokens(mutable)
  }

  return {
    messages: mutable,
    changed,
    beforeTokens,
    afterTokens,
    targetTokens,
  }
}
