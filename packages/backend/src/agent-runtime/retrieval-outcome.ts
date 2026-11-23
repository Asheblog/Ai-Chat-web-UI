/**
 * 检索结果的机读收口（对齐 retrieval 侧 retrievalOutcome 契约）。
 *
 * 答复编排只消费这一层：不解析网页正文，只按 status/reason 决定
 * 「是否还有可用证据」以及「未核实来源」的归类，避免用正文措辞判断检索成败。
 */

export const RETRIEVAL_OUTCOME_STATUSES = [
  'success',
  'partial',
  'empty',
  'failed',
  'timeout',
  'cancelled',
] as const

export type RetrievalOutcomeStatus = (typeof RETRIEVAL_OUTCOME_STATUSES)[number]

/** 只取答复编排真正用到的两个字段：其余字段由检索侧自己保留 */
export type RetrievalOutcome = {
  status: RetrievalOutcomeStatus
  reason: string | null
}

/** success / partial 才算这一轮留下了可用证据 */
const EVIDENCE_STATUSES: ReadonlySet<RetrievalOutcomeStatus> = new Set(['success', 'partial'])

/** 没有进展的检索状态：全失败 / 全超时 */
const NO_PROGRESS_STATUSES: ReadonlySet<RetrievalOutcomeStatus> = new Set(['failed', 'timeout'])

/** 检索侧明确的「这一轮不可能再拿到东西」原因：立即结束纯检索链 */
const EXHAUSTION_REASONS: Record<string, RetrievalChainEndReason> = {
  all_sources_cooling_down: 'sources_cooling_down',
  no_active_engine: 'no_active_engine',
}

/** 连续多少轮全失败/全超时才算检索链耗尽（先保留一次恢复机会） */
export const RETRIEVAL_CHAIN_NO_PROGRESS_LIMIT = 2

/** 只做检索的工具名：只有整轮都是这些工具，检索结果才足以判定整条链的命运 */
const RETRIEVAL_TOOL_NAMES: ReadonlySet<string> = new Set(['web_search'])

export type RetrievalChainEndReason =
  | 'sources_cooling_down'
  | 'no_active_engine'
  | 'repeated_no_progress'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isOutcomeStatus = (value: unknown): value is RetrievalOutcomeStatus =>
  typeof value === 'string' &&
  (RETRIEVAL_OUTCOME_STATUSES as readonly string[]).includes(value)

const readOutcomeRecord = (content: unknown): Record<string, unknown> | null => {
  if (typeof content === 'string') {
    const trimmed = content.trim()
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null
    try {
      const parsed = JSON.parse(trimmed)
      return isRecord(parsed) ? parsed : null
    } catch {
      return null
    }
  }
  return isRecord(content) ? content : null
}

export const parseRetrievalOutcome = (content: unknown): RetrievalOutcome | null => {
  const record = readOutcomeRecord(content)
  const raw = record ? record.retrievalOutcome : null
  if (!isRecord(raw) || !isOutcomeStatus(raw.status)) return null
  return {
    status: raw.status,
    reason: typeof raw.reason === 'string' && raw.reason ? raw.reason : null,
  }
}

export const isRetrievalEvidenceRetained = (outcome: RetrievalOutcome | null): boolean =>
  outcome != null && EVIDENCE_STATUSES.has(outcome.status)

/**
 * read_url 成功时正文末尾会附「## 检索摘要」+ 一行 JSON（evidenceSummary），
 * 失败/取消则是纯 JSON（走 retrievalOutcome）。这里只读摘要里的计数，不解析正文。
 * results >= 1 且没有任何失败，说明这次读取确实拿到了可用内容（正文或摘要）。
 */
const readTrailingSummary = (
  content: unknown,
): { results: number; readFailed: number } | null => {
  if (typeof content !== 'string') return null
  const lines = content.split('\n')
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i].trim()
    if (!line.startsWith('{') || !line.endsWith('}')) continue
    try {
      const parsed = JSON.parse(line)
      if (!isRecord(parsed)) continue
      if (typeof parsed.results !== 'number' && typeof parsed.read !== 'number') continue
      return {
        results: typeof parsed.results === 'number' ? parsed.results : 0,
        readFailed: typeof parsed.readFailed === 'number' ? parsed.readFailed : 0,
      }
    } catch {
      continue
    }
  }
  return null
}

/** read_url 成功正文 + 摘要尾块里是否带回了可用内容 */
export const isReadEvidenceRetained = (content: unknown): boolean => {
  const summary = readTrailingSummary(content)
  if (!summary) return false
  return summary.results >= 1 && summary.readFailed === 0
}

