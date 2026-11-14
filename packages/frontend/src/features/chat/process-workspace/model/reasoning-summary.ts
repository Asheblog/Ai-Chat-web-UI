/**
 * 推理段的内容摘要：给每段推理一个能读懂的小标题。
 *
 * 只用段内文字做本地提炼（不调用模型、不发请求），规则固定可预期：
 * 1. 清掉 Markdown 标题/列表/引用/表格/代码标记与链接地址，只留可读文字；
 * 2. 按行、按句切分，剥掉句首少量应答词（好的/嗯/收到…），取第一个长度达标的句子；
 * 3. 正文里没有可用句子时，才退回排在首个的非空代码行作标题（保留标识符原文，不执行代码）；
 * 4. 超长时先试分句/词边界再截断，末尾用省略号，整体不超过 REASONING_SUMMARY_MAX_LENGTH 个码点。
 *
 * 长度、索引、切分一律按 Array.from 得到的码点数组计算，emoji 不会把预算算成两倍。
 * 什么都提不出来时返回空串，由调用方给出位置占位，绝不用固定标题冒充内容。
 */

/** 摘要上限（码点，含省略号）。 */
export const REASONING_SUMMARY_MAX_LENGTH = 30

/** 短于此码点长度的句子不当作段意，继续找更长的句子。 */
const MIN_INFORMATIVE_LENGTH = 6

const FENCED_CODE = /```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)/g
const CODE_BODY = /(?:```|~~~)[^\n]*\n([\s\S]*?)(?:(?:```|~~~)|$)/g
const IMAGE = /!\[([^\]]*)\]\([^)]*\)/g
const LINK = /\[([^\]]+)\]\([^)]*\)/g
const INLINE_CODE = /`([^`\n]*)`/g
const HTML_TAG = /<[^>\n]+>/g
const HEADING_MARKER = /^#{1,6}\s+/
const BLOCKQUOTE_MARKER = /^>\s?/
const LIST_MARKER = /^(?:[-*+]|\d+[.)])\s+/
const EMPHASIS_PAIR = /(\*\*|__|~~)(.+?)\1/g
const ITALIC = /\*([^*\n]+)\*/g
const SENTENCE_BREAK = /[。！？!?；;]+/
/** 收尾时去掉的标点：摘要行不挂句号，截断前也不留半个分句。 */
const TRAILING_PUNCTUATION = /[。．.！!？?；;，,、：:\s]+$/
/** 截断时优先落在这些边界之后。 */
const SOFT_BREAK = /[，,、；;：:\s]/
/**
 * 句首应答词：只在后面紧跟标点/空白/句末时才算数，所以"好奇""行业"不会被误剥。
 * 这是固定词表，不是语义判断。
 */
const LEADING_BOILERPLATE_TOKEN =
  /^(?:好的|好|嗯+|哦|收到|了解|明白|没问题|当然|行|okay|ok)(?=[，,、。.!！？?？:：;\s]|$)/i
const LEADING_SEPARATORS = /^[，,、。.!！？?？:：;\s]+/

const codepoints = (value: string): string[] => Array.from(value)

const collapseWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim()

const stripInlineMarkup = (line: string): string =>
  line
    .replace(HEADING_MARKER, '')
    .replace(BLOCKQUOTE_MARKER, '')
    .replace(LIST_MARKER, '')
    .replace(EMPHASIS_PAIR, '$2')
    .replace(ITALIC, '$1')
    .replace(INLINE_CODE, '$1')
    .replace(IMAGE, '$1')
    .replace(LINK, '$1')
    .replace(HTML_TAG, ' ')
    .replace(/\|/g, ' ')

/** 去掉代码块/标记并保留行边界，空行丢弃。 */
const toCleanLines = (text: string): string[] => {
  if (!text) return []
  return text
    .replace(FENCED_CODE, '\n')
    .split(/\r?\n/)
    .map((line) => collapseWhitespace(stripInlineMarkup(line)))
    .filter((line) => line.length > 0)
}

/** 段内按句切分，保持原文顺序。 */
const toSentences = (lines: string[]): string[] => {
  const sentences: string[] = []
  for (const line of lines) {
    for (const piece of line.split(SENTENCE_BREAK)) {
      const sentence = piece.trim()
      if (sentence) sentences.push(sentence)
    }
  }
  return sentences
}

/** 反复剥掉句首应答词；整句都是应答词（如"嗯，收到"）时返回空串。 */
const stripLeadingBoilerplate = (sentence: string): string => {
  let rest = sentence.trim()
  for (;;) {
    const next = rest.replace(LEADING_BOILERPLATE_TOKEN, '').replace(LEADING_SEPARATORS, '').trim()
    if (next === rest) return rest
    rest = next
    if (!rest) return ''
  }
}

/** 正文里第一个长度达标的句子；都太短就取第一个剥完应答词的句子。 */
const pickLeadSentence = (lines: string[]): string | null => {
  const candidates = toSentences(lines)
    .map(stripLeadingBoilerplate)
    .filter((sentence) => sentence.length > 0)
  if (candidates.length === 0) return null
  return candidates.find((sentence) => codepoints(sentence).length >= MIN_INFORMATIVE_LENGTH) ?? candidates[0]
}

/** 首个围栏代码块里的首个非空行：只在没有可用正文时当标题用，代码原样保留。 */
const firstCodeLine = (text: string): string | null => {
  if (!text) return null
  const pattern = new RegExp(CODE_BODY.source, 'g')
  let match: RegExpExecArray | null = pattern.exec(text)
  while (match !== null) {
    for (const raw of match[1].split(/\r?\n/)) {
      const line = collapseWhitespace(raw)
      if (line) return line
    }
    match = pattern.exec(text)
  }
  return null
}

const trimTrailing = (value: string): string => value.replace(TRAILING_PUNCTUATION, '').trim()

/**
 * 收进预算：够短就原样返回；超长时先在分句/词边界退让，再加省略号。
 * 全程用码点数组的长度与下标，避免 UTF-16 单元把 emoji 当成两个字符。
 */
const fitToBudget = (value: string, maxLength: number): string => {
  const chars = codepoints(collapseWhitespace(trimTrailing(value)))
  if (chars.length === 0) return ''
  if (chars.length <= maxLength) return chars.join('')

  const budget = maxLength - 1
  const head = chars.slice(0, budget)
  let cut = head
  const minBreak = Math.ceil(budget / 2)

  for (let index = head.length - 1; index >= minBreak; index -= 1) {
    if (!SOFT_BREAK.test(head[index])) continue
    const candidate = codepoints(trimTrailing(head.slice(0, index).join('')))
    if (candidate.length >= 4) {
      cut = candidate
      break
    }
  }

  const sentence = trimTrailing(cut.join(''))
  return `${sentence || cut.join('')}…`
}

/**
 * 一段推理的文字摘要；没有可用正文也没有代码行时返回空串。
 * 同一段原文永远得到同一结果，不掺入随机或外部状态。
 */
export function summarizeReasoningSegment(text: string): string {
  const lead = pickLeadSentence(toCleanLines(text))
  if (lead) return fitToBudget(lead, REASONING_SUMMARY_MAX_LENGTH)

  const code = firstCodeLine(text)
  return code ? fitToBudget(code, REASONING_SUMMARY_MAX_LENGTH) : ''
}
