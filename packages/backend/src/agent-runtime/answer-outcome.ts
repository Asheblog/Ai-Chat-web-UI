/**
 * 答复交付判定：区分「模型真的给出了答复」与「模型只给了一句非空提示」。
 *
 * 判定顺序固定为「provider 结构化原因优先，已知固定话术只在没有结构化原因时兜底」，
 * 且只看 turn 自身的 finish/response 信号与正文，不看 usage：input_tokens=0 之类
 * 的计数字段不能单独证明未交付（部分网关在流式首包或缓存命中时就是 0）。
 *
 * 这里只做归类，不改写正文、不重试、不切换模型：被归类为未交付的正文原样保留，
 * 由调用方按「未生成最终回答」收尾并记录原结果。
 */

/** provider 在本次 turn 上给出的结构化结束信号 */
export type ProviderAnswerSignal = {
  /** Chat Completions: choices[0].finish_reason */
  finishReason?: string | null
  /** Responses API: response.incomplete_details.reason */
  incompleteReason?: string | null
  /** Responses API: response.status（completed / incomplete / failed） */
  responseStatus?: string | null
  /** provider 明确给出的拒答文本（message.refusal / refusal 内容块） */
  refusalText?: string | null
}

export type AnswerOutcomeReason =
  | 'provider_content_filter'
  | 'provider_refusal'
  | 'provider_failed'
  | 'fixed_hint_phrase'
  | 'empty_content'

export type AnswerOutcomeSource = 'provider_signal' | 'content_hint' | 'none'

export type AnswerOutcome = {
  /** true 表示这次 turn 的正文可以作为最终答复交付 */
  delivered: boolean
  /** 已交付但被 token 上限截断：仍算交付，只是不完整 */
  truncated: boolean
  reason: AnswerOutcomeReason | null
  source: AnswerOutcomeSource
  /** 命中已知固定话术：疑似被拦截/被替换成提示，仅归类为疑似 */
  suspectedInterception: boolean
  matchedHintId: string | null
  /** 原始正文长度；正文本身不进入追踪事件 */
  contentLength: number
  signal: ProviderAnswerSignal
}

/**
 * 已知的固定话术目录：每条要求所有正则都命中。
 * 只收录可复现的固定句式；未收录的话术按普通正文对待，宁可漏判也不误判。
 */
type HintPattern = { id: string; patterns: RegExp[] }