/** 本轮检索证据的逐轮清点；只统计真的带 retrievalOutcome 的结果 */
export type RetrievalEvidenceTally = {
  rounds: number
  evidenceRounds: number
  empty: number
  /** 没拿到证据的轮次：failed / timeout / cancelled 合并计数 */
  failed: number
  lastStatus: RetrievalOutcomeStatus | null
  lastReason: string | null
  /** 当前工具轮的检索结果（按 iteration 归组） */
  currentIteration: number | null
  currentRoundOutcomes: RetrievalOutcome[]
  /** 已经结算过的轮次：同一轮只判定一次 */
  settledIterations: number[]
  /** 连续全失败/全超时的轮数：用来保留一次恢复机会 */
  consecutiveNoProgressRounds: number
}

export const createRetrievalEvidenceTally = (): RetrievalEvidenceTally => ({
  rounds: 0,
  evidenceRounds: 0,
  empty: 0,
  failed: 0,
  lastStatus: null,
  lastReason: null,
  currentIteration: null,
  currentRoundOutcomes: [],
  settledIterations: [],
  consecutiveNoProgressRounds: 0,
})

/**
 * 没有 retrievalOutcome 的结果（纯文本工具输出）不参与统计，也不默认算有证据。
 * 传了 iteration 时按工具轮归组，供 evaluateRetrievalChain 逐轮结算。
 */
export const recordWebSearchOutcome = (
  tally: RetrievalEvidenceTally,
  content: unknown,
  iteration?: number | null,
): RetrievalOutcome | null => {
  const outcome = parseRetrievalOutcome(content)
  if (!outcome) return null
  tally.rounds += 1
  tally.lastStatus = outcome.status
  tally.lastReason = outcome.reason
  if (EVIDENCE_STATUSES.has(outcome.status)) {
    tally.evidenceRounds += 1
  } else if (outcome.status === 'empty') {
    tally.empty += 1
  } else {
    tally.failed += 1
  }
  if (typeof iteration === 'number' && Number.isFinite(iteration)) {
    if (tally.currentIteration !== iteration) {
      tally.currentIteration = iteration
      tally.currentRoundOutcomes = []
    }
    tally.currentRoundOutcomes.push(outcome)
  }
  return outcome
}

/**
 * 结算一轮检索：返回非空表示纯检索链已经明确耗尽，不该再派发下一轮检索。
 *
 * 判定顺序（先放过一切「仍可能有用」的情况）：
 * 1. 本轮有证据 / 有正常零命中 / 有取消 → 视为有进展，清零连续无进展计数；
 * 2. 检索侧明确 all_sources_cooling_down / no_active_engine → 立即结束；
 * 3. 本轮全是 failed / timeout → 计数 +1，达到上限才结束（先保留一次恢复机会）。
 */
export const evaluateRetrievalChain = (
  tally: RetrievalEvidenceTally,
  iteration: number,
  /** 本轮实际执行的工具名；传了就要求整轮都是纯检索工具 */
  roundToolNames?: string[],
): RetrievalChainEndReason | null => {
  if (tally.settledIterations.includes(iteration)) return null
  tally.settledIterations.push(iteration)

  // 混合工具轮：read_url / python 等仍可能产出，单条检索结果不足以判死整条链，
  // 同时打断「连续全失败」计数，避免混合轮被记成无进展。
  if (
    Array.isArray(roundToolNames) &&
    roundToolNames.length > 0 &&
    !roundToolNames.every((name) => RETRIEVAL_TOOL_NAMES.has(name))
  ) {
    tally.consecutiveNoProgressRounds = 0
    return null
  }

  const outcomes =
    tally.currentIteration === iteration ? tally.currentRoundOutcomes : []
  if (outcomes.length === 0) return null

  const madeProgress = outcomes.some(
    (outcome) =>
      EVIDENCE_STATUSES.has(outcome.status) ||
      outcome.status === 'empty' ||
      outcome.status === 'cancelled',
  )
  if (madeProgress) {
    tally.consecutiveNoProgressRounds = 0
    return null
  }

  for (const outcome of outcomes) {
    const reason = outcome.reason ? EXHAUSTION_REASONS[outcome.reason] : undefined
    if (reason) return reason
  }

  const allNoProgress = outcomes.every((outcome) => NO_PROGRESS_STATUSES.has(outcome.status))
  if (!allNoProgress) {
    tally.consecutiveNoProgressRounds = 0
    return null
  }
  tally.consecutiveNoProgressRounds += 1
  return tally.consecutiveNoProgressRounds >= RETRIEVAL_CHAIN_NO_PROGRESS_LIMIT
    ? 'repeated_no_progress'
    : null
}

export const tallyHasRetainedEvidence = (tally: RetrievalEvidenceTally): boolean =>
  tally.evidenceRounds > 0