const HINT_PATTERNS: HintPattern[] = [
  {
    id: 'zh-cannot-assist',
    patterns: [/(抱歉|对不起).{0,12}(无法|不能|不便)(协助|帮助|回答|提供|满足)/],
  },
  {
    id: 'zh-ai-cannot-browse',
    patterns: [
      /(作为|我是一个).{0,10}(ai|人工智能)/i,
      /(无法|不能|没法).{0,10}(访问|浏览).{0,6}(互联网|网络|网页|网站|外部(链接|信息|内容))/,
    ],
  },
  {
    id: 'zh-realtime-unavailable',
    patterns: [/(无法|不能|没法).{0,10}(提供|获取).{0,10}(实时|最新)(信息|数据|资讯|内容)?/],
  },
  {
    id: 'en-cannot-assist',
    patterns: [
      /(i'?m sorry|sorry)/i,
      /(can'?t|cannot|can not|unable to).{0,24}(assist|help|provide|comply|answer)/i,
    ],
  },
  {
    id: 'en-ai-cannot-browse',
    patterns: [
      /as an ai (language )?(model|assistant)/i,
      /(can'?t|cannot|unable to).{0,24}(browse|access|retrieve).{0,24}(internet|web|external|real-?time)/i,
    ],
  },
]

/** 固定话术只在一个短回复的长度范围内认定，避免长文里引用一句拒答就改判 */
const HINT_MAX_LENGTH = 240

const normalizeForMatch = (content: string): string => content.trim().replace(/\s+/g, ' ')

/** 只保留有意义的字符：空格与标点不参与覆盖率计算 */
const compactForMatch = (content: string): string => content.replace(/[\s\p{P}]+/gu, '')

/** 命中话术必须覆盖住整段回复的绝大部分，长文里引用一句拒答不算命中 */
const HINT_COVERAGE_RATIO = 0.5

const matchHint = (content: string): string | null => {
  const normalized = normalizeForMatch(content)
  if (!normalized || normalized.length > HINT_MAX_LENGTH) return null
  const totalChars = compactForMatch(normalized).length
  if (totalChars === 0) return null
  for (const hint of HINT_PATTERNS) {
    let matchedChars = 0
    let rest = normalized
    let matchedAll = true
    for (const pattern of hint.patterns) {
      const match = rest.match(pattern)
      if (!match || typeof match[0] !== 'string') {
        matchedAll = false
        break
      }
      matchedChars += compactForMatch(match[0]).length
      rest = rest.replace(match[0], ' ')
    }
    if (!matchedAll) continue
    if (matchedChars / totalChars >= HINT_COVERAGE_RATIO) {
      return hint.id
    }
  }
  return null
}

const readSignal = (signal?: ProviderAnswerSignal | null): ProviderAnswerSignal => ({
  finishReason: typeof signal?.finishReason === 'string' ? signal.finishReason : null,
  incompleteReason: typeof signal?.incompleteReason === 'string' ? signal.incompleteReason : null,
  responseStatus: typeof signal?.responseStatus === 'string' ? signal.responseStatus : null,
  refusalText:
    typeof signal?.refusalText === 'string' && signal.refusalText.trim()
      ? signal.refusalText
      : null,
})

/** 结构化原因：命中即未交付，不再看正文写了什么 */
const resolveProviderBlockReason = (
  signal: ProviderAnswerSignal,
): AnswerOutcomeReason | null => {
  if (signal.refusalText) return 'provider_refusal'
  if (signal.finishReason === 'content_filter' || signal.incompleteReason === 'content_filter') {
    return 'provider_content_filter'
  }
  if (signal.responseStatus === 'failed') return 'provider_failed'
  return null
}

const isTruncatedSignal = (signal: ProviderAnswerSignal): boolean =>
  signal.finishReason === 'length' ||
  (signal.responseStatus === 'incomplete' && signal.incompleteReason !== 'content_filter')

export const classifyAnswerOutcome = (input: {
  content?: string | null
  signal?: ProviderAnswerSignal | null
}): AnswerOutcome => {
  const content = typeof input.content === 'string' ? input.content : ''
  const signal = readSignal(input.signal)
  const base = {
    contentLength: content.length,
    signal,
  }

  const blockedReason = resolveProviderBlockReason(signal)
  if (blockedReason) {
    return {
      ...base,
      delivered: false,
      truncated: false,
      reason: blockedReason,
      source: 'provider_signal',
      suspectedInterception: false,
      matchedHintId: null,
    }
  }

  const truncated = isTruncatedSignal(signal)
  if (!content.trim()) {
    return {
      ...base,
      delivered: false,
      truncated: false,
      reason: 'empty_content',
      source: 'none',
      suspectedInterception: false,
      matchedHintId: null,
    }
  }

  const matchedHintId = matchHint(content)
  if (matchedHintId) {
    return {
      ...base,
      delivered: false,
      truncated,
      reason: 'fixed_hint_phrase',
      source: 'content_hint',
      suspectedInterception: true,
      matchedHintId,
    }
  }

  return {
    ...base,
    delivered: true,
    truncated,
    reason: null,
    source: 'none',
    suspectedInterception: false,
    matchedHintId: null,
  }
}

/** 追踪事件载荷：只放归类结论与长度，不放正文 */
export type AnswerOutcomeTracePayload = {
  delivered: boolean
  truncated: boolean
  reason: AnswerOutcomeReason | null
  source: AnswerOutcomeSource
  suspectedInterception: boolean
  matchedHintId: string | null
  contentLength: number
  finishReason: string | null
  incompleteReason: string | null
  responseStatus: string | null
  refusalSeen: boolean
}

export const buildAnswerOutcomeTracePayload = (
  outcome: AnswerOutcome,
): AnswerOutcomeTracePayload => ({
  delivered: outcome.delivered,
  truncated: outcome.truncated,
  reason: outcome.reason,
  source: outcome.source,
  suspectedInterception: outcome.suspectedInterception,
  matchedHintId: outcome.matchedHintId,
  contentLength: outcome.contentLength,
  finishReason: outcome.signal.finishReason ?? null,
  incompleteReason: outcome.signal.incompleteReason ?? null,
  responseStatus: outcome.signal.responseStatus ?? null,
  refusalSeen: Boolean(outcome.signal.refusalText),
})
